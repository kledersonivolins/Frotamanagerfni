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
function constante(nome) {
  const m = html.match(new RegExp(`const ${nome}\\s*=\\s*(\\d+)`));
  assert.ok(m, `constante ${nome} não encontrada`);
  return Number(m[1]);
}

const PLANO_LIM_ATENCAO = constante('PLANO_LIM_ATENCAO');
const PLANO_LIM_VENCENDO = constante('PLANO_LIM_VENCENDO');
const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');

const codigoBase = ['esc', 'calcPlanoStatus', '_planoSemRegistro', 'planoClasse', 'planoSituacao', 'planosOrdenados'].map(extrair).join('\n');
const { planoClasse, planoSituacao, planosOrdenados } = new Function(
  'fmt', 'PLANO_LIM_ATENCAO', 'PLANO_LIM_VENCENDO',
  `${codigoBase}; return { planoClasse, planoSituacao, planosOrdenados };`
)(fmt, PLANO_LIM_ATENCAO, PLANO_LIM_VENCENDO);

const eq = { parametros: { km: 12340, horas: 1205 } };

// ── classe ──
assert.equal(planoClasse({ descricao: 'Filtro de ar' }), 'filtros');
assert.equal(planoClasse({ descricao: 'Óleo motor 15W40' }), 'lubrificantes');
assert.equal(planoClasse({ descricao: 'Reaperto de parafusos' }), 'operacoes');

// ── horas ──
let s = planoSituacao({ intervalo_horas: 250, ultimo_horas: 900 }, eq);
assert.equal(s.estado, 'vencido');
assert.equal(s.texto, 'vencido há 55 h');
assert.equal(s.proxima, '1.150 h');

s = planoSituacao({ intervalo_horas: 2000, ultimo_horas: 800 }, eq);
assert.equal(s.estado, 'ok');
assert.equal(s.texto, 'faltam 1.595 h');

// ── km: atenção (≥ limite de atenção) e vencendo (≥ limite de vencendo) ──
s = planoSituacao({ intervalo_km: 13000, ultimo_km: 0 }, eq);          // 94,9 %
assert.equal(s.estado, 'atencao');
assert.equal(s.texto, 'faltam 660 km');
s = planoSituacao({ intervalo_km: 12500, ultimo_km: 0 }, eq);          // 98,7 %
assert.equal(s.estado, 'vencendo');
assert.equal(s.texto, 'faltam 160 km');
s = planoSituacao({ intervalo_km: 15000, ultimo_km: 0 }, eq);          // 82,3 %
assert.equal(s.estado, 'ok');

// ── sem registro de execução: vencido só porque nunca foi registrado ──
s = planoSituacao({ intervalo_horas: 250 }, eq);
assert.equal(s.estado, 'sem_registro');
assert.equal(s.texto, 'sem registro de execução');
assert.ok(!/vencido há/.test(s.texto));

// ── só meses (calcPlanoStatus já trata meses) ──
s = planoSituacao({ intervalo_meses: 6, ultima_data: '2026-01-10' }, eq);
assert.equal(s.estado, 'vencido');
assert.match(s.texto, /^vencido há [\d.]+ dias$/);
assert.equal(s.proxima, '10/07/2026');

// ── bordas (Review Focus 2, 3, 4) ──
s = planoSituacao({ intervalo_meses: 6 }, eq);
assert.equal(s.estado, 'sem_dados');
assert.equal(s.texto, 'sem data base');

s = planoSituacao({}, eq);
assert.equal(s.estado, 'sem_dados');
assert.equal(s.texto, '—');
assert.equal(s.pct, 0);

assert.doesNotThrow(() => planoSituacao({ intervalo_km: 100, ultimo_km: 0 }, {}));
assert.doesNotThrow(() => planoSituacao({ intervalo_km: 100, ultimo_km: 0 }, null));

// ── ordenação (mesma do Painel PCM): vencido > vencendo > atenção > sem registro > ok > sem dados ──
const lista = [
  { id: 1, descricao: 'ok-baixo', intervalo_horas: 2000, ultimo_horas: 800 },
  { id: 2, descricao: 'sem dados' },
  { id: 3, descricao: 'vencido', intervalo_horas: 250, ultimo_horas: 900 },
  { id: 4, descricao: 'atencao', intervalo_km: 13000, ultimo_km: 0 },
  { id: 5, descricao: 'ok-alto', intervalo_horas: 1000, ultimo_horas: 600 },
  { id: 6, descricao: 'sem registro', intervalo_horas: 300 },
  { id: 7, descricao: 'vencendo', intervalo_km: 12500, ultimo_km: 0 },
];
const ord = planosOrdenados(lista, eq).map((x) => x.p.id);
assert.deepEqual(ord, [3, 7, 4, 6, 5, 1, 2]);

