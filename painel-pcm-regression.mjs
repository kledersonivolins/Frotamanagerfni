import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
function functionSource(name){
  const start=html.indexOf(`function ${name}(`);
  assert.notEqual(start,-1,`função ${name} deve existir`);
  const brace=html.indexOf('{',start);
  let depth=0,quote=null,escaped=false;
  for(let i=brace;i<html.length;i++){
    const ch=html[i];
    if(quote){ if(escaped) escaped=false; else if(ch==='\\') escaped=true; else if(ch===quote) quote=null; continue; }
    if(ch==='"'||ch==="'"||ch==='`'){ quote=ch; continue; }
    if(ch==='{') depth++;
    if(ch==='}'&&--depth===0) return html.slice(start,i+1);
  }
  throw new Error(`função incompleta: ${name}`);
}
const isoDias=(d,base=new Date())=>{ const x=new Date(base.getTime()+d*86400000); return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0'); };

// ── Registro da página ──
{
  assert.match(html,/\{\s*page:'painel_pcm',\s*icon:'fa-gauge-high',\s*label:'Painel PCM',\s*min:'operador'\s*\}/,'MENU deve ter o Painel PCM');
  assert.match(html,/painel_pcm:'📈 Painel PCM/,'PAGE_TITLES deve ter título');
  assert.match(html,/painel_pcm:\s*renderPainelPCM/,'PAGE_FNS deve mapear painel_pcm');
  assert.match(html,/\["painel_pcm",\s*"Painel PCM"\]/,'lista de módulos (permissões) deve incluir o painel');
  console.log('PASS: Painel PCM registrado (menu, título, função, permissões).');
}

const ctx=vm.createContext({ Math,Number,String,Date,Array,Set,isNaN,Object,
  PLANO_LIM_ATENCAO:Number(html.match(/const PLANO_LIM_ATENCAO\s*=\s*(\d+)/)[1]),
  PLANO_LIM_VENCENDO:Number(html.match(/const PLANO_LIM_VENCENDO\s*=\s*(\d+)/)[1]),
  fmt:n=>String(n), fmtDt:d=>d, esc:v=>String(v??''),
  _isOSExcluida:o=>!!o?.excluido, _ultimoAbastecimento:()=>null,
  db:{}, _eqsDaEmpresa:()=>ctx.db.equipamentos });
for(const f of ['calcPlanoStatus','_pcmOrd','_pcmRotulo','_pcmIso','_pcmMediaDiaria','_pcmProjetar','_pcmAnalisar','_proximoNumeroOS','_osEqEhKm','_osMedidorEquip','_centroCustoPadraoPreventiva'])
  vm.runInContext(functionSource(f),ctx);
assert.equal(ctx.PLANO_LIM_ATENCAO,90); assert.equal(ctx.PLANO_LIM_VENCENDO,95);

// ── calcPlanoStatus: 4 níveis, saldo e compatibilidade ──
{
  const plano={intervalo_km:10000,ultimo_km:0};
  const st=km=>ctx.calcPlanoStatus(plano,{parametros:{km}});
  assert.equal(st(8999).nivel,'em_dia');
  assert.equal(st(9000).nivel,'atencao');
  assert.equal(st(9499).nivel,'atencao');
  assert.equal(st(9500).nivel,'vencendo');
  assert.equal(st(9999).nivel,'vencendo');
  assert.equal(st(10000).nivel,'vencida');
  assert.equal(st(10500).nivel,'vencida');
  assert.equal(st(9999).vencendo,true); assert.equal(st(9999).alerta,true); assert.equal(st(9999).ok,false);
  assert.equal(st(9000).atencao,true);  assert.equal(st(9000).alerta,true);
  assert.equal(st(5000).ok,true);       assert.equal(st(5000).alerta,false);
  assert.equal(st(10500).vencido,true); assert.equal(st(10500).saldoKm,-500);
  assert.equal(st(7000).saldoKm,3000);  assert.equal(st(7000).proxKm,10000);
  assert.equal(st(10500).pct,100);      assert.equal(st(10500).pctReal,105);
  // horas, com última execução
  const h=ctx.calcPlanoStatus({intervalo_horas:250,ultimo_horas:1000},{parametros:{horas:1240}});
  assert.equal(h.saldoH,10); assert.equal(h.nivel,'vencendo'); assert.equal(h.saldoKm,null);
  // vale o que vier primeiro (km ou horas)
  const dois=ctx.calcPlanoStatus({intervalo_km:10000,ultimo_km:0,intervalo_horas:250,ultimo_horas:0},{parametros:{km:1000,horas:260}});
  assert.equal(dois.nivel,'vencida');
  console.log('PASS: calcPlanoStatus — níveis em dia/atenção(90)/vencendo(95)/vencida(100), saldo e compatibilidade.');
}

// ── calcPlanoStatus: intervalo em meses ──
{
  const hoje=new Date();
  const mesesAtras=n=>{ const d=new Date(hoje); d.setMonth(d.getMonth()-n); return isoDias(0,d); };
  const eq={parametros:{}};
  assert.equal(ctx.calcPlanoStatus({intervalo_meses:12,ultima_data:mesesAtras(2)},eq).nivel,'em_dia');
  assert.equal(ctx.calcPlanoStatus({intervalo_meses:12,ultima_data:mesesAtras(13)},eq).nivel,'vencida');
  const s=ctx.calcPlanoStatus({intervalo_meses:12,ultima_data:mesesAtras(12)},eq);
  assert.equal(s.vencido,true); assert.ok(s.saldoDias<=0);
  assert.ok(['vencendo','atencao'].includes(ctx.calcPlanoStatus({intervalo_meses:12,ultima_data:mesesAtras(11)},eq).nivel));
  // sem data da última execução, meses não entra no cálculo
  const sem=ctx.calcPlanoStatus({intervalo_meses:12},eq);
  assert.equal(sem.nivel,'em_dia'); assert.equal(sem.saldoDias,null);
  console.log('PASS: intervalo em meses entra no status quando há data da última execução.');
}

// ── Média diária de uso (abastecimentos) ──
{
  const hoje=new Date();
  const eq={id:1,tipo_medida:'km'};
  const mov=(d,h,extra={})=>({equipamento_id:1,data:isoDias(-d,hoje),hodometro:h,litros:50,...extra});
  ctx.db.movimentos_combustivel=[mov(10,1000),mov(6,1200),mov(0,1500)];
  let m=ctx._pcmMediaDiaria(eq,hoje);
  assert.equal(Math.round(m.media),50); assert.equal(m.registros,3); assert.equal(m.rodado,500); assert.equal(m.janela,30);
  // pendente / excluído / de outro equipamento não contam
  ctx.db.movimentos_combustivel=[mov(10,1000),mov(5,9999,{inconsistencia:'pendente'}),mov(4,8888,{excluido:true}),{...mov(3,7777),equipamento_id:2},mov(0,1500)];
  m=ctx._pcmMediaDiaria(eq,hoje); assert.equal(Math.round(m.media),50); assert.equal(m.registros,2);
  // só 1 registro → sem média
  ctx.db.movimentos_combustivel=[mov(0,1500)]; assert.equal(ctx._pcmMediaDiaria(eq,hoje),null);
  // mesmo dia → sem média (evita divisão por ~0)
  ctx.db.movimentos_combustivel=[mov(0,1400),mov(0,1500)]; assert.equal(ctx._pcmMediaDiaria(eq,hoje),null);
  // fora dos 30 dias, cai para a janela de 90
  ctx.db.movimentos_combustivel=[mov(80,1000),mov(60,2000)];
  m=ctx._pcmMediaDiaria(eq,hoje); assert.equal(m.janela,90); assert.equal(Math.round(m.media),50);
  // hodômetro que não avança → sem média
  ctx.db.movimentos_combustivel=[mov(10,1500),mov(0,1500)]; assert.equal(ctx._pcmMediaDiaria(eq,hoje),null);
  console.log('PASS: média diária usa só abastecimentos válidos e exige dados suficientes.');
}

// ── Projeção de data ──
{
  const hoje=new Date(2026,10,18,12,0,0);
  const eqKm={tipo_medida:'km'};
  const s=ctx.calcPlanoStatus({intervalo_km:10000,ultimo_km:0},{parametros:{km:9500}});
  let pj=ctx._pcmProjetar(s,eqKm,{media:50},hoje);
  assert.equal(pj.dias,10); assert.equal(pj.data,'2026-11-28'); assert.equal(pj.base,'uso');
  assert.equal(ctx._pcmProjetar(s,eqKm,null,hoje),null,'sem média e sem meses não há projeção');
  const venc=ctx.calcPlanoStatus({intervalo_km:10000,ultimo_km:0},{parametros:{km:10100}});
  assert.equal(ctx._pcmProjetar(venc,eqKm,null,hoje).dias,0,'vencida projeta 0 dias mesmo sem média');
  // calendário vence antes do uso
  const mix={...s,saldoDias:3};
  pj=ctx._pcmProjetar(mix,eqKm,{media:50},hoje); assert.equal(pj.dias,3); assert.equal(pj.base,'calendário');
  // equipamento em horas usa o saldo de horas
  const sh=ctx.calcPlanoStatus({intervalo_horas:250,ultimo_horas:0},{parametros:{horas:200}});
  assert.equal(ctx._pcmProjetar(sh,{tipo_medida:'horas'},{media:5},hoje).dias,10);
  console.log('PASS: projeção = hoje + saldo / média diária (e calendário quando antecede).');
}

// ── Análise da frota ──
{
  const hoje=new Date();
  ctx.db.equipamentos=[
    {id:1,placa:'AAA1A11',modelo:'Caminhão',tipo_medida:'km',parametros:{km:9600}},
    {id:2,placa:'BBB2B22',modelo:'Carro',tipo_medida:'km',parametros:{km:1000}},
    {id:3,placa:'CCC3C33',modelo:'Trator',tipo_medida:'horas',parametros:{horas:300}},
    {id:4,placa:'DDD4D44',modelo:'Sem plano',tipo_medida:'km',parametros:{km:10}},
    {id:5,placa:'EEE5E55',modelo:'Excluído',tipo_medida:'km',parametros:{km:1},excluido:true},
  ];
  ctx.db.planos_manutencao=[
    {id:10,equipamento_id:1,descricao:'Óleo motor',intervalo_km:10000,ultimo_km:0,ativo:true},
    {id:11,equipamento_id:1,descricao:'Filtro de ar',intervalo_km:20000,ultimo_km:0,ativo:true},
    {id:20,equipamento_id:2,descricao:'Óleo motor',intervalo_km:10000,ultimo_km:0,ativo:true},
    {id:21,equipamento_id:2,descricao:'Item inativo',intervalo_km:100,ultimo_km:0,ativo:false},
    {id:30,equipamento_id:3,descricao:'Óleo hidráulico',intervalo_horas:250,ultimo_horas:0,ativo:true},
    {id:31,equipamento_id:3,descricao:'Item suspeito',intervalo_horas:500,ultimo_horas:900,ativo:true},
  ];
  ctx.db.ordens_servico=[{numero:'0001',equipamento_id:1,tipo:'Preventiva',status:'aberta'},{numero:'0002',equipamento_id:2,tipo:'Corretiva',status:'aberta'}];
  ctx.db.movimentos_combustivel=[
    {equipamento_id:1,data:isoDias(-10,hoje),hodometro:9100,litros:50},{equipamento_id:1,data:isoDias(0,hoje),hodometro:9600,litros:50},
    {equipamento_id:2,data:isoDias(-3,hoje),hodometro:900,litros:30,inconsistencia:'pendente'},
  ];
  const { rows, resumo } = ctx._pcmAnalisar(hoje);
  assert.equal(JSON.stringify(rows.map(r=>r.eq.placa)),JSON.stringify(['CCC3C33','AAA1A11','BBB2B22']),'ordenado do mais crítico para o menos');
  assert.equal(JSON.stringify(rows.map(r=>r.nivel)),JSON.stringify(['vencida','vencendo','em_dia']));
  assert.equal(resumo.total,3); assert.equal(resumo.vencida,1); assert.equal(resumo.vencendo,1); assert.equal(resumo.em_dia,1); assert.equal(resumo.atencao,0);
  assert.equal(resumo.semPlano,1,'equipamento sem plano é contado à parte; excluído é ignorado');
  const caminhao=rows[1];
  assert.equal(caminhao.pior.p.descricao,'Óleo motor'); assert.equal(caminhao.pior.s.saldoKm,400);
  assert.equal(Math.round(caminhao.media.media),50); assert.equal(caminhao.pior.proj.dias,8);
  assert.equal(caminhao.osAbertas.length,1,'OS preventiva aberta aparece');
  assert.equal(rows[2].osAbertas.length,0,'OS corretiva não conta como preventiva aberta');
  assert.equal(rows[2].itens.length,1,'item inativo é ignorado');
  assert.ok(rows[0].suspeitas.some(t=>t.includes('Item suspeito')),'última execução > leitura atual é sinalizada');
  assert.ok(rows[2].suspeitas.some(t=>t.includes('pendente')),'abastecimento pendente é sinalizado');
  console.log('PASS: análise da frota — prioridade, resumo, OS aberta e leituras suspeitas.');
}

// ── OS preventiva automática: número e medidor ──
{
  ctx.db.ordens_servico=[{numero:'0003'},{numero:'0010'},{numero:'0007',excluido:true},{numero:null}];
  assert.equal(ctx._proximoNumeroOS(),'0011','máximo + 1 (não quantidade + 1)');
  ctx.db.ordens_servico=[]; assert.equal(ctx._proximoNumeroOS(),'0001');
  assert.equal(ctx._osMedidorEquip({tipo_medida:'km',parametros:{km:5000,horas:99}}),5000);
  assert.equal(ctx._osMedidorEquip({tipo_medida:'horas',parametros:{km:5000,horas:99}}),99);
  ctx.db.centros_custo=[{id:1,nome:'LOJAS'},{id:2,nome:' Oficina ',ativo:true}];
  assert.equal(ctx._centroCustoPadraoPreventiva(),2);
  ctx.db.centros_custo=[{id:1,nome:'LOJAS'}]; assert.equal(ctx._centroCustoPadraoPreventiva(),null);
  const gen=functionSource('gerarOSPreventivas');
  assert.match(gen,/tipo_manutencao:'preventiva_planejada'/); assert.match(gen,/_proximoNumeroOS\(\)/);
  assert.match(gen,/centro_custo_id:_centroCustoPadraoPreventiva\(\)/);
  assert.doesNotMatch(gen,/db\.ordens_servico\.length\+1/);
  console.log('PASS: OS preventiva automática usa max+1, tipo_manutencao válido, centro de custo e medidor do equipamento.');
}
