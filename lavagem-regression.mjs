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

// ── registro da página ──
assert.match(html, /\{ page:'lavagem', icon:'fa-soap', label:'Lavagem', min:'operador' \}/, 'menu Manutenção → Lavagem');
assert.match(html, /lavagem: renderLavagem,/, 'rota da página');
assert.match(html, /\["lavagem",\s+"Lavagem"\]/, 'aparece na lista de permissões');
assert.match(html, /paginas: \['os','manutencao','planos','painel_pcm','lavagem',/, 'grupo Manutenção / OS');
assert.match(html, /custos_extras: \['centro_custo','lavagem'\]/, 'atualiza a tela quando custos_extras muda');
// cadastro do equipamento guarda o valor padrão
assert.match(html, /id="eq_vlav"/);
assert.match(extrair('salvarEq'), /valor_lavagem:parseFloat\(document\.getElementById\('eq_vlav'\)/);

// ── funções ──
const nomes = ['esc', '_eqTipoMedida', '_lavEhLavagem', '_lavValorPadrao', '_lavInicioMes', '_lavFiltrar', '_lavResumo', '_lavEq',
  '_lavEqNome', '_lavFiltroAtual', 'renderLavagem', 'openModalLavagem', '_lavAoTrocarEquip', 'salvarLavagem', 'excluirLavagem',
  '_lavLinhasRelatorio', 'exportarLavagemExcel'];
const codigo = nomes.map(extrair).join('\n');

function montar(db, win = {}) {
  const ev = { salvos: [], deletados: [], paginas: [], toasts: [], modal: '', excel: null };
  const els = {};
  const document = { getElementById: (id) => els[id] || null };
  const api = new Function(
    'db', 'window', 'document', 'ev', '_sbMode',
    `const LAVAGEM_TIPO='Lavagem/Higienização';
     const today=()=> '2026-11-18';
     const fmtDt=(d)=> d ? d.split('-').reverse().join('/') : '-';
     const money=(v)=> 'R$ '+Number(v||0).toFixed(2);
     const nivel=()=> true;
     const _eqsDaEmpresa=()=> db.equipamentos;
     const loadPage=(p)=> ev.paginas.push(p);
     const showToast=(m,t)=> ev.toasts.push([m,t]);
     const openModal=(t,h)=> { ev.modal=h; };
     const closeModal=()=>{};
     const uid=()=> 999;
     const _sbTenant='oficinafni';
     const sbSalvar=async (t,r)=>{ ev.salvos.push([t,{...r}]); return true; };
     const sbDeletar=async (t,id)=>{ ev.deletados.push([t,id]); return true; };
     const _confirmar=async ()=> true;
     const _osValidarVinculoCustoAtivo=async (id)=> !!id;
     const exportExcel=(t,h,r)=>{ ev.excel={t,h,r}; };
     ${codigo}
     return { _lavFiltrar, _lavResumo, renderLavagem, openModalLavagem, _lavAoTrocarEquip, salvarLavagem, excluirLavagem, exportarLavagemExcel };`
  )(db, win, document, ev, 'supabase');
  return { ...api, ev, els, win };
}

const dbBase = () => ({
  equipamentos: [
    { id: 1, placa: 'PIZ9160', modelo: 'CARGO 1933', tipo_medida: 'km', parametros: { km: 50000, valor_lavagem: 180 } },
    { id: 2, placa: 'S3', modelo: 'EMPILHADEIRA', tipo_medida: 'horas', parametros: { horas: 3116, valor_lavagem: 120 } },
    { id: 3, placa: 'OVW3465', modelo: 'VM 270', parametros: { km: 400000 } },
  ],
  centros_custo: [{ id: 10, nome: 'OFICINA' }],
  empresas: [{ nome: 'FERRO NORTE INDUSTRIAL' }],
  custos_extras: [
    { id: 101, equipamento_id: 1, data: '2026-11-10', tipo: 'Lavagem/Higienização', origem_custo: 'lavagem', valor: 180, responsavel: 'Lava-jato X' },
    { id: 102, equipamento_id: 2, data: '2026-11-15', tipo: 'Lavagem/Higienização', origem_custo: 'lavagem', valor: 120 },
    { id: 103, equipamento_id: 1, data: '2026-11-17', tipo: 'Lavagem/Higienização', origem_custo: 'lavagem', valor: 200 },
    { id: 104, equipamento_id: 1, data: '2026-11-12', tipo: 'Pedágio', origem_custo: 'custo_extra', valor: 45.5 },          // não é lavagem
    { id: 105, equipamento_id: 1, data: '2026-10-30', tipo: 'Lavagem/Higienização', origem_custo: 'lavagem', valor: 150 },     // fora do período
    { id: 106, equipamento_id: 2, data: '2026-11-16', tipo: 'Lavagem/Higienização', origem_custo: 'lavagem', valor: 99, excluido: true }, // excluída
  ],
});

// filtro e resumo
let t = montar(dbBase());
const lista = t._lavFiltrar(dbBase().custos_extras, { di: '2026-11-01', df: '2026-11-30' });
assert.deepEqual(lista.map((c) => c.id), [103, 102, 101], 'só lavagens do período, mais recentes primeiro, sem excluídas nem outros custos');
const res = t._lavResumo(lista);
assert.equal(res.total, 500);
assert.equal(res.qtd, 3);
assert.deepEqual(res.porEq.map((r) => [r.equipamento_id, r.qtd, r.total, r.ultima]), [[1, 2, 380, '2026-11-17'], [2, 1, 120, '2026-11-15']]);
assert.deepEqual(t._lavFiltrar(dbBase().custos_extras, { di: '2026-11-01', df: '2026-11-30', eq: '2' }).map((c) => c.id), [102]);

// tela
t = montar(dbBase(), { _lavFiltroDi: '2026-11-01', _lavFiltroDf: '2026-11-30' });
let out = t.renderLavagem();
assert.ok(out.includes('PIZ9160 — CARGO 1933') && out.includes('S3 — EMPILHADEIRA'));
assert.ok(out.includes('R$ 500.00'), 'total do período');
assert.ok(!out.includes('45.50') && !out.includes('R$ 99.00') && !out.includes('R$ 150.00'));
assert.ok(out.includes('imprimirLavagem()') && out.includes('exportarLavagemExcel()') && out.includes('openModalLavagem()'));
assert.ok(out.includes('Por equipamento') && out.includes('17/11/2026'), 'resumo por equipamento com a última lavagem');
assert.ok(!/NaN|undefined/.test(out));

// modal: lista suspensa com veículos e máquinas e valor padrão de cada um
t.openModalLavagem();
assert.ok(t.ev.modal.includes('data-valor="180"') && t.ev.modal.includes('data-valor="120"') && t.ev.modal.includes('data-valor="0"'));
assert.ok(t.ev.modal.includes('(veículo)') && t.ev.modal.includes('(máquina)'));

// trocar a placa puxa o valor padrão; não sobrescreve valor digitado
t.els.lav_val = { value: '', dataset: {} };
t.els.lav_val_info = { textContent: '' };
t._lavAoTrocarEquip({ selectedOptions: [{ dataset: { valor: '120' } }] });
assert.equal(t.els.lav_val.value, 120);
t.els.lav_val.dataset.manual = '1'; t.els.lav_val.value = '135';
t._lavAoTrocarEquip({ selectedOptions: [{ dataset: { valor: '180' } }] });
assert.equal(t.els.lav_val.value, '135', 'valor digitado à mão é mantido');

// salvar: vira custo extra de lavagem (entra no Custo por Placa)
const db1 = dbBase();
t = montar(db1);
Object.assign(t.els, {
  lav_eq: { value: '2' }, lav_dt: { value: '2026-11-18' }, lav_val: { value: '135' },
  lav_cc: { value: '10' }, lav_resp: { value: ' Interno ' }, lav_obs: { value: 'motor lavado' },
});
await t.salvarLavagem();
const [tab, reg] = t.ev.salvos[0];
assert.equal(tab, 'custos_extras');
assert.equal(reg.tipo, 'Lavagem/Higienização');
assert.equal(reg.origem_custo, 'lavagem');
assert.equal(reg.equipamento_id, 2);
assert.equal(reg.valor, 135);
assert.equal(reg.centro_custo_id, 10);
assert.equal(reg.tenant, 'oficinafni');
assert.equal(reg.responsavel, 'Interno');
assert.equal(reg.data, '2026-11-18');
assert.ok(db1.custos_extras.some((c) => c.id === 999));

// validações
for (const [campo, msg] of [['lav_eq', /veículo ou máquina/], ['lav_dt', /data/], ['lav_val', /valor/]]) {
  const tt = montar(dbBase());
  Object.assign(tt.els, { lav_eq: { value: '2' }, lav_dt: { value: '2026-11-18' }, lav_val: { value: '10' }, lav_cc: { value: '' }, lav_resp: { value: '' }, lav_obs: { value: '' } });
  tt.els[campo] = { value: '' };
  await tt.salvarLavagem();
  assert.equal(tt.ev.salvos.length, 0);
  assert.match(tt.ev.toasts[0][0], msg);
}

// excluir é lógico
const db2 = dbBase();
t = montar(db2);
await t.excluirLavagem('101');
assert.deepEqual(t.ev.deletados, [['custos_extras', 101]]);
assert.equal(db2.custos_extras.find((c) => c.id === 101).excluido, true);
assert.equal(db2.custos_extras.length, 6, 'nada é removido do array');

// exportar Excel do período
t = montar(dbBase(), { _lavFiltroDi: '2026-11-01', _lavFiltroDf: '2026-11-30' });
t.exportarLavagemExcel();
assert.equal(t.ev.excel.t, 'Lavagens');
assert.deepEqual(t.ev.excel.h, ['Data', 'Placa', 'Modelo', 'Valor (R$)', 'Centro de custo', 'Local / Lavador', 'Obs.']);
assert.equal(t.ev.excel.r.length, 4);
assert.deepEqual(t.ev.excel.r[3], ['TOTAL', '', '', 500, '', '', '']);
// impressão existe e fecha o <script> corretamente dentro do template
assert.match(extrair('imprimirLavagem'), /<\\\/script>/);

// estado do filtro não pode ter o mesmo nome de uma função global (no navegador function _x vira window._x)
for (const m of html.matchAll(/window\.(_lav[A-Za-z]+)/g)) {
  assert.ok(!new RegExp(`function ${m[1]}\\(`).test(html), `window.${m[1]} colide com a função ${m[1]}`);
}

console.log('lavagem OK');