// ═════════════ Tela (renderPlanos) ═════════════
const codigoTela = ['esc', 'calcPlanoStatus', '_planoSemRegistro', 'planoClasse', 'planoSituacao', 'planosOrdenados',
  'renderPlanos', 'abrirFormulario', 'setPlanoFiltro', 'togglePlanoSecao', 'togglePlanoDetalhe'].map(extrair).join('\n');

function montarTela(db, win = {}) {
  const chamadas = [];
  const doc = { _els: {}, getElementById(id) { return this._els[id] || null; } };
  const api = new Function(
    'db', 'window', 'document', 'fmt', 'fmtDt', 'money', 'nivel', '_eqsDaEmpresa', 'loadPage',
    'PLANO_LIM_ATENCAO', 'PLANO_LIM_VENCENDO',
    `${codigoTela}; return { renderPlanos, abrirFormulario, setPlanoFiltro, togglePlanoSecao, togglePlanoDetalhe };`
  )(db, win, doc, fmt, (d) => d, (v) => 'R$ ' + v, () => true,
    () => db.equipamentos, (pg) => chamadas.push(pg), PLANO_LIM_ATENCAO, PLANO_LIM_VENCENDO);
  return { ...api, chamadas, doc, win };
}

const EQ1 = { id: 1, placa: 'S3', modelo: 'Escavadeira', parametros: { km: 12340, horas: 1205 } };
const dbBase = () => ({
  equipamentos: [EQ1, { id: 2, placa: 'ABC1234', modelo: 'Caminhão' }],
  planos_manutencao: [
    { id: 11, equipamento_id: 1, codigo: 'L1', descricao: 'Óleo <b>motor</b> & cia', compartimento: 'Motor', intervalo_horas: 250, ultimo_horas: 900 },
    { id: 12, equipamento_id: 1, codigo: 'F1', descricao: 'Filtro de ar', intervalo_horas: 2000, ultimo_horas: 800 },
    { id: 13, equipamento_id: 1, codigo: 'O1', descricao: 'Reaperto de parafusos', intervalo_km: 13000, ultimo_km: 0 },
    { id: 14, equipamento_id: 1, codigo: 'O2', descricao: 'Item sem intervalo' },
    { id: 15, equipamento_id: 1, codigo: 'O3', descricao: 'Inspeção nunca registrada', intervalo_horas: 300 },
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
for (const d of ['Filtro de ar', 'Reaperto de parafusos', 'Item sem intervalo', 'Inspeção nunca registrada']) {
  assert.ok(out.includes(d), `item sumiu da página: ${d}`);
}
assert.ok(!out.includes('Plano do outro equipamento'), 'plano de outro equipamento apareceu');
assert.ok(!/pm-tab(?![a-z])|Carac\. Técnicas|Sienge/.test(out), 'sobrou aba/texto antigo');
assert.ok(out.includes('vencido há 55 h'));
assert.ok(out.includes('faltam 1.595 h'));
assert.ok(out.includes('sem registro de execução'));
// legenda usa os limites reais
assert.ok(out.includes(`Vencendo ≥ ${PLANO_LIM_VENCENDO}%`) && out.includes(`Atenção ≥ ${PLANO_LIM_ATENCAO}%`));
// Review Focus 5: HTML escapado
assert.ok(out.includes('Óleo &lt;b&gt;motor&lt;/b&gt; &amp; cia'));
assert.ok(!out.includes('<b>motor</b>'));
// Review Focus 2: nunca NaN
assert.ok(!/NaN|undefined/.test(out), 'apareceu NaN/undefined na tela');
// resumo: 1 vencido, 0 vencendo, 1 atenção, 1 sem registro, 1 em dia
const chip = (est, n) => assert.match(out, new RegExp(`class="pm-chip ${est}[^"]*"[^>]*><b>${n}</b>`), `chip ${est} deveria ser ${n}`);
chip('vencido', 1); chip('vencendo', 0); chip('atencao', 1); chip('sem_registro', 1); chip('ok', 1);
// ordem dentro da seção de operações: atenção antes de sem registro antes de "sem dados"
assert.ok(out.indexOf('Reaperto de parafusos') < out.indexOf('Inspeção nunca registrada'));
assert.ok(out.indexOf('Inspeção nunca registrada') < out.indexOf('Item sem intervalo'));

// Review Focus 1: equipamento sem planos
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

// ── atalho para o Formulário Mecânico ──
out = montarTela(dbBase(), { _filtPlanoEq: 1 }).renderPlanos();
assert.ok(out.includes("abrirFormulario('1')"), 'faltou o botão Formulário na tela de Planos');
t = montarTela(dbBase(), {});
t.abrirFormulario('1');
assert.equal(t.win._fmEq, 1);
assert.deepEqual(t.chamadas, ['formulario']);
assert.ok(extrair('renderPainelPCM').includes('abrirFormulario('), 'faltou o botão do formulário no Painel PCM');

console.log('planos-preventivos OK');
