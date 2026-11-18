import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');

// Extrai "function nome(...){...}" do index.html contando chaves.
function extrair(nome) {
  const ini = html.search(new RegExp(`(^|\\n)(async )?function ${nome}\\(`));
  assert.ok(ini >= 0, `função ${nome} não encontrada no index.html`);
  const abre = html.indexOf('{', html.indexOf(')', ini));
  let nivel = 0;
  for (let i = abre; i < html.length; i++) {
    const c = html[i];
    if (c === '{') nivel++;
    else if (c === '}' && --nivel === 0) return html.slice(ini, i + 1).trim();
  }
  throw new Error(`chaves desbalanceadas em ${nome}`);
}

const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
const norm = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const codigo = ['calcPlanoStatus', 'planoClasse', 'planoSituacao', 'planosOrdenados'].map(extrair).join('\n');
const { planoClasse, planoSituacao, planosOrdenados } = new Function(
  'fmt', 'norm',
  `${codigo}; return { planoClasse, planoSituacao, planosOrdenados };`
)(fmt, norm);

const HOJE = '2026-11-18';
const eq = { parametros: { km: 12340, horas: 1205 } };

// ── classe ──
assert.equal(planoClasse({ descricao: 'Filtro de ar' }), 'filtros');
assert.equal(planoClasse({ descricao: 'Óleo motor 15W40' }), 'lubrificantes');
assert.equal(planoClasse({ descricao: 'Reaperto de parafusos' }), 'operacoes');

// ── situação por horas ──
let s = planoSituacao({ intervalo_horas: 250, ultimo_horas: 900 }, eq, HOJE);
assert.equal(s.estado, 'vencido');
assert.equal(s.texto, 'vencido há 55 h');
assert.equal(s.proxima, '1.150 h');

s = planoSituacao({ intervalo_horas: 2000, ultimo_horas: 800 }, eq, HOJE);
assert.equal(s.estado, 'ok');
assert.equal(s.texto, 'faltam 1.595 h');

// ── situação por km (atenção ≥ 80 %) ──
s = planoSituacao({ intervalo_km: 15000, ultimo_km: 0 }, eq, HOJE);
assert.equal(s.estado, 'atencao');
assert.equal(s.texto, 'faltam 2.660 km');

// ── só meses ──
s = planoSituacao({ intervalo_meses: 6, ultima_data: '2026-01-10' }, eq, HOJE);
assert.equal(s.estado, 'vencido');
assert.match(s.texto, /^vencido há \d+ dias$/);
assert.equal(s.proxima, '10/07/2026');

// ── bordas (Review Focus 2, 3, 4) ──
s = planoSituacao({ intervalo_meses: 6 }, eq, HOJE);
assert.equal(s.estado, 'sem_dados');
assert.equal(s.texto, 'sem data base');

s = planoSituacao({}, eq, HOJE);
assert.equal(s.estado, 'sem_dados');
assert.equal(s.texto, '—');
assert.equal(s.pct, 0);

assert.doesNotThrow(() => planoSituacao({ intervalo_km: 100, ultimo_km: 0 }, {}, HOJE));
assert.doesNotThrow(() => planoSituacao({ intervalo_km: 100, ultimo_km: 0 }, null, HOJE));

// ── ordenação: vencido > atenção > ok > sem_dados; empate por pct desc ──
const lista = [
  { id: 1, descricao: 'ok-baixo', intervalo_horas: 2000, ultimo_horas: 800 },
  { id: 2, descricao: 'sem dados' },
  { id: 3, descricao: 'vencido', intervalo_horas: 250, ultimo_horas: 900 },
  { id: 4, descricao: 'atencao', intervalo_km: 15000, ultimo_km: 0 },
  { id: 5, descricao: 'ok-alto', intervalo_horas: 1000, ultimo_horas: 600 },
];
const ord = planosOrdenados(lista, eq, HOJE).map((x) => x.p.id);
assert.deepEqual(ord, [3, 4, 5, 1, 2]);


// ═════════════ Tela (renderPlanos) ═════════════
const codigoTela = ['esc', 'calcPlanoStatus', 'planoClasse', 'planoSituacao', 'planosOrdenados',
  'renderPlanos', 'setPlanoFiltro', 'togglePlanoSecao', 'togglePlanoDetalhe'].map(extrair).join('\n');

function montarTela(db, win = {}) {
  const chamadas = [];
  const doc = { _els: {}, getElementById(id) { return this._els[id] || null; } };
  const api = new Function(
    'db', 'window', 'document', 'fmt', 'fmtDt', 'money', 'today', 'nivel', '_eqsDaEmpresa', 'loadPage',
    `${codigoTela}; return { renderPlanos, setPlanoFiltro, togglePlanoSecao, togglePlanoDetalhe };`
  )(db, win, doc, fmt, (d) => d, (v) => 'R$ ' + v, () => HOJE, () => true,
    () => db.equipamentos, (pg) => chamadas.push(pg));
  return { ...api, chamadas, doc, win };
}

