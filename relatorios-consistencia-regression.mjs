import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
function extrair(nome) {
  const ini = html.search(new RegExp(`(^|\\n)(async )?function ${nome}\\(`));
  assert.ok(ini >= 0, `função ${nome} não encontrada`);
  const abre = html.indexOf('{', html.indexOf(')', ini));
  let n = 0;
  for (let i = abre; i < html.length; i++) { if (html[i] === '{') n++; else if (html[i] === '}' && --n === 0) return html.slice(ini, i + 1).trim(); }
}

// datas com hora não viram "Invalid Date" e o filtro de período compara só o dia
const fmtDt = new Function(extrair('fmtDt') + ';return fmtDt;')();
assert.equal(fmtDt('2026-11-30'), '30/11/2026');
assert.equal(fmtDt('2026-11-30T15:20:00'), '30/11/2026');
assert.equal(fmtDt(''), '-');
const relDia = new Function(extrair('_relDia') + ';return _relDia;')();
assert.ok(relDia('2026-11-30T15:20:00') <= '2026-11-30', 'OS aberta no último dia entra no período');

// base dos relatórios: empresa ativa, sem excluídos
const db = {
  equipamentos: [{ id: 1, empresa_id: 10 }, { id: 2, empresa_id: 10 }, { id: 3, empresa_id: 20 }, { id: 4, empresa_id: 10, excluido: true }],
  movimentos_combustivel: [{ id: 1, equipamento_id: 1 }, { id: 2, equipamento_id: 3 }, { id: 3, equipamento_id: 2, excluido: true }],
  ordens_servico: [{ id: 1, equipamento_id: 1 }, { id: 2, equipamento_id: 3 }],
  manutencoes: [{ id: 1, equipamento_id: 2 }, { id: 2, equipamento_id: 3 }, { id: 3, equipamento_id: 1, excluido: 'true' }],
  tanque_movimentos: [{ id: 1, tipo: 'entrada' }, { id: 2, equipamento_id: 3 }],
  despesas: [{ id: 1, empresa_id: 10 }, { id: 2, empresa_id: 20 }],
  custos_extras: [{ id: 1, equipamento_id: 1, empresa_id: 20 }],
  empresas: [{ id: 10 }, { id: 20 }],
};
const escopo = (empresa) => new Function('db', '_empresaAtiva', `
  const _isOSExcluida = o => !!o.excluido;
  const _eqsDaEmpresa = () => db.equipamentos.filter(e => !_empresaAtiva || String(e.empresa_id) === String(_empresaAtiva.id));
  const _ids = () => new Set(_eqsDaEmpresa().map(e => String(e.id)));
  const _osDaEmpresa = () => db.ordens_servico.filter(o => !_empresaAtiva || _ids().has(String(o.equipamento_id)));
  const _combDaEmpresa = () => db.movimentos_combustivel.filter(m => !_empresaAtiva || _ids().has(String(m.equipamento_id)));
  const _despesasDaEmpresa = () => db.despesas.filter(d => !_empresaAtiva || String(d.empresa_id) === String(_empresaAtiva.id));
  ${extrair('_relDbEscopado')}
  return _relDbEscopado();`)(db, empresa);
const r = escopo({ id: 10 });
assert.deepEqual(r.equipamentos.map(x => x.id), [1, 2], 'sem outra empresa e sem excluído');
assert.deepEqual(r.movimentos_combustivel.map(x => x.id), [1]);
assert.deepEqual(r.ordens_servico.map(x => x.id), [1]);
assert.deepEqual(r.manutencoes.map(x => x.id), [1]);
assert.deepEqual(r.tanque_movimentos.map(x => x.id), [1], 'entrada de tanque sem veículo continua');
assert.deepEqual(r.despesas.map(x => x.id), [1]);
assert.deepEqual(r.custos_extras.map(x => x.id), [], 'empresa_id do registro tem prioridade');
assert.equal(r.empresas, db.empresas, 'tabelas sem escopo passam inteiras');
assert.equal(db.movimentos_combustivel.length, 3, 'não altera o db original');
const todas = escopo(null);
assert.deepEqual(todas.movimentos_combustivel.map(x => x.id), [1, 2], 'sem empresa ativa: todas, sem excluídos');

// o relatório usa essa base e o filtro de período por dia
const ger = extrair('gerarRelatorio');
assert.match(ger, /^function gerarRelatorio\(saida\)\{\s*const db = _relDbEscopado\(\);/);
assert.match(ger, /if\(di && _relDia\(r\[dataCampo\]\) < di\) return false;/);
assert.match(ger, /if\(df && _relDia\(r\[dataCampo\]\) > df\) return false;/);
assert.ok(!/<td>\$\{m\.tipo_medida\}<\/td>/.test(ger), 'sem "undefined" na coluna tipo de medida');

// ao carregar do banco, lançamentos excluídos ficam de fora (cadastros-base continuam)
assert.match(extrair('_sbCarregarUmaTabela'), /if\(!_SB_MANTER_EXCLUIDOS\.includes\(tabela\)\)\{/);
const manter = eval(html.match(/const _SB_MANTER_EXCLUIDOS = (\[[\s\S]*?\]);/)[1]);
for (const t of ['movimentos_combustivel', 'manutencoes', 'despesas', 'ordens_servico', 'custos_extras', 'tanque_movimentos']) assert.ok(!manter.includes(t), `${t} filtra excluídos`);
assert.ok(manter.includes('equipamentos'), 'equipamento excluído continua para mostrar a placa no histórico');
console.log('relatorios-consistencia OK');
