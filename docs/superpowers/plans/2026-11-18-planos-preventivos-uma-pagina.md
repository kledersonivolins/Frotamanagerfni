# Planos Preventivos em uma página — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar as 5 abas de `renderPlanos` por uma página única com seções por classe, colunas iguais, "faltam/venceu há" e linha de detalhes.

**Architecture:** Três funções puras novas (`planoClasse`, `planoSituacao`, `planosOrdenados`) ao lado de `calcPlanoStatus`; `renderPlanos` passa a só montar HTML a partir delas; interação (filtro do resumo, recolher seção, detalhes) por três funções pequenas que mexem no DOM/estado em `window`.

**Tech Stack:** `index.html` (JS inline, sem build); testes `*-regression.mjs` em Node que extraem funções do `index.html`.

**Spec:** `docs/superpowers/specs/2026-11-18-planos-preventivos-uma-pagina-design.md`

## Global Constraints

- Não alterar `calcPlanoStatus`, `salvarPlano`, `confirmarExecPlano`, nem tabelas/colunas do banco.
- Todo texto de usuário (descrição, compartimento, peças) passa por `esc()`.
- Comentários e textos de tela em português; commits com prefixo `feat:`/`test:`.
- Antes de cada push: todos os `*-regression.mjs` OK e checagem de sintaxe dos `<script>` com 0 erros.
- Classe do item = regra atual (`isFiltro` → filtros; `isLub` → lubrificantes; resto → operações).
- Estado: `vencido` (calcPlanoStatus.vencido), `atencao` (≥ 80 %), `ok`, `sem_dados`.

## Review Focus

1. Equipamento sem nenhum plano: mensagem "Nenhum plano cadastrado para este equipamento", sem erro.
2. Item sem intervalo algum (km, h e meses = 0): situação "—" / `sem_dados`, nunca `NaN`.
3. Item só com meses e sem `ultima_data`: `sem_dados` ("sem data base"), nunca vencido.
4. Equipamento sem `parametros` (km/horas ausentes): tela renderiza, km/h tratados como 0.
5. Descrição com `<`/`&`/aspas: aparece escapada, não vira HTML.

---

### Task 1: Funções puras de classe, situação e ordenação

**Files:**
- Modify: `index.html` (inserir logo após `calcPlanoStatus`, ~linha 6760)
- Create: `planos-preventivos-regression.mjs`

**Interfaces:**
- Produces:
  - `planoClasse(p) -> 'lubrificantes'|'filtros'|'operacoes'`
  - `planoSituacao(p, eq, hojeISO) -> {estado:'vencido'|'atencao'|'ok'|'sem_dados', pct:number, texto:string, proxima:string}` (`hojeISO` = `'YYYY-MM-DD'`)
  - `planosOrdenados(lista, eq, hojeISO) -> Array<{p, s}>`

- [ ] **Step 1: Escrever o teste que falha** em `planos-preventivos-regression.mjs`: helper `extrair(nome)` que corta `function nome(...){...}` do `index.html` por contagem de chaves; carrega `calcPlanoStatus`, as três funções novas e stubs `fmt` (`n=>Number(n||0).toLocaleString('pt-BR')`) e `norm`. Casos (eq `{parametros:{km:12340,horas:1205}}`, hoje `2026-11-18`):
  - `planoClasse({descricao:'Filtro de ar'})==='filtros'`; `{descricao:'Óleo motor 15W40'}==='lubrificantes'`; `{descricao:'Reaperto de parafusos'}==='operacoes'`.
  - `{intervalo_horas:250, ultimo_horas:1000}` → `estado 'vencido'`, `texto 'vencido há 45 h'`, `proxima '1.250 h'`.
  - `{intervalo_horas:2000, ultimo_horas:800}` → `estado 'ok'`, `texto 'faltam 1.595 h'`.
  - `{intervalo_km:15000, ultimo_km:0}` com km 12340 → `estado 'atencao'` (82 %), `texto 'faltam 2.660 km'`.
  - só meses: `{intervalo_meses:6, ultima_data:'2026-01-10'}` → `vencido`, `texto` começa com `'vencido há '` e termina `' dias'`, `proxima '10/07/2026'`.
  - só meses sem `ultima_data` → `sem_dados`, `texto 'sem data base'`.
  - nenhum intervalo → `sem_dados`, `texto '—'`, `pct 0` (sem `NaN`); `eq` sem `parametros` não lança.
  - `planosOrdenados`: vencido antes de atenção antes de ok antes de sem_dados; empate por `pct` decrescente.
- [ ] **Step 2: Rodar** `node planos-preventivos-regression.mjs` → deve falhar ("não encontrada").
- [ ] **Step 3: Implementar as três funções** no `index.html`. `planoClasse` reaproveita a mesma lógica de palavras de `isFiltro`/`isLub` de `renderPlanos` (normalizar sem acento/minúsculas). `planoSituacao` usa `calcPlanoStatus` para km/h (estado e pct) e escolhe, entre os gatilhos ativos, o de maior razão `(atual-base)/intervalo` para o texto; só quando km e h são 0 usa meses (`ultima_data` + N meses vs `hojeISO`, pct = decorrido/total, `vencido` se dias ≤ 0, `atencao` se ≥ 80 %). `proxima` formatado com `fmt`+` km`/` h` ou `dd/mm/aaaa`.
- [ ] **Step 4: Rodar o teste** → `OK`.
- [ ] **Step 5: Commit** `feat: funções puras de situação dos planos preventivos`.

