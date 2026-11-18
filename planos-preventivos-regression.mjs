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

console.log('planos-preventivos OK');
