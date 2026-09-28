# Bot de Agendamento via WhatsApp (Evolution API) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um cliente da oficina consegue pedir agendamento de manutenção por WhatsApp, com o bot entendendo a placa em qualquer formato e coletando os mesmos dados do link público (`?agendamento=1`), incluindo lista de espera quando não há vaga.

**Architecture:** Uma Supabase Edge Function (`whatsapp-agendamento`) recebe o webhook da Evolution API e conduz uma máquina de estados por telefone (tabela `whatsapp_conversas`). Toda a lógica de "qual é a próxima pergunta / o que essa resposta significa" é uma camada 100% pura (`conversa.ts`, sem I/O), testável com `node:test` puro. A camada impura (`handler.ts`, no padrão *gateway* já usado em `supabase/functions/mobile-sync`) busca só os dados que aquele passo precisa e chama as mesmas RPCs `agendamento_*` que o link público já usa — nenhuma RPC existente é alterada. Uma segunda function (`whatsapp-lista-espera`) roda periodicamente (pg_cron) para avisar quem está esperando vaga.

**Tech Stack:** Deno (Supabase Edge Functions), TypeScript, `@supabase/supabase-js`, Postgres/PL-pgSQL (migration), `node:test` + `npx tsx` para rodar os testes localmente (sem precisar do Deno instalado — é o mesmo jeito que `mobile-sync/handler.test.ts` já roda neste repo).

## Global Constraints

- Fixo no tenant `oficinafni` — sem lookup multi-tenant por número de WhatsApp (fora de escopo, ver spec).
- Nenhuma RPC `agendamento_*` existente é modificada; o bot só as consome.
- Lista de espera não grava em `agendamentos_externos` (o trigger `trg_agendamento_externo_auto_pre_os` dispara em todo insert e tentaria criar Pré-OS na hora) — vive só em `whatsapp_conversas.dados` até um horário real ser confirmado.
- `whatsapp_conversas` não tem policy de RLS para `anon`/`authenticated` — só a Edge Function (service role) acessa.
- Normalização de placa: maiúsculo, remove espaço e hífen — mesma regra de `validarPlaca` em `index.html:2480`.
- Tipos de manutenção oferecidos: Preventiva, Corretiva, Revisão, Outro (mesmas 4 do formulário web).
- Placa não encontrada na frota da empresa escolhida: até 3 tentativas, depois encerra e encaminha para (86) 99995-9427.

---

## Mapa de arquivos

```
supabase/migrations/20260928000000_whatsapp_agendamento_bot.sql   (novo)
supabase/functions/whatsapp-agendamento/
  placa.ts            (novo) — normalização de placa, pura
  placa.test.ts        (novo)
  conversa.ts          (novo) — máquina de estados, pura, sem I/O
  conversa.test.ts     (novo)
  evolution.ts          (novo) — cliente HTTP da Evolution API
  evolution.test.ts     (novo)
  handler.ts            (novo) — orquestrador (gateway pattern), chama conversa.ts + RPCs + evolution.ts
  handler.test.ts       (novo) — com gateway falso
  index.ts               (novo) — HTTP entrypoint Deno, monta o gateway real
supabase/functions/whatsapp-lista-espera/
  handler.ts            (novo) — varre sessões em espera, oferece vaga
  handler.test.ts       (novo)
  index.ts               (novo)
```

---

### Task 1: Migration — tabela `whatsapp_conversas`

**Files:**
- Create: `supabase/migrations/20260928000000_whatsapp_agendamento_bot.sql`

**Interfaces:**
- Produces: tabela `public.whatsapp_conversas(id bigint, tenant text, telefone text, etapa text, dados jsonb, criado_em timestamptz, atualizado_em timestamptz)`, única por `(tenant, telefone)`.

- [ ] **Step 1: Escrever a migration**

```sql
-- Sessões de conversa do bot de agendamento via WhatsApp.
-- Guarda em que pergunta cada telefone está e os dados já coletados, entre
-- uma mensagem e outra. Só a Edge Function (service role) acessa — sem
-- policy para anon/authenticated.

create table if not exists public.whatsapp_conversas (
  id bigint generated always as identity primary key,
  tenant text not null,
  telefone text not null,
  etapa text not null default 'inicio',
  dados jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (tenant, telefone)
);

alter table public.whatsapp_conversas enable row level security;

grant select, insert, update, delete on public.whatsapp_conversas to service_role;
grant usage, select on sequence public.whatsapp_conversas_id_seq to service_role;
```

- [ ] **Step 2: Conferir que o arquivo está no formato de nome que o Supabase CLI espera**

Run: `ls supabase/migrations | tail -5`
Expected: o novo arquivo aparece por último (nome começa com timestamp maior que os existentes).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260928000000_whatsapp_agendamento_bot.sql
git commit -m "feat(whatsapp-agendamento): cria tabela whatsapp_conversas"
```

> Esta migration só é aplicada no banco real no Task 12 (deploy manual) — não há acesso automatizado ao projeto Supabase `gocdyfhzqezpqyebixid` nesta sessão.

---

### Task 2: `placa.ts` — normalização de placa

**Files:**
- Create: `supabase/functions/whatsapp-agendamento/placa.ts`
- Test: `supabase/functions/whatsapp-agendamento/placa.test.ts`

**Interfaces:**
- Produces: `normalizarPlaca(bruto: string): string`, `placasCorrespondem(a: string, b: string): boolean`

- [ ] **Step 1: Escrever o teste (falhando)**

```typescript
// supabase/functions/whatsapp-agendamento/placa.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizarPlaca, placasCorrespondem } from './placa.ts'

test('normaliza placa com hífen para maiúsculo sem separador', () => {
  assert.equal(normalizarPlaca('aaa-0000'), 'AAA0000')
})

test('normaliza placa já junta e maiúscula sem alterar', () => {
  assert.equal(normalizarPlaca('AAA0000'), 'AAA0000')
})

test('remove espaços internos e nas pontas', () => {
  assert.equal(normalizarPlaca('  aaa 0000  '), 'AAA0000')
})

test('placa Mercosul também normaliza', () => {
  assert.equal(normalizarPlaca('abc-1d23'), 'ABC1D23')
})

test('string vazia normaliza para string vazia', () => {
  assert.equal(normalizarPlaca(''), '')
})

test('placasCorrespondem ignora formatação diferente', () => {
  assert.equal(placasCorrespondem('AAA-0000', 'aaa0000'), true)
})

test('placasCorrespondem detecta placas diferentes', () => {
  assert.equal(placasCorrespondem('AAA-0000', 'AAA0001'), false)
})

test('placasCorrespondem nunca casa placas vazias', () => {
  assert.equal(placasCorrespondem('', ''), false)
  assert.equal(placasCorrespondem('', 'AAA0000'), false)
})
```

- [ ] **Step 2: Rodar e confirmar que falha (arquivo `placa.ts` ainda não existe)**

Run: `npx --yes tsx --test supabase/functions/whatsapp-agendamento/placa.test.ts`
Expected: erro `Cannot find module './placa.ts'` (ou equivalente).

- [ ] **Step 3: Implementar**

```typescript
// supabase/functions/whatsapp-agendamento/placa.ts
export function normalizarPlaca(bruto: string): string {
  return String(bruto ?? '').toUpperCase().replace(/[\s-]/g, '')
}