### Task 2: Nova `renderPlanos` (seções, colunas iguais, detalhes)

**Files:**
- Modify: `index.html` (`renderPlanos`, ~9967-10078; não mexer nas funções `openModal*`)
- Modify: `planos-preventivos-regression.mjs` (casos de render)

**Interfaces:**
- Consumes: `planoClasse`, `planoSituacao`, `planosOrdenados` (Task 1).
- Produces: classes CSS `pm-sec`, `pm-sec-head`, `pm-row`, `pm-det`, `pm-bar`; atributos `data-sec="lubrificantes|filtros|operacoes|historico"` e `data-estado` em cada linha; ids `pm-det-<planoId>`.

- [ ] **Step 1: Estender o teste**: extrair `renderPlanos` e chamar com stubs de `db` (2 equipamentos; plano com `descricao:'Óleo <b>motor</b> & cia'`, um filtro, uma operação, um vencido), `nivel`, `_eqsDaEmpresa`, `esc`, `fmt`, `fmtDt`, `money`, `window`, `loadPage`. Afirmar: HTML contém as três seções e "Histórico"; contém todas as descrições dos planos do equipamento (nenhum item some); contém `Óleo &lt;b&gt;motor&lt;/b&gt;` e não contém `<b>motor</b>` cru; contém `vencido há`; **não** contém `pm-tab`, `Carac. Técnicas`, `Sienge`; equipamento sem planos → contém `Nenhum plano cadastrado para este equipamento`.
- [ ] **Step 2: Rodar** → falha (ainda tem abas).
- [ ] **Step 3: Reescrever `renderPlanos`**: manter seletor de equipamento (`window._filtPlanoEq`), busca (`window._planoBusca`), botões Inserir/Registrar execução/Importar ficha (só `canEdit`) e faixa KM/horas. Resumo `🔴/🟡/🟢` com contagens vindas de `planoSituacao`. Três seções via `planosOrdenados`, cada uma com título, contagem e tabela de colunas: Item (código, descrição, compartimento) · A cada · Última · Próxima · Situação (barra `pm-bar` + `texto`) · Ações (editar `openModalPlano(idx)`, executar `openModalExecPlano(idx)`, excluir `delPlano(idx)`, com `idx = db.planos_manutencao.findIndex(x=>x.id===p.id)`). Linha `pm-det` oculta por linha com capacidade (L), peças/referência, Amostragem KM/H, % Remonta, Limpeza KM/H, gatilho. Histórico: reaproveitar a montagem de `grupos.historico`/`tabelaHistorico` atuais, em seção recolhida. Remover abas, cartões antigos e texto "Sienge"; manter legenda das cores.
- [ ] **Step 4: Rodar o teste** → `OK`.
- [ ] **Step 5: Commit** `feat: planos preventivos em página única por seções`.

### Task 3: Interação e celular

**Files:**
- Modify: `index.html` (três funções novas junto de `navPlanosEq`, ~linha 6370; CSS no `<style>` de `renderPlanos`)
- Modify: `planos-preventivos-regression.mjs`

**Interfaces:**
- Produces: `setPlanoFiltro(estado:string|'') -> void` (guarda em `window._planoFiltroEstado` e chama `loadPage('planos')`); `togglePlanoSecao(chave:string) -> void` (guarda em `window._planoSecoes[chave]`, re-render); `togglePlanoDetalhe(planoId) -> void` (alterna `display` de `#pm-det-<id>` sem re-render).

- [ ] **Step 1: Teste**: com `window._planoFiltroEstado='vencido'` o HTML só traz itens vencidos e as contagens do resumo continuam as totais; com `window._planoSecoes={filtros:false}` a seção Filtros vem recolhida (sem linhas) mas com o título e a contagem; busca sem resultado mostra "Nenhum item" na seção em vez de sumir.
- [ ] **Step 2: Rodar** → falha.
- [ ] **Step 3: Implementar** as três funções e o filtro/recolhimento em `renderPlanos`. CSS `@media(max-width:900px)`: `.pm-sec table`, `thead` oculto, cada `tr` vira cartão (`display:block`), células com `data-label`.
- [ ] **Step 4: Rodar o teste** → `OK`.
- [ ] **Step 5: Commit** `feat: filtro por situação, seções recolhíveis e detalhes nos planos`.

### Task 4: Verificação, publicação e PR

**Files:**
- Modify: nenhum além do commit.

- [ ] **Step 1:** rodar todos os `*-regression.mjs` e a checagem de sintaxe dos `<script>` (comandos do `CLAUDE.md`) → tudo `OK`, `erros 0`.
- [ ] **Step 2:** abrir `index.html` com Playwright (Chromium já instalado) com `db` de exemplo e tirar screenshot desktop e mobile da página `planos` para conferir o visual; corrigir o que estiver quebrado.
- [ ] **Step 3:** `git push -u origin claude/determined-bohr-kfa5dl`; atualizar título e descrição do PR #9 para cobrir as duas mudanças (placa + planos).
