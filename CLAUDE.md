# FrotaManager FNI

Sistema de gestão de frota e oficina da Ferro Norte (FNI) — ordens de serviço, Pré-OS,
agendamento de manutenção, empréstimos de veículos, abastecimento e cadastros.
Usuário/dono: Klederson (K Soluções). Responder sempre em português.

## Estrutura

- `index.html` — **o app web inteiro** (~36 mil linhas, HTML + CSS + JS inline, sem build,
  sem framework). Toda mudança de tela/regra é aqui. Localize funções com grep
  (`function salvarOS`, `function renderOS`, etc.) antes de editar.
- `apps/mobile/` — app Android (React 19 + Vite + Capacitor). CI em
  `.github/workflows/mobile-android.yml` gera o APK a cada push em `apps/mobile/**`.
- `supabase/migrations/` — migrations SQL (triggers de Pré-OS automática, fila de mecânicos,
  limite de vagas da oficina, diário de execução, documentos de fechamento).
- `supabase/functions/` — edge functions `fm-user-admin` e `mobile-sync`.
- `docs/superpowers/` — specs e planos (app móvel offline, bot de agendamento WhatsApp).
- `*-regression.mjs` (raiz) — testes de regressão que extraem funções do `index.html`.

## Testes e validação

```bash
# todos os testes de regressão (devem passar antes de qualquer push)
for f in *-regression.mjs; do node "$f" >/dev/null && echo "OK $f" || echo "FALHA $f"; done

# checagem de sintaxe de todos os <script> inline do index.html
node -e "const h=require('fs').readFileSync('index.html','utf8');const re=/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g;let m,b=0;while((m=re.exec(h))){try{new Function(m[1])}catch(e){b++;console.log(e.message)}}console.log('erros',b)"

# app mobile
cd apps/mobile && npm test -- --run
```

Dentro de template strings que geram HTML com `<script>`, escreva `<\/script>`.

## Deploy

- Push na `main` publica. Commits em português, prefixo `feat:` / `fix:` / `docs:`.
- Produção: **industriafni.netlify.app** (site Netlify `industriafni`, publica a `main`
  deste repo). `frotamanager.netlify.app` é de outro repo (`frotamanager`).

## Banco (Supabase)

- Projeto: `gocdyfhzqezpqyebixid`. Todas as tabelas são multi-tenant pela coluna `tenant`;
  o tenant desta operação é **`oficinafni`**. Sempre filtrar por `tenant`.
- Exclusão é lógica: `excluido = true` (nunca apagar linhas).
- IDs são `bigint` no formato timestamp em ms (`Date.now()` / `uid()` no front).
- **Escrever no banco é produção** — mostrar o que vai ser inserido/alterado e pedir
  confirmação antes. Nunca colocar chaves/tokens em arquivos ou commits.

### Empresas e centros de custo (tenant oficinafni)

| Empresa | id |
|---|---|
| FERRO NORTE INDUSTRIAL | 1775904419008 |
| FERRO LESTE | 1778591635572 |
| TELA NORTE | 1781272422295 |

| Centro de custo | id |
|---|---|
| OFICINA | 1776336009463 |
| LOJAS | 1779888773459 |
| TELA NORTE | 1782231758339 |

Mecânicos (tabela `mecanicos`): ADRIANO, ANDRESON, KAIKE, SAMUEL (mecânicos);
RAIMUNDO, FABRICIO (ajudantes); CASSIO (soldador).

## Ordens de serviço (`ordens_servico`)

- `numero`: texto com 4 dígitos, sequencial por tenant = `max(numero::int) + 1`.
- `status`: `pre_os`, `aberta`, `em_andamento`, `oficina_externa`, `concluida`, `cancelada`.
- `tipo`: `Preventiva` / `Corretiva`. `tipo_manutencao`: `preventiva_planejada`,
  `preventiva_revisao`, `corretiva_preventiva`, `corretiva_abrupta`, ...
- `tipo_abertura`: `OS`, `Pre-OS`, `Oficina Externa`. `origem`: `manual`, `automatica`,
  `agendamento_externo`, `agendamento_operador`.
- `itens`: JSON (texto) — array de `{descricao, referencia, quantidade, unidade, obs, futura,
  tipo (peca|filtro|oleo|servico|material), tipo_acao, fluido, categoria, custo_unitario,
  status_exec (pendente|executado|parcial|nao_executado)}`.
- Medição: equipamento tem `tipo_medida` `km` ou `horas`; a OS grava `hodometro` e também
  `km_abertura` **ou** `horimetro_abertura` conforme o tipo.
- `centro_custo_id` é obrigatório na criação; `empresa_id` vem do equipamento/empresa ativa.
- Trigger `trg_agendamento_operador_limite_vagas` bloqueia Pré-OS de agendamento quando a
  oficina está lotada (só para `origem` de agendamento + `status = 'pre_os'`).
- Placas são cadastradas sem hífen. Placas Mercosul podem aparecer convertidas
  (ex.: OVW3E65 = OVW3465). Ao importar planilhas, conferir placas que não batem exato.

### Comportamentos de tela já implementados (não regredir)

- Editar OS (`editarItensOS` / `salvarEdicaoOS`): edita todos os campos, inclusive
  equipamento, empresa, datas de abertura/conclusão, centro de custo, obra, sistema,
  agente; OS concluída/cancelada só Admin edita. Trocas de equipamento/empresa vão para
  `historico_edicoes`.
- Impressão (`imprimirOS`): folha 1 = OS + **assinaturas** (sempre na 1ª folha, com
  auto-escala se não couber na A4); folha 2 = resumo, última intervenção e histórico.
- Reincidência: veículo com **mais de 5 OS no ano corrente** (sem Pré-OS/canceladas/
  excluídas) recebe selo vermelho na lista e aparece no alerta do topo da tela de OS
  (`OS_LIMITE_ANO`, `_osContagemAnoPorEquip`).