export function placasCorrespondem(a: string, b: string): boolean {
  const normalizada = normalizarPlaca(a)
  return normalizada !== '' && normalizada === normalizarPlaca(b)
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx --yes tsx --test supabase/functions/whatsapp-agendamento/placa.test.ts`
Expected: todos os 8 testes `pass`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/whatsapp-agendamento/placa.ts supabase/functions/whatsapp-agendamento/placa.test.ts
git commit -m "feat(whatsapp-agendamento): normalização de placa em qualquer formato"
```

---

### Task 3: `conversa.ts` — tipos e passos "início → empresa"

**Files:**
- Create: `supabase/functions/whatsapp-agendamento/conversa.ts`
- Test: `supabase/functions/whatsapp-agendamento/conversa.test.ts`

**Interfaces:**
- Consumes: nada (primeiro pedaço da máquina de estados).
- Produces (usados pelos Tasks 4–8 e pelo `handler.ts` no Task 10):
  ```typescript
  export type Etapa =
    | 'inicio' | 'aguardando_nome' | 'aguardando_empresa' | 'aguardando_placa'
    | 'aguardando_tipo' | 'aguardando_motivo' | 'aguardando_dia' | 'aguardando_hora'
    | 'confirmando' | 'finalizado' | 'encerrado_humano'
    | 'lista_espera' | 'aguardando_confirmacao_espera'

  export interface Empresa { id: number; nome: string }
  export interface Veiculo { id: number; empresaId: number; placa: string; modelo: string }
  export interface DiaComVaga { dia: string; vagasDia: number }
  export interface HorarioComVaga { hora: number; vagas: number; capacidade: number }

  export interface DadosSessao {
    nome?: string; empresaId?: number; empresaNome?: string
    placaTentativas?: number; veiculoId?: number; veiculoPlaca?: string
    tipo?: string; descricao?: string; dia?: string; hora?: string
    ofertaDia?: string; ofertaHora?: string
  }

  export interface ContextoPasso {
    empresas?: Empresa[]; veiculosDaEmpresa?: Veiculo[]
    diasComVaga?: DiaComVaga[]; horariosDoDia?: HorarioComVaga[]
  }

  export interface ResultadoPasso {
    etapa: Etapa; dados: DadosSessao; respostas: string[]
    acaoPendente?: 'criar_agendamento' | 'confirmar_espera'
  }

  export function processarPasso(
    etapaAtual: Etapa, dados: DadosSessao, entradaUsuario: string, contexto: ContextoPasso,
  ): ResultadoPasso
  ```
  Neste task, `processarPasso` só implementa os casos `'inicio'`, `'aguardando_nome'` e
  `'aguardando_empresa'`; para as demais etapas ele deve devolver a própria etapa sem
  mudar nada (placeholder de passagem, substituído tarefa a tarefa nos próximos tasks —
  isso é intencional aqui porque o `default` do switch é o mesmo em todas as tarefas,
  não uma lacuna deixada sem implementar).

- [ ] **Step 1: Escrever os testes (falhando)**

```typescript
// supabase/functions/whatsapp-agendamento/conversa.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { processarPasso, type ContextoPasso, type Empresa } from './conversa.ts'

const empresas: Empresa[] = [
  { id: 10, nome: 'Construtora Poty' },
  { id: 20, nome: 'Construtora BS' },
]

test('inicio sempre manda boas-vindas e pergunta o nome, ignorando a entrada', () => {
  const r = processarPasso('inicio', {}, 'oi', {})
  assert.equal(r.etapa, 'aguardando_nome')
  assert.deepEqual(r.dados, {})
  assert.match(r.respostas[0], /nome/i)
})

test('aguardando_nome com nome vazio repete a pergunta', () => {
  const r = processarPasso('aguardando_nome', {}, '   ', { empresas })
  assert.equal(r.etapa, 'aguardando_nome')
  assert.match(r.respostas[0], /não entendi/i)
})

test('aguardando_nome com nome válido guarda o nome e lista empresas', () => {
  const r = processarPasso('aguardando_nome', {}, 'Maria Silva', { empresas })
  assert.equal(r.etapa, 'aguardando_empresa')
  assert.equal(r.dados.nome, 'Maria Silva')
  assert.match(r.respostas[0], /1.*Construtora Poty/s)
  assert.match(r.respostas[0], /2.*Construtora BS/s)
})

test('aguardando_empresa com número válido avança para placa', () => {
  const r = processarPasso('aguardando_empresa', { nome: 'Maria' }, '2', { empresas })
  assert.equal(r.etapa, 'aguardando_placa')
  assert.equal(r.dados.empresaId, 20)
  assert.equal(r.dados.empresaNome, 'Construtora BS')
  assert.match(r.respostas[0], /placa/i)
})

test('aguardando_empresa aceita o nome da empresa por texto', () => {
  const r = processarPasso('aguardando_empresa', { nome: 'Maria' }, 'construtora poty', { empresas })
  assert.equal(r.dados.empresaId, 10)
})

test('aguardando_empresa com opção inválida repete a lista', () => {
  const r = processarPasso('aguardando_empresa', { nome: 'Maria' }, '9', { empresas })
  assert.equal(r.etapa, 'aguardando_empresa')
  assert.match(r.respostas[0], /não encontrei essa opção/i)
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx --yes tsx --test supabase/functions/whatsapp-agendamento/conversa.test.ts`
Expected: falha por `conversa.ts` não existir.

- [ ] **Step 3: Implementar**

```typescript
// supabase/functions/whatsapp-agendamento/conversa.ts

export type Etapa =
  | 'inicio' | 'aguardando_nome' | 'aguardando_empresa' | 'aguardando_placa'
  | 'aguardando_tipo' | 'aguardando_motivo' | 'aguardando_dia' | 'aguardando_hora'
  | 'confirmando' | 'finalizado' | 'encerrado_humano'
  | 'lista_espera' | 'aguardando_confirmacao_espera'

export interface Empresa { id: number; nome: string }
export interface Veiculo { id: number; empresaId: number; placa: string; modelo: string }
export interface DiaComVaga { dia: string; vagasDia: number }
export interface HorarioComVaga { hora: number; vagas: number; capacidade: number }

export interface DadosSessao {
  nome?: string
  empresaId?: number
  empresaNome?: string
  placaTentativas?: number
  veiculoId?: number
  veiculoPlaca?: string
  tipo?: string
  descricao?: string
  dia?: string
  hora?: string
  ofertaDia?: string
  ofertaHora?: string
}

export interface ContextoPasso {
  empresas?: Empresa[]
  veiculosDaEmpresa?: Veiculo[]
  diasComVaga?: DiaComVaga[]
  horariosDoDia?: HorarioComVaga[]
}

export interface ResultadoPasso {
  etapa: Etapa
  dados: DadosSessao
  respostas: string[]
  acaoPendente?: 'criar_agendamento' | 'confirmar_espera'
}

function listarEmpresasTexto(empresas: Empresa[]): string {
  return empresas.map((e, i) => `${i + 1}. ${e.nome}`).join('\n')
}

function encontrarEmpresa(entrada: string, empresas: Empresa[]): Empresa | undefined {
  const texto = entrada.trim()
  const porNumero = Number(texto)
  if (Number.isInteger(porNumero) && porNumero >= 1 && porNumero <= empresas.length) {
    return empresas[porNumero - 1]
  }
  const alvo = texto.toLowerCase()
  return empresas.find(e => e.nome.toLowerCase() === alvo)
}

function passoInicio(): ResultadoPasso {
  return {
    etapa: 'aguardando_nome',
    dados: {},
    respostas: ['Olá! 👋 Sou o assistente de agendamento da oficina. Qual é o seu nome?'],
  }
}

function passoAguardandoNome(dados: DadosSessao, entrada: string, contexto: ContextoPasso): ResultadoPasso {
  const nome = entrada.trim()
  if (!nome) {
    return { etapa: 'aguardando_nome', dados, respostas: ['Não entendi, pode me dizer seu nome?'] }
  }
  const empresas = contexto.empresas ?? []
  return {
    etapa: 'aguardando_empresa',
    dados: { ...dados, nome },
    respostas: [`Prazer, ${nome}! De qual empresa é o veículo? Responda com o número:\n${listarEmpresasTexto(empresas)}`],
  }
}

function passoAguardandoEmpresa(dados: DadosSessao, entrada: string, contexto: ContextoPasso): ResultadoPasso {
  const empresas = contexto.empresas ?? []
  const empresa = encontrarEmpresa(entrada, empresas)
  if (!empresa) {
    return {
      etapa: 'aguardando_empresa',
      dados,
      respostas: [`Não encontrei essa opção. Responda com o número da empresa:\n${listarEmpresasTexto(empresas)}`],
    }
  }
  return {
    etapa: 'aguardando_placa',
    dados: { ...dados, empresaId: empresa.id, empresaNome: empresa.nome, placaTentativas: 0 },
    respostas: ['Qual é a placa do veículo?'],
  }
}

export function processarPasso(
  etapaAtual: Etapa,
  dados: DadosSessao,
  entradaUsuario: string,
  contexto: ContextoPasso,
): ResultadoPasso {
  switch (etapaAtual) {
    case 'inicio':
      return passoInicio()
    case 'aguardando_nome':
      return passoAguardandoNome(dados, entradaUsuario, contexto)
    case 'aguardando_empresa':
      return passoAguardandoEmpresa(dados, entradaUsuario, contexto)
    default:
      return { etapa: etapaAtual, dados, respostas: [] }
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx --yes tsx --test supabase/functions/whatsapp-agendamento/conversa.test.ts`
Expected: todos os 6 testes `pass`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/whatsapp-agendamento/conversa.ts supabase/functions/whatsapp-agendamento/conversa.test.ts
git commit -m "feat(whatsapp-agendamento): passos inicio/nome/empresa da conversa"
```

---

### Task 4: `conversa.ts` — passos "placa" e "tipo"

**Files:**
- Modify: `supabase/functions/whatsapp-agendamento/conversa.ts`
- Modify: `supabase/functions/whatsapp-agendamento/conversa.test.ts`

**Interfaces:**
- Consumes: `normalizarPlaca`, `placasCorrespondem` do Task 2; tipos do Task 3.
- Produces: `processarPasso` passa a tratar `'aguardando_placa'` e `'aguardando_tipo'`.

- [ ] **Step 1: Acrescentar os testes (falhando)**

```typescript
// acrescentar em conversa.test.ts
import type { Veiculo } from './conversa.ts'

const veiculos: Veiculo[] = [
  { id: 100, empresaId: 20, placa: 'ABC1234', modelo: 'Caminhão Munck' },
  { id: 101, empresaId: 20, placa: 'DEF5A67', modelo: 'Caminhonete' },
]

test('aguardando_placa aceita placa com hífen e casa com o cadastro', () => {
  const r = processarPasso(
    'aguardando_placa',
    { nome: 'Maria', empresaId: 20, empresaNome: 'Construtora BS', placaTentativas: 0 },
    'ABC-1234',
    { veiculosDaEmpresa: veiculos },
  )
  assert.equal(r.etapa, 'aguardando_tipo')
  assert.equal(r.dados.veiculoId, 100)
  assert.equal(r.dados.veiculoPlaca, 'ABC1234')
})

test('aguardando_placa aceita placa tudo junto minúscula', () => {
  const r = processarPasso(
    'aguardando_placa',
    { empresaId: 20, placaTentativas: 0 },
    'def5a67',
    { veiculosDaEmpresa: veiculos },
  )
  assert.equal(r.dados.veiculoId, 101)
})

test('aguardando_placa não encontrada pede de novo e conta tentativa', () => {
  const r = processarPasso(
    'aguardando_placa',
    { empresaId: 20, placaTentativas: 0 },
    'ZZZ9999',
    { veiculosDaEmpresa: veiculos },
  )
  assert.equal(r.etapa, 'aguardando_placa')
  assert.equal(r.dados.placaTentativas, 1)
  assert.match(r.respostas[0], /não encontrei/i)
})

test('aguardando_placa após 3 tentativas encaminha para atendimento humano', () => {
  const r = processarPasso(
    'aguardando_placa',
    { empresaId: 20, placaTentativas: 2 },
    'ZZZ9999',
    { veiculosDaEmpresa: veiculos },
  )
  assert.equal(r.etapa, 'encerrado_humano')
  assert.match(r.respostas[0], /99995-9427/)
})

test('aguardando_tipo com opção numerada avança para motivo', () => {
  const r = processarPasso('aguardando_tipo', { veiculoId: 100 }, '2', {})
  assert.equal(r.etapa, 'aguardando_motivo')
  assert.equal(r.dados.tipo, 'Corretiva')
})

test('aguardando_tipo aceita o nome do tipo por texto', () => {
  const r = processarPasso('aguardando_tipo', { veiculoId: 100 }, 'revisão', {})
  assert.equal(r.dados.tipo, 'Revisão')
})

test('aguardando_tipo com opção inválida repete a pergunta', () => {
  const r = processarPasso('aguardando_tipo', { veiculoId: 100 }, 'não sei', {})
  assert.equal(r.etapa, 'aguardando_tipo')
})
```

- [ ] **Step 2: Rodar e confirmar que falha** (etapas ainda caem no `default`, `respostas` fica vazio / `r.dados.veiculoId` é `undefined`)

Run: `npx --yes tsx --test supabase/functions/whatsapp-agendamento/conversa.test.ts`

- [ ] **Step 3: Implementar**

```typescript
// no topo de conversa.ts
import { normalizarPlaca, placasCorrespondem } from './placa.ts'

// ...

const TIPOS_MANUTENCAO = ['Preventiva', 'Corretiva', 'Revisão', 'Outro'] as const

function listarTiposTexto(): string {
  return TIPOS_MANUTENCAO.map((t, i) => `${i + 1}. ${t}`).join('\n')
}

function encontrarTipo(entrada: string): string | undefined {
  const texto = entrada.trim()
  const porNumero = Number(texto)
  if (Number.isInteger(porNumero) && porNumero >= 1 && porNumero <= TIPOS_MANUTENCAO.length) {
    return TIPOS_MANUTENCAO[porNumero - 1]
  }
  const alvo = texto.toLowerCase()
  return TIPOS_MANUTENCAO.find(t => t.toLowerCase() === alvo)
}

const LIMITE_TENTATIVAS_PLACA = 3
const TELEFONE_ATENDIMENTO_HUMANO = '(86) 99995-9427'

function passoAguardandoPlaca(dados: DadosSessao, entrada: string, contexto: ContextoPasso): ResultadoPasso {
  const veiculos = contexto.veiculosDaEmpresa ?? []
  const veiculo = veiculos.find(v => placasCorrespondem(v.placa, entrada))
  if (veiculo) {
    return {
      etapa: 'aguardando_tipo',
      dados: { ...dados, veiculoId: veiculo.id, veiculoPlaca: normalizarPlaca(veiculo.placa), placaTentativas: 0 },
      respostas: [`Ve\u00edculo encontrado: ${veiculo.placa} \u2014 ${veiculo.modelo}.\nQual o tipo de manuten\u00e7\u00e3o?\n${listarTiposTexto()}`],
    }
  }
  const tentativas = (dados.placaTentativas ?? 0) + 1
  if (tentativas >= LIMITE_TENTATIVAS_PLACA) {
    return {
      etapa: 'encerrado_humano',
      dados: { ...dados, placaTentativas: tentativas },
      respostas: [`N\u00e3o consegui localizar essa placa no cadastro de ${dados.empresaNome ?? 'sua empresa'}. Vou te encaminhar para nosso atendimento: ${TELEFONE_ATENDIMENTO_HUMANO}.`],
    }
  }
  return {
    etapa: 'aguardando_placa',
    dados: { ...dados, placaTentativas: tentativas },
    respostas: [`N\u00e3o encontrei essa placa no cadastro de ${dados.empresaNome ?? 'sua empresa'}. Confere e digita de novo (tentativa ${tentativas}/${LIMITE_TENTATIVAS_PLACA}).`],
  }
}

function passoAguardandoTipo(dados: DadosSessao, entrada: string): ResultadoPasso {
  const tipo = encontrarTipo(entrada)
  if (!tipo) {
    return { etapa: 'aguardando_tipo', dados, respostas: [`N\u00e3o entendi. Escolha uma op\u00e7\u00e3o:\n${listarTiposTexto()}`] }
  }
  return {
    etapa: 'aguardando_motivo',
    dados: { ...dados, tipo },
    respostas: ['Me conta rapidamente qual \u00e9 o problema ou servi\u00e7o necess\u00e1rio.'],
  }
}
```

E no `switch` de `processarPasso`, trocar os dois `default` correspondentes:

```typescript
    case 'aguardando_placa':
      return passoAguardandoPlaca(dados, entradaUsuario, contexto)
    case 'aguardando_tipo':
      return passoAguardandoTipo(dados, entradaUsuario)
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx --yes tsx --test supabase/functions/whatsapp-agendamento/conversa.test.ts`
Expected: todos os testes (Task 3 + Task 4) `pass`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/whatsapp-agendamento/conversa.ts supabase/functions/whatsapp-agendamento/conversa.test.ts
git commit -m "feat(whatsapp-agendamento): passos placa (com normalizacao) e tipo"
```

---

### Task 5: `conversa.ts` — passos "motivo", "dia" e "hora" (com lista de espera)

**Files:**
- Modify: `supabase/functions/whatsapp-agendamento/conversa.ts`
- Modify: `supabase/functions/whatsapp-agendamento/conversa.test.ts`

**Interfaces:**
- Produces: `processarPasso` passa a tratar `'aguardando_motivo'`, `'aguardando_dia'`, `'aguardando_hora'`, incluindo o desvio para `'lista_espera'` quando não há vaga.

- [ ] **Step 1: Acrescentar os testes (falhando)**

```typescript
// acrescentar em conversa.test.ts
import type { DiaComVaga, HorarioComVaga } from './conversa.ts'

const dias: DiaComVaga[] = [
  { dia: '2026-10-01', vagasDia: 2 },
  { dia: '2026-10-02', vagasDia: 1 },
]
const horarios: HorarioComVaga[] = [
  { hora: 8, vagas: 2, capacidade: 3 },
  { hora: 9, vagas: 0, capacidade: 3 },
]

test('aguardando_motivo com texto guarda a descricao e lista os dias', () => {
  const r = processarPasso('aguardando_motivo', { tipo: 'Corretiva' }, 'Barulho no motor', { diasComVaga: dias })
  assert.equal(r.etapa, 'aguardando_dia')
  assert.equal(r.dados.descricao, 'Barulho no motor')
  assert.match(r.respostas[0], /01\/10/)
})

test('aguardando_motivo vazio repete a pergunta', () => {
  const r = processarPasso('aguardando_motivo', { tipo: 'Corretiva' }, '  ', { diasComVaga: dias })
  assert.equal(r.etapa, 'aguardando_motivo')
})

test('aguardando_motivo sem nenhum dia com vaga vai direto pra lista de espera', () => {
  const r = processarPasso('aguardando_motivo', { tipo: 'Corretiva' }, 'Revisao geral', { diasComVaga: [] })
  assert.equal(r.etapa, 'lista_espera')
  assert.match(r.respostas[0], /lista de espera/i)
})

test('aguardando_dia com numero valido lista horarios livres', () => {
  const r = processarPasso('aguardando_dia', { descricao: 'x' }, '1', { diasComVaga: dias, horariosDoDia: horarios })
  assert.equal(r.etapa, 'aguardando_hora')
  assert.equal(r.dados.dia, '2026-10-01')
  assert.match(r.respostas[0], /08:00/)
  assert.doesNotMatch(r.respostas[0], /09:00/)
})

test('aguardando_dia com opcao invalida repete a lista', () => {
  const r = processarPasso('aguardando_dia', {}, '9', { diasComVaga: dias })
  assert.equal(r.etapa, 'aguardando_dia')
})

test('aguardando_hora com numero valido avanca para confirmacao', () => {
  const r = processarPasso(
    'aguardando_hora', { dia: '2026-10-01', descricao: 'x' }, '1',
    { horariosDoDia: horarios },
  )
  assert.equal(r.etapa, 'confirmando')
  assert.equal(r.dados.hora, '08:00')
  assert.match(r.respostas[0], /SIM/)
})

test('aguardando_hora quando o dia acabou de lotar volta pra escolher outro dia', () => {
  const r = processarPasso(
    'aguardando_hora', { dia: '2026-10-01' }, '1',
    { horariosDoDia: [], diasComVaga: dias },
  )
  assert.equal(r.etapa, 'aguardando_dia')
  assert.match(r.respostas[0], /acabou de lotar/i)
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx --yes tsx --test supabase/functions/whatsapp-agendamento/conversa.test.ts`

- [ ] **Step 3: Implementar**

```typescript
// acrescentar em conversa.ts

function formatarDataBR(iso: string): string {
  const [ano, mes, dia] = iso.split('-')
  return `${dia}/${mes}`
}

function listarDiasTexto(dias: DiaComVaga[]): string {
  return dias.map((d, i) => `${i + 1}. ${formatarDataBR(d.dia)}`).join('\n')
}

function encontrarDia(entrada: string, dias: DiaComVaga[]): DiaComVaga | undefined {
  const texto = entrada.trim()
  const porNumero = Number(texto)
  if (Number.isInteger(porNumero) && porNumero >= 1 && porNumero <= dias.length) {
    return dias[porNumero - 1]
  }
  return dias.find(d => formatarDataBR(d.dia) === texto)
}

function formatarHora(hora: number): string {
  return `${String(hora).padStart(2, '0')}:00`
}

function horariosLivres(horarios: HorarioComVaga[]): HorarioComVaga[] {
  return horarios.filter(h => h.vagas > 0)
}

function listarHorariosTexto(horarios: HorarioComVaga[]): string {
  return horariosLivres(horarios).map((h, i) => `${i + 1}. ${formatarHora(h.hora)}`).join('\n')
}

function encontrarHorario(entrada: string, horarios: HorarioComVaga[]): HorarioComVaga | undefined {
  const livres = horariosLivres(horarios)
  const texto = entrada.trim()
  const porNumero = Number(texto)
  if (Number.isInteger(porNumero) && porNumero >= 1 && porNumero <= livres.length) {
    return livres[porNumero - 1]
  }
  return livres.find(h => formatarHora(h.hora) === texto)
}

function passoAguardandoMotivo(dados: DadosSessao, entrada: string, contexto: ContextoPasso): ResultadoPasso {
  const descricao = entrada.trim()
  if (!descricao) {
    return { etapa: 'aguardando_motivo', dados, respostas: ['N\u00e3o entendi, pode descrever o servi\u00e7o?'] }
  }
  const dias = contexto.diasComVaga ?? []
  const novoDados = { ...dados, descricao }
  if (dias.length === 0) {
    return {
      etapa: 'lista_espera',
      dados: novoDados,
      respostas: ['No momento n\u00e3o h\u00e1 vaga dispon\u00edvel nos pr\u00f3ximos dias. Coloquei seu pedido na lista de espera e aviso assim que abrir um hor\u00e1rio.'],
    }
  }
  return {
    etapa: 'aguardando_dia',
    dados: novoDados,
    respostas: [`Escolha um dia (responda com o n\u00famero):\n${listarDiasTexto(dias)}`],
  }
}

function passoAguardandoDia(dados: DadosSessao, entrada: string, contexto: ContextoPasso): ResultadoPasso {
  const dias = contexto.diasComVaga ?? []
  const escolhido = encontrarDia(entrada, dias)
  if (!escolhido) {
    return { etapa: 'aguardando_dia', dados, respostas: [`N\u00e3o encontrei essa data. Escolha um dia:\n${listarDiasTexto(dias)}`] }
  }
  const horarios = contexto.horariosDoDia ?? []
  return {
    etapa: 'aguardando_hora',
    dados: { ...dados, dia: escolhido.dia },
    respostas: [`Hor\u00e1rios dispon\u00edveis em ${formatarDataBR(escolhido.dia)}:\n${listarHorariosTexto(horarios)}`],
  }
}

function passoAguardandoHora(dados: DadosSessao, entrada: string, contexto: ContextoPasso): ResultadoPasso {
  const horarios = contexto.horariosDoDia ?? []
  const escolhido = encontrarHorario(entrada, horarios)
  if (!escolhido) {
    if (horariosLivres(horarios).length === 0) {
      const dias = contexto.diasComVaga ?? []
      return {
        etapa: 'aguardando_dia',
        dados,
        respostas: [`Esse dia acabou de lotar. Escolha outro:\n${listarDiasTexto(dias)}`],
      }
    }
    return { etapa: 'aguardando_hora', dados, respostas: [`N\u00e3o encontrei esse hor\u00e1rio. Escolha:\n${listarHorariosTexto(horarios)}`] }
  }
  const hora = formatarHora(escolhido.hora)
  return {
    etapa: 'confirmando',
    dados: { ...dados, hora },
    respostas: [
      `Confirma o agendamento?\nData: ${dados.dia ? formatarDataBR(dados.dia) : '?'} \u00e0s ${hora}\nEmpresa: ${dados.empresaNome ?? '?'}\nVe\u00edculo: ${dados.veiculoPlaca ?? '?'}\nTipo: ${dados.tipo ?? '?'}\nMotivo: ${dados.descricao ?? '?'}\nResponda SIM para confirmar ou N\u00c3O para cancelar.`,
    ],
  }
}
```

E no `switch`:

```typescript
    case 'aguardando_motivo':
      return passoAguardandoMotivo(dados, entradaUsuario, contexto)
    case 'aguardando_dia':
      return passoAguardandoDia(dados, entradaUsuario, contexto)
    case 'aguardando_hora':
      return passoAguardandoHora(dados, entradaUsuario, contexto)
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx --yes tsx --test supabase/functions/whatsapp-agendamento/conversa.test.ts`

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/whatsapp-agendamento/conversa.ts supabase/functions/whatsapp-agendamento/conversa.test.ts
git commit -m "feat(whatsapp-agendamento): passos motivo/dia/hora e desvio pra lista de espera"
```

---

### Task 6: `conversa.ts` — passo "confirmando" e finalização

**Files:**
- Modify: `supabase/functions/whatsapp-agendamento/conversa.ts`
- Modify: `supabase/functions/whatsapp-agendamento/conversa.test.ts`

**Interfaces:**
- Produces:
  - `processarPasso` trata `'confirmando'` (SIM devolve `acaoPendente: 'criar_agendamento'`, mantendo a etapa `'confirmando'` até o `handler.ts` chamar a RPC).
  - `finalizarComProtocolo(dados: DadosSessao, protocolo: string, statusRetornado: string): ResultadoPasso` — usada pelo `handler.ts` (Task 10) depois de chamar `agendamento_solicitar`.
  - `falhaAoConfirmar(dados: DadosSessao): ResultadoPasso` — usada pelo `handler.ts` se a RPC falhar.

- [ ] **Step 1: Acrescentar os testes (falhando)**

```typescript
// acrescentar em conversa.test.ts
import { finalizarComProtocolo, falhaAoConfirmar } from './conversa.ts'

const dadosConfirmando = {
  nome: 'Maria', empresaNome: 'Construtora BS', veiculoPlaca: 'ABC1234',
  tipo: 'Corretiva', descricao: 'Barulho no motor', dia: '2026-10-01', hora: '08:00',
}

test('confirmando com SIM sinaliza acao pendente de criar agendamento', () => {
  const r = processarPasso('confirmando', dadosConfirmando, 'sim', {})
  assert.equal(r.etapa, 'confirmando')
  assert.equal(r.acaoPendente, 'criar_agendamento')
})

test('confirmando com NAO cancela e finaliza', () => {
  const r = processarPasso('confirmando', dadosConfirmando, 'nao', {})
  assert.equal(r.etapa, 'finalizado')
  assert.equal(r.acaoPendente, undefined)
  assert.match(r.respostas[0], /cancelado/i)
})

test('confirmando com resposta ambigua repete a pergunta', () => {
  const r = processarPasso('confirmando', dadosConfirmando, 'talvez', {})
  assert.equal(r.etapa, 'confirmando')
  assert.equal(r.acaoPendente, undefined)
  assert.match(r.respostas[0], /SIM.*N\u00c3O/s)
})

test('finalizarComProtocolo com status autorizado confirma vaga', () => {
  const r = finalizarComProtocolo(dadosConfirmando, 'AG-123', 'autorizado')
  assert.equal(r.etapa, 'finalizado')
  assert.match(r.respostas[0], /AG-123/)
  assert.match(r.respostas[0], /Confirmado/i)
})

test('finalizarComProtocolo com outro status avisa que aguarda autorizacao', () => {
  const r = finalizarComProtocolo(dadosConfirmando, 'AG-124', 'pendente')
  assert.match(r.respostas[0], /aguardando autoriza\u00e7\u00e3o/i)
})

test('falhaAoConfirmar mantem etapa confirmando e avisa erro', () => {
  const r = falhaAoConfirmar(dadosConfirmando)
  assert.equal(r.etapa, 'confirmando')
  assert.match(r.respostas[0], /99995-9427/)
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx --yes tsx --test supabase/functions/whatsapp-agendamento/conversa.test.ts`

- [ ] **Step 3: Implementar**

```typescript
// acrescentar em conversa.ts

function interpretarSimNao(entrada: string): boolean | undefined {
  const texto = entrada.trim().toLowerCase()
  if (['sim', 's', 'yes'].includes(texto)) return true
  if (['nao', 'n\u00e3o', 'n', 'no'].includes(texto)) return false
  return undefined
}

function passoConfirmando(dados: DadosSessao, entrada: string): ResultadoPasso {
  const resposta = interpretarSimNao(entrada)
  if (resposta === undefined) {
    return { etapa: 'confirmando', dados, respostas: ['N\u00e3o entendi. Responda SIM para confirmar ou N\u00c3O para cancelar.'] }
  }
  if (!resposta) {
    return { etapa: 'finalizado', dados, respostas: ['Tudo bem, agendamento cancelado. Se quiser recome\u00e7ar, \u00e9 s\u00f3 mandar outra mensagem.'] }
  }
  return { etapa: 'confirmando', dados, respostas: [], acaoPendente: 'criar_agendamento' }
}

export function finalizarComProtocolo(dados: DadosSessao, protocolo: string, statusRetornado: string): ResultadoPasso {
  const statusTexto = statusRetornado === 'autorizado'
    ? 'Confirmado \u2014 vaga reservada e Pr\u00e9-OS gerada.'
    : 'Aguardando autoriza\u00e7\u00e3o.'
  return {
    etapa: 'finalizado',
    dados,
    respostas: [`Agendamento recebido! Protocolo: ${protocolo}.\n${statusTexto}`],
  }
}

export function falhaAoConfirmar(dados: DadosSessao): ResultadoPasso {
  return {
    etapa: 'confirmando',
    dados,
    respostas: [`N\u00e3o consegui confirmar agora. Tente novamente em instantes ou fale com ${TELEFONE_ATENDIMENTO_HUMANO}.`],
  }
}
```

E no `switch`:

```typescript
    case 'confirmando':
      return passoConfirmando(dados, entradaUsuario)
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx --yes tsx --test supabase/functions/whatsapp-agendamento/conversa.test.ts`

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/whatsapp-agendamento/conversa.ts supabase/functions/whatsapp-agendamento/conversa.test.ts
git commit -m "feat(whatsapp-agendamento): confirmacao final e mensagens de protocolo"
```

---

### Task 7: `conversa.ts` — lista de espera e confirmação de vaga ofertada

**Files:**
- Modify: `supabase/functions/whatsapp-agendamento/conversa.ts`
- Modify: `supabase/functions/whatsapp-agendamento/conversa.test.ts`

**Interfaces:**
- Produces:
  - `processarPasso` trata `'lista_espera'` (qualquer mensagem apenas lembra o cliente) e `'aguardando_confirmacao_espera'` (SIM devolve `acaoPendente: 'confirmar_espera'`).
  - `ofertarVaga(dados: DadosSessao, dia: string, hora: string): ResultadoPasso` — usada pelo `whatsapp-lista-espera` (Task 11) para preparar a mensagem e o novo estado da sessão quando encontra um horário livre.
  - `confirmarEsperaComSucesso(dados: DadosSessao, protocolo: string, statusRetornado: string): ResultadoPasso` e `confirmarEsperaVagaPerdida(dados: DadosSessao): ResultadoPasso` — usadas pelo `handler.ts`.

- [ ] **Step 1: Acrescentar os testes (falhando)**

```typescript
// acrescentar em conversa.test.ts
import { ofertarVaga, confirmarEsperaComSucesso, confirmarEsperaVagaPerdida } from './conversa.ts'

test('lista_espera so lembra o cliente, sem avancar etapa', () => {
  const r = processarPasso('lista_espera', { nome: 'Maria' }, 'e ai, alguma novidade?', {})
  assert.equal(r.etapa, 'lista_espera')
  assert.match(r.respostas[0], /lista de espera/i)
})

test('ofertarVaga muda etapa e guarda a oferta', () => {
  const r = ofertarVaga({ nome: 'Maria' }, '2026-10-05', '09:00')
  assert.equal(r.etapa, 'aguardando_confirmacao_espera')
  assert.equal(r.dados.ofertaDia, '2026-10-05')
  assert.equal(r.dados.ofertaHora, '09:00')
  assert.match(r.respostas[0], /09:00/)
})

test('aguardando_confirmacao_espera com SIM sinaliza acao pendente', () => {
  const r = processarPasso(
    'aguardando_confirmacao_espera',
    { nome: 'Maria', ofertaDia: '2026-10-05', ofertaHora: '09:00' },
    'sim', {},
  )
  assert.equal(r.acaoPendente, 'confirmar_espera')
})

test('aguardando_confirmacao_espera com NAO volta pra lista de espera', () => {
  const r = processarPasso(
    'aguardando_confirmacao_espera',
    { nome: 'Maria', ofertaDia: '2026-10-05', ofertaHora: '09:00' },
    'nao', {},
  )
  assert.equal(r.etapa, 'lista_espera')
})

test('confirmarEsperaComSucesso finaliza com protocolo', () => {
  const r = confirmarEsperaComSucesso({ nome: 'Maria' }, 'AG-500', 'autorizado')
  assert.equal(r.etapa, 'finalizado')
  assert.match(r.respostas[0], /AG-500/)
})

test('confirmarEsperaVagaPerdida volta pra lista de espera avisando', () => {
  const r = confirmarEsperaVagaPerdida({ nome: 'Maria' })
  assert.equal(r.etapa, 'lista_espera')
  assert.match(r.respostas[0], /j\u00e1 foi ocupado/i)
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx --yes tsx --test supabase/functions/whatsapp-agendamento/conversa.test.ts`

- [ ] **Step 3: Implementar**

```typescript
// acrescentar em conversa.ts

function passoListaEspera(dados: DadosSessao): ResultadoPasso {
  return {
    etapa: 'lista_espera',
    dados,
    respostas: ['Voc\u00ea continua na nossa lista de espera. Assim que abrir um hor\u00e1rio, eu aviso por aqui.'],
  }
}

export function ofertarVaga(dados: DadosSessao, dia: string, hora: string): ResultadoPasso {
  return {
    etapa: 'aguardando_confirmacao_espera',
    dados: { ...dados, ofertaDia: dia, ofertaHora: hora },
    respostas: [`Abriu uma vaga em ${formatarDataBR(dia)} \u00e0s ${hora}! Responda SIM para garantir ou N\u00c3O para continuar esperando.`],
  }
}

function passoAguardandoConfirmacaoEspera(dados: DadosSessao, entrada: string): ResultadoPasso {
  const resposta = interpretarSimNao(entrada)
  if (resposta === undefined) {
    return { etapa: 'aguardando_confirmacao_espera', dados, respostas: ['N\u00e3o entendi. Responda SIM para garantir a vaga ou N\u00c3O para continuar esperando.'] }
  }
  if (!resposta) {
    return { etapa: 'lista_espera', dados, respostas: ['Sem problemas, voc\u00ea continua na lista de espera.'] }
  }
  return { etapa: 'aguardando_confirmacao_espera', dados, respostas: [], acaoPendente: 'confirmar_espera' }
}

export function confirmarEsperaComSucesso(dados: DadosSessao, protocolo: string, statusRetornado: string): ResultadoPasso {
  return finalizarComProtocolo(dados, protocolo, statusRetornado)
}

export function confirmarEsperaVagaPerdida(dados: DadosSessao): ResultadoPasso {
  return {
    etapa: 'lista_espera',
    dados,
    respostas: ['Esse hor\u00e1rio j\u00e1 foi ocupado por outra pessoa. Voc\u00ea continua na lista de espera, aviso no pr\u00f3ximo que abrir.'],
  }
}
```

E no `switch`:

```typescript
    case 'lista_espera':
      return passoListaEspera(dados)
    case 'aguardando_confirmacao_espera':
      return passoAguardandoConfirmacaoEspera(dados, entradaUsuario)
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx --yes tsx --test supabase/functions/whatsapp-agendamento/conversa.test.ts`
Expected: todos os testes acumulados dos Tasks 3–7 `pass` (devem ser ~30 testes).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/whatsapp-agendamento/conversa.ts supabase/functions/whatsapp-agendamento/conversa.test.ts
git commit -m "feat(whatsapp-agendamento): lista de espera e confirmacao de vaga ofertada"
```

---

### Task 8: `conversa.ts` — teste de integração ponta a ponta (sem I/O)

**Files:**
- Modify: `supabase/functions/whatsapp-agendamento/conversa.test.ts`

**Interfaces:**
- Consumes: tudo dos Tasks 3–7. Nenhuma interface nova é produzida — este task só valida que os passos se encaixam numa conversa completa real.

- [ ] **Step 1: Escrever o teste de fluxo completo**

```typescript
// acrescentar em conversa.test.ts
test('fluxo completo: do inicio ate finalizado, passo a passo', () => {
  let etapa: import('./conversa.ts').Etapa = 'inicio'
  let dados = {}

  let r = processarPasso(etapa, dados, '', {})
  etapa = r.etapa; dados = r.dados
  assert.equal(etapa, 'aguardando_nome')

  r = processarPasso(etapa, dados, 'Jo\u00e3o', { empresas })
  etapa = r.etapa; dados = r.dados
  assert.equal(etapa, 'aguardando_empresa')

  r = processarPasso(etapa, dados, '2', { empresas })
  etapa = r.etapa; dados = r.dados
  assert.equal(etapa, 'aguardando_placa')

  r = processarPasso(etapa, dados, 'abc-1234', { veiculosDaEmpresa: veiculos })
  etapa = r.etapa; dados = r.dados
  assert.equal(etapa, 'aguardando_tipo')

  r = processarPasso(etapa, dados, '1', {})
  etapa = r.etapa; dados = r.dados
  assert.equal(etapa, 'aguardando_motivo')

  r = processarPasso(etapa, dados, 'Troca de \u00f3leo', { diasComVaga: dias })
  etapa = r.etapa; dados = r.dados
  assert.equal(etapa, 'aguardando_dia')

  r = processarPasso(etapa, dados, '1', { diasComVaga: dias, horariosDoDia: horarios })
  etapa = r.etapa; dados = r.dados
  assert.equal(etapa, 'aguardando_hora')

  r = processarPasso(etapa, dados, '1', { horariosDoDia: horarios })
  etapa = r.etapa; dados = r.dados
  assert.equal(etapa, 'confirmando')

  r = processarPasso(etapa, dados, 'sim', {})
  assert.equal(r.acaoPendente, 'criar_agendamento')

  const final = finalizarComProtocolo(r.dados, 'AG-999', 'autorizado')
  assert.equal(final.etapa, 'finalizado')
  assert.match(final.respostas[0], /AG-999/)
})
```

- [ ] **Step 2: Rodar e confirmar que passa (é montagem de peças já implementadas, não deve falhar; se falhar, revela uma inconsistência entre os tasks anteriores — corrigir antes de seguir)**

Run: `npx --yes tsx --test supabase/functions/whatsapp-agendamento/conversa.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/whatsapp-agendamento/conversa.test.ts
git commit -m "test(whatsapp-agendamento): fluxo completo da conversa ponta a ponta"
```

---

### Task 9: `evolution.ts` — cliente da Evolution API

**Files:**
- Create: `supabase/functions/whatsapp-agendamento/evolution.ts`
- Test: `supabase/functions/whatsapp-agendamento/evolution.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface ConfigEvolution { baseUrl: string; apiKey: string; instancia: string }
  export function enviarMensagemWhatsApp(config: ConfigEvolution, telefone: string, texto: string): Promise<void>
  export function extrairMensagemRecebida(payload: unknown): { telefone: string; texto: string } | null
  ```
  `extrairMensagemRecebida` lê o formato de webhook padrão da Evolution API
  (evento `messages.upsert`) e devolve `null` para eventos que não são
  mensagem de texto recebida de um cliente (ex.: mensagem enviada pelo
  próprio bot, `status.update`, mensagens de grupo).

- [ ] **Step 1: Escrever os testes (falhando)**

```typescript
// supabase/functions/whatsapp-agendamento/evolution.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { enviarMensagemWhatsApp, extrairMensagemRecebida, type ConfigEvolution } from './evolution.ts'

const config: ConfigEvolution = { baseUrl: 'https://evo.exemplo.com', apiKey: 'chave-123', instancia: 'oficinafni' }

test('enviarMensagemWhatsApp chama o endpoint certo com o payload certo', async () => {
  const chamadas: Array<{ url: string; init: RequestInit }> = []
  const fetchFalso = async (url: string, init: RequestInit) => {
    chamadas.push({ url, init })
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }
  await enviarMensagemWhatsApp(config, '5586999990000', 'Ol\u00e1!', fetchFalso as typeof fetch)
  assert.equal(chamadas.length, 1)
  assert.equal(chamadas[0].url, 'https://evo.exemplo.com/message/sendText/oficinafni')
  assert.equal((chamadas[0].init.headers as Record<string, string>)['apikey'], 'chave-123')
  const corpo = JSON.parse(String(chamadas[0].init.body))
  assert.equal(corpo.number, '5586999990000')
  assert.equal(corpo.text, 'Ol\u00e1!')
})

test('enviarMensagemWhatsApp lanca erro se a Evolution API responder com falha', async () => {
  const fetchFalso = async () => new Response('erro interno', { status: 500 })
  await assert.rejects(() => enviarMensagemWhatsApp(config, '5586999990000', 'oi', fetchFalso as typeof fetch))
})

test('extrairMensagemRecebida le uma mensagem de texto recebida', () => {
  const payload = {
    event: 'messages.upsert',
    data: { key: { remoteJid: '5586999990000@s.whatsapp.net', fromMe: false }, message: { conversation: 'Ol\u00e1, quero agendar' } },
  }
  const r = extrairMensagemRecebida(payload)
  assert.deepEqual(r, { telefone: '5586999990000', texto: 'Ol\u00e1, quero agendar' })
})

test('extrairMensagemRecebida ignora mensagem enviada pelo proprio bot', () => {
  const payload = {
    event: 'messages.upsert',
    data: { key: { remoteJid: '5586999990000@s.whatsapp.net', fromMe: true }, message: { conversation: 'oi' } },
  }
  assert.equal(extrairMensagemRecebida(payload), null)
})

test('extrairMensagemRecebida ignora eventos que nao sao mensagem', () => {
  assert.equal(extrairMensagemRecebida({ event: 'connection.update' }), null)
})

test('extrairMensagemRecebida ignora mensagem de grupo', () => {
  const payload = {
    event: 'messages.upsert',
    data: { key: { remoteJid: '123456-group@g.us', fromMe: false }, message: { conversation: 'oi' } },
  }
  assert.equal(extrairMensagemRecebida(payload), null)
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx --yes tsx --test supabase/functions/whatsapp-agendamento/evolution.test.ts`

- [ ] **Step 3: Implementar**

```typescript
// supabase/functions/whatsapp-agendamento/evolution.ts
export interface ConfigEvolution {
  baseUrl: string
  apiKey: string
  instancia: string
}

export async function enviarMensagemWhatsApp(
  config: ConfigEvolution,
  telefone: string,
  texto: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const resposta = await fetchImpl(`${config.baseUrl}/message/sendText/${config.instancia}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: config.apiKey },
    body: JSON.stringify({ number: telefone, text: texto }),
  })
  if (!resposta.ok) {
    throw new Error(`Evolution API respondeu ${resposta.status} ao enviar mensagem`)
  }
}

export function extrairMensagemRecebida(payload: unknown): { telefone: string; texto: string } | null {
  if (!payload || typeof payload !== 'object') return null
  const corpo = payload as Record<string, unknown>
  if (corpo.event !== 'messages.upsert') return null

  const dados = corpo.data as Record<string, unknown> | undefined
  const key = dados?.key as Record<string, unknown> | undefined
  const remoteJid = typeof key?.remoteJid === 'string' ? key.remoteJid : ''
  if (!remoteJid || remoteJid.endsWith('@g.us')) return null
  if (key?.fromMe === true) return null

  const mensagem = dados?.message as Record<string, unknown> | undefined
  const texto = typeof mensagem?.conversation === 'string' ? mensagem.conversation : ''
  if (!texto) return null

  const telefone = remoteJid.split('@')[0]
  return { telefone, texto }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx --yes tsx --test supabase/functions/whatsapp-agendamento/evolution.test.ts`

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/whatsapp-agendamento/evolution.ts supabase/functions/whatsapp-agendamento/evolution.test.ts
git commit -m "feat(whatsapp-agendamento): cliente Evolution API (enviar/receber mensagem)"
```

> **Nota para o deploy:** o formato exato do webhook (`messages.upsert`, `data.key.remoteJid`, `data.message.conversation`) é o padrão documentado da Evolution API. Se a instância do usuário estiver configurada com "webhook by events" e o payload vier num formato diferente (ex.: `data.messages[0]` em vez de `data`), ajustar `extrairMensagemRecebida` depois de inspecionar um payload real — isso será validado no Task 12 (teste manual) antes de considerar a função pronta.

---

### Task 10: `handler.ts` e `index.ts` — orquestrador da Edge Function `whatsapp-agendamento`

**Files:**
- Create: `supabase/functions/whatsapp-agendamento/handler.ts`
- Test: `supabase/functions/whatsapp-agendamento/handler.test.ts`
- Create: `supabase/functions/whatsapp-agendamento/index.ts`

**Interfaces:**
- Consumes: `processarPasso`, `finalizarComProtocolo`, `falhaAoConfirmar`, `confirmarEsperaComSucesso`, `confirmarEsperaVagaPerdida` (Tasks 3–7); `extrairMensagemRecebida`, `enviarMensagemWhatsApp` (Task 9).
- Produces: `createWhatsAppAgendamentoHandler(createGateway)` — mesmo padrão de `supabase/functions/mobile-sync/handler.ts:26`, usado pelo `whatsapp-lista-espera` só como referência de estilo (não é importado de lá).

- [ ] **Step 1: Escrever os testes (falhando)**

```typescript
// supabase/functions/whatsapp-agendamento/handler.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { createWhatsAppAgendamentoHandler, type AgendamentoBotGateway } from './handler.ts'
import type { DadosSessao, Empresa, Veiculo, Etapa } from './conversa.ts'

const empresas: Empresa[] = [{ id: 20, nome: 'Construtora BS' }]
const veiculos: Veiculo[] = [{ id: 100, empresaId: 20, placa: 'ABC1234', modelo: 'Munck' }]

function fakeGateway(overrides: Partial<AgendamentoBotGateway> = {}): AgendamentoBotGateway {
  return {
    carregarSessao: async () => null,
    salvarSessao: async () => undefined,
    encerrarSessao: async () => undefined,
    listarEmpresas: async () => empresas,
    listarVeiculos: async () => veiculos,
    listarDiasComVaga: async () => [],
    listarHorariosDoDia: async () => [],
    solicitarAgendamento: async () => ({ protocolo: 'AG-1', status: 'autorizado' }),
    enviarMensagem: async () => undefined,
    extrairMensagem: () => ({ telefone: '5586999990000', texto: 'oi' }),
    ...overrides,
  }
}

function webhookRequest(corpo: unknown = {}): Request {
  return new Request('http://local/whatsapp-agendamento', { method: 'POST', body: JSON.stringify(corpo) })
}

test('sessao inexistente manda boas-vindas e cria sessao aguardando_nome', async () => {
  const salvas: Array<{ telefone: string; etapa: Etapa; dados: DadosSessao }> = []
  const enviadas: string[] = []
  const handler = createWhatsAppAgendamentoHandler(() => fakeGateway({
    salvarSessao: async (telefone, etapa, dados) => { salvas.push({ telefone, etapa, dados }) },
    enviarMensagem: async (_telefone, texto) => { enviadas.push(texto) },
  }))
  const resposta = await handler(webhookRequest())
  assert.equal(resposta.status, 200)
  assert.equal(salvas.length, 1)
  assert.equal(salvas[0].etapa, 'aguardando_nome')
  assert.match(enviadas[0], /nome/i)
})

test('mensagem que nao e do cliente e ignorada (200 sem efeitos)', async () => {
  let chamouSalvar = false
  const handler = createWhatsAppAgendamentoHandler(() => fakeGateway({
    extrairMensagem: () => null,
    salvarSessao: async () => { chamouSalvar = true },
  }))
  const resposta = await handler(webhookRequest())
  assert.equal(resposta.status, 200)
  assert.equal(chamouSalvar, false)
})

test('etapa aguardando_empresa avanca usando a lista de empresas do gateway', async () => {
  const salvas: Array<{ etapa: Etapa; dados: DadosSessao }> = []
  const handler = createWhatsAppAgendamentoHandler(() => fakeGateway({
    carregarSessao: async () => ({ etapa: 'aguardando_empresa', dados: { nome: 'Maria' } }),
    extrairMensagem: () => ({ telefone: '5586999990000', texto: '1' }),
    salvarSessao: async (_t, etapa, dados) => { salvas.push({ etapa, dados }) },
  }))
  await handler(webhookRequest())
  assert.equal(salvas[0].etapa, 'aguardando_placa')
  assert.equal(salvas[0].dados.empresaId, 20)
})

test('confirmacao com SIM chama solicitarAgendamento e encerra a sessao', async () => {
  let chamouSolicitar: unknown = null
  let encerrou = false
  const enviadas: string[] = []
  const handler = createWhatsAppAgendamentoHandler(() => fakeGateway({
    carregarSessao: async () => ({
      etapa: 'confirmando',
      dados: {
        nome: 'Maria', empresaId: 20, empresaNome: 'Construtora BS', veiculoId: 100,
        veiculoPlaca: 'ABC1234', tipo: 'Corretiva', descricao: 'Barulho', dia: '2026-10-01', hora: '08:00',
      },
    }),
    extrairMensagem: () => ({ telefone: '5586999990000', texto: 'sim' }),
    solicitarAgendamento: async (input) => { chamouSolicitar = input; return { protocolo: 'AG-42', status: 'autorizado' } },
    encerrarSessao: async () => { encerrou = true },
    enviarMensagem: async (_t, texto) => { enviadas.push(texto) },
  }))
  await handler(webhookRequest())
  assert.ok(chamouSolicitar)
  assert.equal((chamouSolicitar as { veiculoId: number }).veiculoId, 100)
  assert.equal(encerrou, true)
  assert.match(enviadas[0], /AG-42/)
})

test('confirmacao com SIM mas RPC falha mantem sessao em confirmando', async () => {
  const salvas: Array<{ etapa: Etapa }> = []
  let encerrou = false
  const handler = createWhatsAppAgendamentoHandler(() => fakeGateway({
    carregarSessao: async () => ({
      etapa: 'confirmando',
      dados: { nome: 'Maria', empresaId: 20, veiculoId: 100, tipo: 'Corretiva', descricao: 'x', dia: '2026-10-01', hora: '08:00' },
    }),
    extrairMensagem: () => ({ telefone: '5586999990000', texto: 'sim' }),
    solicitarAgendamento: async () => { throw new Error('fora do ar') },
    salvarSessao: async (_t, etapa) => { salvas.push({ etapa }) },
    encerrarSessao: async () => { encerrou = true },
  }))
  await handler(webhookRequest())
  assert.equal(encerrou, false)
  assert.equal(salvas[0].etapa, 'confirmando')
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx --yes tsx --test supabase/functions/whatsapp-agendamento/handler.test.ts`

- [ ] **Step 3: Implementar**

```typescript
// supabase/functions/whatsapp-agendamento/handler.ts
import {
  processarPasso, finalizarComProtocolo, falhaAoConfirmar,
  confirmarEsperaComSucesso, confirmarEsperaVagaPerdida,
  type Etapa, type DadosSessao, type Empresa, type Veiculo,
  type DiaComVaga, type HorarioComVaga, type ContextoPasso, type ResultadoPasso,
} from './conversa.ts'

export interface AgendamentoBotGateway {
  carregarSessao(telefone: string): Promise<{ etapa: Etapa; dados: DadosSessao } | null>
  salvarSessao(telefone: string, etapa: Etapa, dados: DadosSessao): Promise<void>
  encerrarSessao(telefone: string): Promise<void>
  listarEmpresas(): Promise<Empresa[]>
  listarVeiculos(empresaId: number): Promise<Veiculo[]>
  listarDiasComVaga(): Promise<DiaComVaga[]>
  listarHorariosDoDia(diaISO: string): Promise<HorarioComVaga[]>
  solicitarAgendamento(input: {
    nome: string; contato: string; empresaId: number; veiculoId: number
    tipo: string; descricao: string; inicioISO: string
  }): Promise<{ protocolo: string; status: string }>
  enviarMensagem(telefone: string, texto: string): Promise<void>
  extrairMensagem(payload: unknown): { telefone: string; texto: string } | null
}

const headers = { 'Content-Type': 'application/json' }
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })

async function montarContexto(gateway: AgendamentoBotGateway, etapa: Etapa, dados: DadosSessao): Promise<ContextoPasso> {
  switch (etapa) {
    case 'aguardando_nome':
    case 'aguardando_empresa':
      return { empresas: await gateway.listarEmpresas() }
    case 'aguardando_placa':
      return { veiculosDaEmpresa: dados.empresaId ? await gateway.listarVeiculos(dados.empresaId) : [] }
    case 'aguardando_motivo':
    case 'aguardando_dia':
      return { diasComVaga: await gateway.listarDiasComVaga() }
    case 'aguardando_hora':
      return {
        horariosDoDia: dados.dia ? await gateway.listarHorariosDoDia(dados.dia) : [],
        diasComVaga: await gateway.listarDiasComVaga(),
      }
    default:
      return {}
  }
}

async function executarAcaoPendente(gateway: AgendamentoBotGateway, telefone: string, resultado: ResultadoPasso): Promise<ResultadoPasso> {
  if (resultado.acaoPendente === 'criar_agendamento') {
    const d = resultado.dados
    if (!d.empresaId || !d.veiculoId || !d.tipo || !d.descricao || !d.dia || !d.hora) return falhaAoConfirmar(resultado.dados)
    try {
      const r = await gateway.solicitarAgendamento({
        nome: d.nome ?? '', contato: telefone, empresaId: d.empresaId, veiculoId: d.veiculoId,
        tipo: d.tipo, descricao: d.descricao, inicioISO: `${d.dia}T${d.hora}:00`,
      })
      return finalizarComProtocolo(d, r.protocolo, r.status)
    } catch {
      return falhaAoConfirmar(d)
    }
  }
  if (resultado.acaoPendente === 'confirmar_espera') {
    const d = resultado.dados
    if (!d.empresaId || !d.veiculoId || !d.tipo || !d.descricao || !d.ofertaDia || !d.ofertaHora) return falhaAoConfirmar(d)
    const horarios = await gateway.listarHorariosDoDia(d.ofertaDia)
    const horaOfertada = Number(d.ofertaHora.slice(0, 2))
    const aindaLivre = horarios.some(h => h.hora === horaOfertada && h.vagas > 0)
    if (!aindaLivre) return confirmarEsperaVagaPerdida(d)
    try {
      const r = await gateway.solicitarAgendamento({
        nome: d.nome ?? '', contato: telefone, empresaId: d.empresaId, veiculoId: d.veiculoId,
        tipo: d.tipo, descricao: d.descricao, inicioISO: `${d.ofertaDia}T${d.ofertaHora}:00`,
      })
      return confirmarEsperaComSucesso(d, r.protocolo, r.status)
    } catch {
      return falhaAoConfirmar(d)
    }
  }
  return resultado
}

export function createWhatsAppAgendamentoHandler(createGateway: (payload: unknown) => AgendamentoBotGateway) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers })
    if (request.method !== 'POST') return reply({ error: 'M\u00e9todo n\u00e3o permitido.' }, 405)

    const payload = await request.json().catch(() => ({}))
    const gateway = createGateway(payload)
    const mensagem = gateway.extrairMensagem(payload)
    if (!mensagem) return reply({ ok: true, ignorado: true })

    const sessaoAtual = await gateway.carregarSessao(mensagem.telefone)
    const etapaAtual: Etapa = sessaoAtual?.etapa ?? 'inicio'
    const dadosAtuais: DadosSessao = sessaoAtual?.dados ?? {}

    const contexto = await montarContexto(gateway, etapaAtual, dadosAtuais)
    let resultado = processarPasso(etapaAtual, dadosAtuais, mensagem.texto, contexto)
    resultado = await executarAcaoPendente(gateway, mensagem.telefone, resultado)

    if (resultado.etapa === 'finalizado' || resultado.etapa === 'encerrado_humano') {
      await gateway.encerrarSessao(mensagem.telefone)
    } else {
      await gateway.salvarSessao(mensagem.telefone, resultado.etapa, resultado.dados)
    }

    for (const texto of resultado.respostas) await gateway.enviarMensagem(mensagem.telefone, texto)

    return reply({ ok: true })
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx --yes tsx --test supabase/functions/whatsapp-agendamento/handler.test.ts`

- [ ] **Step 5: Implementar o `index.ts` (entrypoint Deno real, não coberto por teste automatizado — é só fiação com o Supabase/Evolution reais)**

```typescript
// supabase/functions/whatsapp-agendamento/index.ts
import 'jsr:@supabase/functions-js@2.4.4/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2.57.4'
import { createWhatsAppAgendamentoHandler, type AgendamentoBotGateway } from './handler.ts'
import { enviarMensagemWhatsApp, extrairMensagemRecebida } from './evolution.ts'
import type { DadosSessao, Etapa } from './conversa.ts'

const TENANT = 'oficinafni'

function gateway(): AgendamentoBotGateway {
  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )
  const evolutionConfig = {
    baseUrl: Deno.env.get('EVOLUTION_API_URL')!,
    apiKey: Deno.env.get('EVOLUTION_API_KEY')!,
    instancia: Deno.env.get('EVOLUTION_INSTANCE')!,
  }

  return {
    async carregarSessao(telefone) {
      const { data, error } = await client.from('whatsapp_conversas')
        .select('etapa,dados').eq('tenant', TENANT).eq('telefone', telefone).maybeSingle()
      if (error) throw new Error(error.message)
      return data ? { etapa: data.etapa as Etapa, dados: (data.dados ?? {}) as DadosSessao } : null
    },
    async salvarSessao(telefone, etapa, dados) {
      const { error } = await client.from('whatsapp_conversas').upsert({
        tenant: TENANT, telefone, etapa, dados, atualizado_em: new Date().toISOString(),
      }, { onConflict: 'tenant,telefone' })
      if (error) throw new Error(error.message)
    },
    async encerrarSessao(telefone) {
      const { error } = await client.from('whatsapp_conversas').delete().eq('tenant', TENANT).eq('telefone', telefone)
      if (error) throw new Error(error.message)
    },
    async listarEmpresas() {
      const { data, error } = await client.rpc('agendamento_listar_empresas', { p_tenant: TENANT })
      if (error) throw new Error(error.message)
      return (data ?? []).map((e: { id: number; nome?: string; codigo?: string }) => ({ id: e.id, nome: e.nome || e.codigo || String(e.id) }))
    },
    async listarVeiculos(empresaId) {
      const { data, error } = await client.rpc('agendamento_listar_veiculos', { p_tenant: TENANT })
      if (error) throw new Error(error.message)
      return (data ?? [])
        .filter((v: { empresa_id: number }) => String(v.empresa_id) === String(empresaId))
        .map((v: { id: number; empresa_id: number; placa?: string; modelo?: string }) => ({ id: v.id, empresaId: v.empresa_id, placa: v.placa ?? '', modelo: v.modelo ?? '' }))
    },
    async listarDiasComVaga() {
      const hoje = new Date()
      const dias: Array<{ dia: string; vagasDia: number }> = []
      for (const offsetMes of [0, 1]) {
        const ref = new Date(hoje.getFullYear(), hoje.getMonth() + offsetMes, 1)
        const { data, error } = await client.rpc('agendamento_ocupacao_mes', { p_tenant: TENANT, p_ano: ref.getFullYear(), p_mes: ref.getMonth() + 1 })
        if (error) throw new Error(error.message)
        for (const d of data ?? []) {
          if (d.tem_vaga && d.dia >= hoje.toISOString().slice(0, 10)) dias.push({ dia: d.dia, vagasDia: d.vagas_dia })
        }
      }
      return dias
    },
    async listarHorariosDoDia(diaISO) {
      const { data, error } = await client.rpc('agendamento_ocupacao_dia', { p_tenant: TENANT, p_data: diaISO })
      if (error) throw new Error(error.message)
      return (data ?? []).map((h: { hora: number; vagas: number; capacidade: number }) => ({ hora: h.hora, vagas: h.vagas, capacidade: h.capacidade }))
    },
    async solicitarAgendamento(input) {
      const { data, error } = await client.rpc('agendamento_solicitar', {
        p_tenant: TENANT, p_nome: input.nome, p_contato: input.contato, p_empresa_id: input.empresaId,
        p_veiculo_id: input.veiculoId, p_tipo: input.tipo, p_descricao: input.descricao, p_inicio: input.inicioISO,
      })
      if (error) throw new Error(error.message)
      const protocolo = data?.[0]?.protocolo
      if (!protocolo) throw new Error('RPC agendamento_solicitar não retornou protocolo')
      const { data: linha } = await client.from('agendamentos_externos').select('status').eq('protocolo', protocolo).eq('tenant', TENANT).maybeSingle()
      return { protocolo, status: linha?.status ?? 'pendente' }
    },
    async enviarMensagem(telefone, texto) {
      await enviarMensagemWhatsApp(evolutionConfig, telefone, texto)
    },
    extrairMensagem: extrairMensagemRecebida,
  }
}

Deno.serve(createWhatsAppAgendamentoHandler(gateway))
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/whatsapp-agendamento/handler.ts supabase/functions/whatsapp-agendamento/handler.test.ts supabase/functions/whatsapp-agendamento/index.ts
git commit -m "feat(whatsapp-agendamento): orquestrador da Edge Function e entrypoint Deno"
```

---

### Task 11: `whatsapp-lista-espera` — function agendada

**Files:**
- Create: `supabase/functions/whatsapp-lista-espera/handler.ts`
- Test: `supabase/functions/whatsapp-lista-espera/handler.test.ts`
- Create: `supabase/functions/whatsapp-lista-espera/index.ts`

**Interfaces:**
- Consumes: `ofertarVaga` (Task 7); `enviarMensagemWhatsApp` (Task 9).
- Produces: `createListaEsperaHandler(createGateway)`, chamada sem corpo relevante (é disparada por `pg_cron`, não pelo cliente).

- [ ] **Step 1: Escrever os testes (falhando)**

```typescript
// supabase/functions/whatsapp-lista-espera/handler.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { createListaEsperaHandler, type ListaEsperaGateway } from './handler.ts'

function fakeGateway(overrides: Partial<ListaEsperaGateway> = {}): ListaEsperaGateway {
  return {
    listarSessoesEmEspera: async () => [],
    primeiroHorarioLivre: async () => null,
    salvarSessao: async () => undefined,
    enviarMensagem: async () => undefined,
    ...overrides,
  }
}

test('sem sessoes em espera, nao faz nada', async () => {
  let salvouAlgo = false
  const handler = createListaEsperaHandler(() => fakeGateway({ salvarSessao: async () => { salvouAlgo = true } }))
  const resposta = await handler(new Request('http://local/whatsapp-lista-espera', { method: 'POST' }))
  assert.equal(resposta.status, 200)
  assert.equal(salvouAlgo, false)
})

test('sessao em espera sem horario livre ainda, permanece sem mudanca', async () => {
  let salvouAlgo = false
  const handler = createListaEsperaHandler(() => fakeGateway({
    listarSessoesEmEspera: async () => [{ telefone: '5586999990000', dados: { nome: 'Maria' } }],
    primeiroHorarioLivre: async () => null,
    salvarSessao: async () => { salvouAlgo = true },
  }))
  await handler(new Request('http://local/whatsapp-lista-espera', { method: 'POST' }))
  assert.equal(salvouAlgo, false)
})

test('sessao em espera com horario livre recebe oferta por whatsapp', async () => {
  const salvas: Array<{ telefone: string; etapa: string }> = []
  const enviadas: string[] = []
  const handler = createListaEsperaHandler(() => fakeGateway({
    listarSessoesEmEspera: async () => [{ telefone: '5586999990000', dados: { nome: 'Maria' } }],
    primeiroHorarioLivre: async () => ({ dia: '2026-10-05', hora: '09:00' }),
    salvarSessao: async (telefone, etapa) => { salvas.push({ telefone, etapa }) },
    enviarMensagem: async (_t, texto) => { enviadas.push(texto) },
  }))
  await handler(new Request('http://local/whatsapp-lista-espera', { method: 'POST' }))
  assert.equal(salvas[0].etapa, 'aguardando_confirmacao_espera')
  assert.match(enviadas[0], /09:00/)
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx --yes tsx --test supabase/functions/whatsapp-lista-espera/handler.test.ts`

- [ ] **Step 3: Implementar**

```typescript
// supabase/functions/whatsapp-lista-espera/handler.ts
import { ofertarVaga } from '../whatsapp-agendamento/conversa.ts'
import type { DadosSessao, Etapa } from '../whatsapp-agendamento/conversa.ts'

export interface ListaEsperaGateway {
  listarSessoesEmEspera(): Promise<Array<{ telefone: string; dados: DadosSessao }>>
  primeiroHorarioLivre(): Promise<{ dia: string; hora: string } | null>
  salvarSessao(telefone: string, etapa: Etapa, dados: DadosSessao): Promise<void>
  enviarMensagem(telefone: string, texto: string): Promise<void>
}

const headers = { 'Content-Type': 'application/json' }
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })

export function createListaEsperaHandler(createGateway: () => ListaEsperaGateway) {
  return async (_request: Request): Promise<Response> => {
    const gateway = createGateway()
    const sessoes = await gateway.listarSessoesEmEspera()
    let ofertadas = 0

    for (const sessao of sessoes) {
      const horario = await gateway.primeiroHorarioLivre()
      if (!horario) continue
      const resultado = ofertarVaga(sessao.dados, horario.dia, horario.hora)
      await gateway.salvarSessao(sessao.telefone, resultado.etapa, resultado.dados)
      for (const texto of resultado.respostas) await gateway.enviarMensagem(sessao.telefone, texto)
      ofertadas++
    }

    return reply({ ok: true, sessoesAvaliadas: sessoes.length, ofertasEnviadas: ofertadas })
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx --yes tsx --test supabase/functions/whatsapp-lista-espera/handler.test.ts`

- [ ] **Step 5: Implementar o `index.ts`**

```typescript
// supabase/functions/whatsapp-lista-espera/index.ts
import 'jsr:@supabase/functions-js@2.4.4/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2.57.4'
import { createListaEsperaHandler, type ListaEsperaGateway } from './handler.ts'
import { enviarMensagemWhatsApp } from '../whatsapp-agendamento/evolution.ts'

const TENANT = 'oficinafni'

function gateway(): ListaEsperaGateway {
  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )
  const evolutionConfig = {
    baseUrl: Deno.env.get('EVOLUTION_API_URL')!,
    apiKey: Deno.env.get('EVOLUTION_API_KEY')!,
    instancia: Deno.env.get('EVOLUTION_INSTANCE')!,
  }

  return {
    async listarSessoesEmEspera() {
      const { data, error } = await client.from('whatsapp_conversas')
        .select('telefone,dados').eq('tenant', TENANT).eq('etapa', 'lista_espera')
      if (error) throw new Error(error.message)
      return (data ?? []).map(r => ({ telefone: r.telefone, dados: r.dados ?? {} }))
    },
    async primeiroHorarioLivre() {
      const hoje = new Date()
      for (const offsetMes of [0, 1]) {
        const ref = new Date(hoje.getFullYear(), hoje.getMonth() + offsetMes, 1)
        const { data: dias, error } = await client.rpc('agendamento_ocupacao_mes', { p_tenant: TENANT, p_ano: ref.getFullYear(), p_mes: ref.getMonth() + 1 })
        if (error) throw new Error(error.message)
        for (const d of dias ?? []) {
          if (!d.tem_vaga || d.dia < hoje.toISOString().slice(0, 10)) continue
          const { data: horas, error: erroHoras } = await client.rpc('agendamento_ocupacao_dia', { p_tenant: TENANT, p_data: d.dia })
          if (erroHoras) throw new Error(erroHoras.message)
          const livre = (horas ?? []).find((h: { vagas: number }) => h.vagas > 0)
          if (livre) return { dia: d.dia, hora: `${String(livre.hora).padStart(2, '0')}:00` }
        }
      }
      return null
    },
    async salvarSessao(telefone, etapa, dados) {
      const { error } = await client.from('whatsapp_conversas').upsert({
        tenant: TENANT, telefone, etapa, dados, atualizado_em: new Date().toISOString(),
      }, { onConflict: 'tenant,telefone' })
      if (error) throw new Error(error.message)
    },
    async enviarMensagem(telefone, texto) {
      await enviarMensagemWhatsApp(evolutionConfig, telefone, texto)
    },
  }
}

Deno.serve(createListaEsperaHandler(gateway))
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/whatsapp-lista-espera
git commit -m "feat(whatsapp-lista-espera): function agendada que oferece vaga a quem esta esperando"
```

---

### Task 12: Deploy manual e configuração (checklist para o usuário)

Esta etapa não pode ser automatizada nesta sessão: o conector Supabase padrão não
tem acesso ao projeto `gocdyfhzqezpqyebixid` (tenant `oficinafni`), e não há
Supabase CLI nem Deno instalados nesta máquina. É a mesma limitação já registrada
da última sessão de trabalho neste projeto.

**Files:** nenhum (checklist operacional).

- [ ] **Step 1: Aplicar a migration**

Abrir o SQL Editor do projeto Supabase (`gocdyfhzqezpqyebixid`) e colar o conteúdo
de `supabase/migrations/20260928000000_whatsapp_agendamento_bot.sql`, executar.

- [ ] **Step 2: Configurar os secrets das duas functions**

Se tiver a Supabase CLI instalada localmente:

```bash
supabase secrets set --project-ref gocdyfhzqezpqyebixid \
  EVOLUTION_API_URL="https://<sua-instancia-evolution>" \
  EVOLUTION_API_KEY="<sua-chave>" \
  EVOLUTION_INSTANCE="<nome-da-instancia>"
```

Sem CLI: usar Project Settings → Edge Functions → Secrets no painel do Supabase.
`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já existem automaticamente para toda
Edge Function do projeto, não precisam ser configurados manualmente.

- [ ] **Step 3: Deploy das duas functions**

Com CLI:

```bash
supabase functions deploy whatsapp-agendamento --project-ref gocdyfhzqezpqyebixid
supabase functions deploy whatsapp-lista-espera --project-ref gocdyfhzqezpqyebixid
```

Sem CLI: painel Supabase → Edge Functions → criar cada function colando o
conteúdo de `index.ts`, `handler.ts`, `conversa.ts`, `placa.ts` e `evolution.ts`
(a `whatsapp-lista-espera` também precisa de `../whatsapp-agendamento/conversa.ts`
e `../whatsapp-agendamento/evolution.ts` — se o editor do painel não permitir
imports relativos entre functions, copiar esses dois arquivos para dentro da
pasta `whatsapp-lista-espera` também).

- [ ] **Step 4: Apontar o webhook da Evolution API**

Na instância Evolution API já em produção, configurar o webhook (evento
`MESSAGES_UPSERT`) para a URL pública da function recém-deployada:
`https://gocdyfhzqezpqyebixid.supabase.co/functions/v1/whatsapp-agendamento`.

- [ ] **Step 5: Testar manualmente pelo WhatsApp**

Mandar uma mensagem qualquer para o número da oficina e seguir o fluxo (nome →
empresa → placa em formato livre, ex. `abc-1234` → tipo → motivo → dia → hora →
SIM). Conferir:
- A resposta chega no WhatsApp em cada passo.
- Ao confirmar, aparece o protocolo e (no painel interno / `industriafni.netlify.app`)
  a Pré-OS foi criada com o mecânico da fila, igual ao fluxo do link público.
- Se o payload real do webhook vier num formato diferente do assumido no Task 9,
  ajustar `extrairMensagemRecebida` em `evolution.ts` e reimplantar.

- [ ] **Step 6: Agendar a checagem de lista de espera com `pg_cron`**

No SQL Editor (precisa da extensão `pg_cron` habilitada em Database → Extensions):

```sql
select cron.schedule(
  'whatsapp-lista-espera',
  '*/20 * * * *',
  $$
  select net.http_post(
    url := 'https://gocdyfhzqezpqyebixid.supabase.co/functions/v1/whatsapp-lista-espera',
    headers := jsonb_build_object('Authorization', 'Bearer ' || '<SERVICE_ROLE_KEY>')
  );
  $$
);
```

(precisa também da extensão `pg_net` habilitada; substituir `<SERVICE_ROLE_KEY>`
pela chave real do projeto — não commitar essa chave em nenhum arquivo do repo).

- [ ] **Step 7: Commit final (se algum ajuste manual acima exigiu mudar código)**

Se o Step 5 revelou necessidade de ajustar `evolution.ts`, repetir o ciclo
teste→implementação→commit desse arquivo antes de considerar a tarefa concluída.