const EQ1 = { id: 1, placa: 'S3', modelo: 'Escavadeira', parametros: { km: 12340, horas: 1205 } };
const dbBase = () => ({
  equipamentos: [EQ1, { id: 2, placa: 'ABC1234', modelo: 'Caminhão' }],
  planos_manutencao: [
    { id: 11, equipamento_id: 1, codigo: 'L1', descricao: 'Óleo <b>motor</b> & cia', compartimento: 'Motor', intervalo_horas: 250, ultimo_horas: 900 },
    { id: 12, equipamento_id: 1, codigo: 'F1', descricao: 'Filtro de ar', intervalo_horas: 2000, ultimo_horas: 800 },
    { id: 13, equipamento_id: 1, codigo: 'O1', descricao: 'Reaperto de parafusos', intervalo_km: 15000, ultimo_km: 0 },
    { id: 14, equipamento_id: 1, codigo: 'O2', descricao: 'Item sem intervalo' },
    { id: 21, equipamento_id: 2, codigo: 'X', descricao: 'Plano do outro equipamento' },
  ],
  manutencoes: [], planos_manutencao_historico: [],
});

// uma página só, três seções + histórico, nada de abas
let t = montarTela(dbBase(), { _filtPlanoEq: 1 });
let out = t.renderPlanos();
for (const sec of ['data-sec="lubrificantes"', 'data-sec="filtros"', 'data-sec="operacoes"', 'data-sec="historico"']) {
  assert.ok(out.includes(sec), `faltou a seção ${sec}`);
}
for (const d of ['Filtro de ar', 'Reaperto de parafusos', 'Item sem intervalo']) {
  assert.ok(out.includes(d), `item sumiu da página: ${d}`);
}
assert.ok(!out.includes('Plano do outro equipamento'), 'plano de outro equipamento apareceu');
assert.ok(!/pm-tab(?![a-z])|Carac\. Técnicas|Sienge/.test(out), 'sobrou aba/texto antigo');
assert.ok(out.includes('vencido há 55 h'));
assert.ok(out.includes('faltam 1.595 h'));
// Review Focus 5: HTML escapado
assert.ok(out.includes('Óleo &lt;b&gt;motor&lt;/b&gt; &amp; cia'));
assert.ok(!out.includes('<b>motor</b>'));
// Review Focus 2: nunca NaN
assert.ok(!/NaN|undefined/.test(out), 'apareceu NaN/undefined na tela');
// resumo: 1 vencido, 1 atenção, 1 em dia
assert.match(out, /class="pm-chip vencido[^"]*"[^>]*><b>1<\/b>/);
assert.match(out, /class="pm-chip atencao[^"]*"[^>]*><b>1<\/b>/);
assert.match(out, /class="pm-chip ok[^"]*"[^>]*><b>1<\/b>/);
// ordem dentro da seção de operações: atenção (km 82 %) antes de "sem dados"
assert.ok(out.indexOf('Reaperto de parafusos') < out.indexOf('Item sem intervalo'));

// Review Focus 1: equipamento sem planos
t = montarTela(dbBase(), { _filtPlanoEq: 2 });
t.win._filtPlanoEq = 2;
t.renderPlanos(); // não pode lançar
const db0 = dbBase(); db0.planos_manutencao = [];
out = montarTela(db0, { _filtPlanoEq: 1 }).renderPlanos();
assert.ok(out.includes('Nenhum plano cadastrado para este equipamento'));

// Review Focus 4: equipamento sem parametros
assert.doesNotThrow(() => montarTela(dbBase(), { _filtPlanoEq: 2 }).renderPlanos());

// filtro do resumo: só vencidos na lista; contagens do resumo continuam totais
out = montarTela(dbBase(), { _filtPlanoEq: 1, _planoFiltroEstado: 'vencido' }).renderPlanos();
assert.ok(out.includes('Óleo &lt;b&gt;motor'));
assert.ok(!out.includes('Filtro de ar</td>') && !out.includes('Reaperto de parafusos</td>'));
assert.match(out, /class="pm-chip ok[^"]*"[^>]*><b>1<\/b>/);

// seção recolhida: título e contagem, sem linhas
out = montarTela(dbBase(), { _filtPlanoEq: 1, _planoSecoes: { '1:filtros': false } }).renderPlanos();
assert.ok(out.includes('data-sec="filtros"') && !out.includes('Filtro de ar</td>') && !out.includes('Filtro de ar<small'));

// busca sem resultado: seção continua, com aviso
out = montarTela(dbBase(), { _filtPlanoEq: 1, _planoBusca: 'zzzz' }).renderPlanos();
assert.ok(out.includes('Nenhum item com este filtro'));

// histórico começa recolhido
assert.ok(!montarTela(dbBase(), { _filtPlanoEq: 1 }).renderPlanos().includes('KM/Horímetro executado'));

// interação
t = montarTela(dbBase(), { _filtPlanoEq: 1 });
t.setPlanoFiltro('vencido');
assert.equal(t.win._planoFiltroEstado, 'vencido');
t.setPlanoFiltro('vencido'); // clicar de novo limpa
assert.equal(t.win._planoFiltroEstado, '');
t.togglePlanoSecao('1:filtros', true);
assert.equal(t.win._planoSecoes['1:filtros'], false);
assert.deepEqual(t.chamadas, ['planos', 'planos', 'planos']);
t.doc._els['pm-det-11'] = { style: { display: 'none' } };
t.togglePlanoDetalhe('11');
assert.equal(t.doc._els['pm-det-11'].style.display, '');
t.togglePlanoDetalhe('11');
assert.equal(t.doc._els['pm-det-11'].style.display, 'none');

console.log('planos-preventivos OK');
