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

const session = new Map([['fm_empresa_ativa', JSON.stringify({ id: 20, nome: 'Empresa indevida' })]]);
const context = {
  console,
  db: {
    empresas: [
      { id: 10, nome: 'Empresa permitida', codigo: 'PER' },
      { id: 20, nome: 'Empresa indevida', codigo: 'OUT' }
    ],
    equipamentos: [
      { id: 1, empresa_id: 10, placa: 'AAA1A11' },
      { id: 2, empresa_id: 20, placa: 'BBB2B22' }
    ],
    ordens_servico: [
      { id: 101, empresa_id: 10, equipamento_id: 1 },
      { id: 102, empresa_id: 20, equipamento_id: 2 }
    ],
    motoristas: [
      { id: 201, empresa_id: 10, nome: 'Permitido' },
      { id: 202, empresa_id: 20, nome: 'Indevido' }
    ],
    emprestimos_veiculos: [
      { id: 301, veiculo_id: 1 },
      { id: 302, veiculo_id: 2 }
    ],
    portaria_movimentacoes: [
      { id: 'mov-1', veiculo_id: 'veiculo-portaria-legado' }
    ]
  },
  currentUser: { id: 7, nome: 'Rose', nivel: 'admin', empresas: '[10]' },
  _empresaAtiva: { id: 20, nome: 'Empresa indevida' },
  sessionStorage: {
    getItem: key => session.get(key) ?? null,
    setItem: (key, value) => session.set(key, value),
    removeItem: key => session.delete(key)
  },
  esc: value => String(value ?? ''),
  document: { getElementById: () => null },
  window: {},
  _sbMode: 'supabase',
  _sbTenant: 'oficinafni',
  _EMPRESTIMOS_TENANT: 'oficinafni',
  validarPlaca: () => true,
  validarCPF: () => true,
  validarCNPJ: () => true,
  _sbSetStatus: () => {},
  showToast: () => {},
  _fmEnfileirarPendente: () => {},
  _reordenarTabela: () => {},
  _sbRegistroExiste: async () => false,
  _isOSExcluida: () => false,
  _filtrarPorEqsDoUsuario: lista => lista,
  navigator: { onLine: true },
  setTimeout,
  Promise
};
vm.createContext(context);

for (const name of [
  '_normalizarEmpresasUsuario', '_idsEmpresasPermitidas', '_empresaPermitidaAoUsuario',
  '_garantirEmpresaAtivaPermitida', '_getEmpresasDoUsuario', '_getEqsVinculados',
  '_filtrarEqsPorUsuario', '_eqsDaEmpresa', '_osDaEmpresa', '_registroEmpresaPermitida',
  '_aplicarEscopoEmpresasNoDb', 'sbSalvar'
]) {
  const source = functionSource(name);
  vm.runInContext(name === 'sbSalvar' ? `async ${source}` : source, context);
}

context._garantirEmpresaAtivaPermitida();
assert.equal(context._empresaAtiva.id, 10, 'empresa antiga de outro usuário deve ser descartada');
assert.deepEqual(Array.from(context._getEmpresasDoUsuario(), e => e.id), [10]);
assert.deepEqual(Array.from(context._eqsDaEmpresa(), e => e.id), [1]);
assert.equal(JSON.parse(session.get('fm_empresa_ativa')).id, 10, 'sessão deve guardar apenas a empresa permitida');
const semEmpresa = context._idsEmpresasPermitidas({ nivel: 'operador', empresas: [] });
assert.equal(semEmpresa.size, 0, 'usuário comum sem empresa marcada não pode herdar acesso a todas');
assert.equal(context._empresaPermitidaAoUsuario(10, { nivel: 'operador', empresas: [] }), false);

context.currentUser={ id:5,nome:'Klederson',nivel:'super',empresas:[10] };
context._empresaAtiva={ id:10,nome:'Ferro Norte Industrial' };
context._garantirEmpresaAtivaPermitida();
assert.equal(context._empresaAtiva,null,'Super Usuário não pode ficar preso à empresa salva na sessão');
assert.equal(session.has('fm_empresa_ativa'),false,'empresa ativa antiga deve ser removida da sessão do Super Usuário');
assert.deepEqual(Array.from(context._osDaEmpresa(),o=>o.id),[101,102],'Super Usuário deve visualizar OS de todas as empresas');

context.currentUser={ id:7,nome:'Rose',nivel:'admin',empresas:'[10]' };
context._empresaAtiva={ id:10,nome:'Empresa permitida' };

context._aplicarEscopoEmpresasNoDb();
assert.deepEqual(Array.from(context.db.empresas, e => e.id), [10], 'cadastro de empresas também respeita o vínculo');
assert.deepEqual(Array.from(context.db.equipamentos, e => e.id), [1], 'veículos de outras empresas não ficam disponíveis');
assert.deepEqual(Array.from(context.db.ordens_servico, e => e.id), [101], 'OS de outras empresas não fica na memória');
assert.deepEqual(Array.from(context.db.motoristas, e => e.id), [201], 'listas comuns também respeitam empresa_id');
assert.deepEqual(Array.from(context.db.emprestimos_veiculos, e => e.id), [301], 'empréstimos respeitam a empresa do veículo da frota');
assert.equal(context.db.portaria_movimentacoes.length, 1, 'veículo legado da portaria não deve ser confundido com veículo da frota');

let consultas = 0;
context._sb = { from: () => { consultas++; throw new Error('não deveria consultar o banco'); } };
const salvou = await context.sbSalvar('ordens_servico', { id: 99, empresa_id: 20, descricao: 'OS indevida' });
assert.equal(salvou, false, 'registro de outra empresa deve ser recusado');
assert.equal(consultas, 0, 'registro não autorizado não pode chegar ao Supabase');

console.log('PASS: usuário vinculado a uma empresa não vê nem grava dados das demais.');
