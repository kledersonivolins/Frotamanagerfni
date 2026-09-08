import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');

function functionSource(name) {
  const marker = `function ${name}(`;
  const start = html.indexOf(marker);
  if (start < 0) throw new Error(`Função ausente: ${name}`);
  const brace = html.indexOf('{', start);
  let depth = 0, quote = null, escaped = false;
  for (let i = brace; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`Função incompleta: ${name}`);
}

const registros = [
  { id: 1, veiculo_id: 10, veiculo_placa: 'ATIVO1', motorista_nome: 'Motorista ativo', solicitante: 'Visível', destino: 'Obra', status: 'finalizado', ativo: true, criado_em: '2026-09-08' },
  { id: 2, veiculo_id: 10, veiculo_placa: 'LEGADO2', motorista_nome: 'Motorista legado', solicitante: 'Legado visível', destino: 'Obra', status: 'finalizado', criado_em: '2026-09-07' },
  { id: 3, veiculo_id: 10, veiculo_placa: 'EXCLUIDO3', motorista_nome: 'Motorista excluído', solicitante: 'Não pode aparecer', destino: 'Obra', status: 'cancelado', ativo: false, criado_em: '2026-09-06' }
];

const context = {
  console,
  db: { emprestimos_veiculos: structuredClone(registros), equipamentos: [{ id: 10, placa: 'CARRO10', modelo: 'Modelo' }], motoristas: [] },
  window: {},
  currentUser: { nivel: 'super' },
  esc: value => String(value ?? ''),
  _empGarantirHistoricoCarregado: () => {},
  _sortLista: lista => lista,
  _empStatusLista: () => [
    { val: 'solicitado', label: 'Solicitado' },
    { val: 'finalizado', label: 'Finalizado' },
    { val: 'cancelado', label: 'Cancelado' }
  ],
  _empBadge: status => status,
  _empPodeEditar: () => false,
  podeExcluirRegistros: () => true,
  _sortBotoes: () => '',
  _sortIcon: () => '',
  _confirmar: async () => true,
  sbDeletar: async () => true,
  loadPage: () => {},
  showToast: () => {},
  today: () => '2026-09-08',
  document: { createElement: () => ({ click: () => {} }) }
};
vm.createContext(context);

for (const name of ['_empRegistroAtivo', '_empRegistrosAtivos', '_empRegistrosParaHistorico', '_empRegistrosParaExportacao', '_empDeletar']) {
  const source = functionSource(name);
  vm.runInContext(name === '_empDeletar' ? `async ${source}` : source, context);
}

assert.deepEqual(Array.from(context._empRegistrosAtivos(), e => e.id), [1, 2], 'ativo=false deve desaparecer, enquanto registros antigos sem ativo continuam visíveis');
assert.deepEqual(Array.from(context._empRegistrosParaHistorico(), e => e.id), [1, 2], 'histórico não pode recuperar exclusões lógicas');
assert.deepEqual(Array.from(context._empRegistrosParaExportacao(), e => e.id), [1, 2], 'exportação não pode recuperar exclusões lógicas');

context.db.emprestimos_veiculos = structuredClone(registros);
context.sbDeletar = async () => false;
await context._empDeletar(0);
assert.equal(context.db.emprestimos_veiculos.length, 3, 'falha no Supabase não pode remover o registro apenas da tela');

context.sbDeletar = async () => true;
await context._empDeletar(0);
assert.equal(context.db.emprestimos_veiculos.length, 2, 'registro só sai da tela depois da confirmação do Supabase');

console.log('PASS: empréstimos excluídos não retornam à lista, histórico, contadores ou Excel.');
