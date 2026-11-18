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
const J=v=>JSON.stringify(v);
const modais=[];
const ctx=vm.createContext({Math,Number,String,Date,Array,Set,isNaN,isFinite,Object,JSON,parseInt,parseFloat,console,
  db:{}, esc:v=>String(v??''), fmt:n=>String(n), today:()=>'2026-11-18', _resumoIntervaloPlano:()=> '10000 km',
  openModal:(t,h)=>modais.push({t,h}) });
for(const f of ['_osJsonArr','_osPlanosRelacionados','_osLeituraExec','_osAplicarExecPlano','_osSugerirExecucaoPlano',
  '_combConsumoTrechos','_combMediana','_combPadraoConsumo','_combAnomaliasConsumo']) vm.runInContext(functionSource(f),ctx);

const planos=[
  {id:1,equipamento_id:7,descricao:'Troca de óleo motor',pecas:[{descricao:'Óleo 15W40',referencia:'TOP TURBO PRO15W40'},{descricao:'Filtro lubrificante',referencia:'WEGA WO750'}],intervalo_km:10000,ultimo_km:100000,ativo:true},
  {id:2,equipamento_id:7,descricao:'Filtro de ar primário',pecas:'[{"descricao":"Filtro de ar","referencia":"TECFIL ARS5574"}]',intervalo_km:20000,ultimo_km:100000,ativo:true},
  {id:3,equipamento_id:7,descricao:'Óleo diferencial',intervalo_km:40000,ultimo_km:80000,ativo:true},
  {id:4,equipamento_id:7,descricao:'Item inativo WO750',ativo:false},
  {id:5,equipamento_id:8,descricao:'Troca de óleo motor',ativo:true},
];

// ── Quais itens do plano a OS executou ──
{
  const os={id:50,numero:'0123',tipo:'Corretiva',equipamento_id:7,descricao:'Vazamento no cárter',
    itens:J([{descricao:'Filtro lubrificante',referencia:'WEGA WO750',status_exec:'executado'},{descricao:'Filtro de ar',referencia:'TECFIL ARS5574',status_exec:'nao_executado'}])};
  const rel=ctx._osPlanosRelacionados(os,planos);
  assert.equal(J(rel.map(r=>r.p.id)),J([1,2,3]),'só planos ativos do mesmo equipamento, com os encontrados primeiro');
  assert.equal(rel.find(r=>r.p.id===1).match,true,'referência da peça do plano bate com item da OS');
  assert.equal(rel.find(r=>r.p.id===2).match,false,'item marcado como não executado não conta');
  assert.equal(rel.find(r=>r.p.id===3).match,false);
  const os2={id:51,numero:'0124',tipo:'Preventiva',equipamento_id:7,plano_id:3,descricao:'[PREVENTIVA AUTOMÁTICA]\n• Filtro de ar primário (Motor) — VENCIDO',itens:[]};
  const rel2=ctx._osPlanosRelacionados(os2,planos);
  assert.equal(rel2.find(r=>r.p.id===3).motivo,'plano da OS');
  assert.equal(rel2.find(r=>r.p.id===2).motivo,'descrição da OS','OS automática lista os planos na descrição');
  console.log('PASS: identifica os itens do plano executados na OS (plano da OS, peças, descrição).');
}

// ── Leitura usada na execução ──
{
  const eqKm={tipo_medida:'km',parametros:{km:999}}, eqH={tipo_medida:'horas',parametros:{horas:50}};
  assert.equal(ctx._osLeituraExec({km_fechamento:120000,km_abertura:119000,hodometro:119000},eqKm),120000);
  assert.equal(ctx._osLeituraExec({km_abertura:119000},eqKm),119000);
  assert.equal(ctx._osLeituraExec({},eqKm),999);
  assert.equal(ctx._osLeituraExec({horimetro_fechamento:70,km_fechamento:5},eqH),70);
  console.log('PASS: leitura da execução vem do fechamento da OS conforme km/horímetro.');
}

// ── Zerar o contador (sem gravar) ──
{
  const os={numero:'0123',tipo:'Preventiva',responsavel:'ADRIANO'};
  const r=ctx._osAplicarExecPlano(os,{tipo_medida:'km'},planos,['1','3'],110500,'2026-11-18');
  assert.equal(r.atualizados.length,2);
  assert.equal(J(r.atualizados[0].mudancas),J({ultima_data:'2026-11-18',ultimo_km:110500,proximo_km:120500}));
  assert.equal(r.registros[0].obs,'Executado via OS #0123 (Preventiva)','histórico aponta para a OS');
  assert.equal(r.registros[0].origem,'os_preventiva'); assert.equal(r.registros[0].plano_id,1); assert.equal(r.registros[0].hodometro,110500);
  assert.equal(r.registros[0].responsavel,'ADRIANO');
  const campos=Object.keys(r.registros[0]).sort().join(',');
  assert.equal(campos,'custo,data,data_conclusao,equipamento_id,hodometro,obs,origem,plano_id,proxima_hora,proximo_km,responsavel,servico,status,tipo,tipo_medida,ultimo_horas,ultimo_km',
    'mesmos campos que "Registrar execução" já grava em manutencoes');
  // leitura menor que a última execução: não retrocede
  const r2=ctx._osAplicarExecPlano(os,{tipo_medida:'km'},planos,['1'],90000,'2026-11-18');
  assert.equal(r2.atualizados.length,0); assert.match(r2.ignorados[0].motivo,/menor que a última/);
  assert.equal(ctx._osAplicarExecPlano(os,{tipo_medida:'km'},planos,['1'],0,'2026-11-18').ignorados.length,1,'sem leitura não altera');
  // equipamento por horas
  const r3=ctx._osAplicarExecPlano({numero:'9',tipo:'Corretiva'},{tipo_medida:'horas'},[{id:9,equipamento_id:1,descricao:'Óleo',intervalo_horas:250,ultimo_horas:1000}],['9'],1260,'2026-11-18');
  assert.equal(J(r3.atualizados[0].mudancas),J({ultima_data:'2026-11-18',ultimo_horas:1260,proxima_hora:1510}));
  assert.equal(r3.registros[0].origem,'os_corretiva'); assert.equal(r3.registros[0].tipo_medida,'h');
  console.log('PASS: zera o contador dos itens marcados, sem retroceder, e registra o histórico com a OS.');
}

// ── Quando perguntar ──
{
  ctx.db={ equipamentos:[{id:7,tipo_medida:'km',parametros:{km:110000}}], planos_manutencao:planos, ordens_servico:[
    {id:60,numero:'0200',tipo:'Corretiva',status:'concluida',equipamento_id:7,descricao:'Troca de lâmpada',itens:[]},
    {id:61,numero:'0201',tipo:'Corretiva',status:'concluida',equipamento_id:7,descricao:'Vazamento',itens:[{descricao:'Filtro',referencia:'WEGA WO750'}]},
    {id:62,numero:'0202',tipo:'Preventiva',status:'concluida',equipamento_id:7,km_fechamento:110200,itens:[{descricao:'Óleo',referencia:'TOP TURBO PRO15W40'}]},
    {id:63,numero:'0203',tipo:'Preventiva',status:'aberta',equipamento_id:7,itens:[]} ]};
  modais.length=0; ctx._osSugerirExecucaoPlano(60); assert.equal(modais.length,0,'corretiva sem item do plano não pergunta');
  ctx._osSugerirExecucaoPlano(63); assert.equal(modais.length,0,'OS não concluída não pergunta');
  ctx._osSugerirExecucaoPlano(61); assert.equal(modais.length,1,'corretiva que trocou item do plano pergunta');
  assert.match(modais[0].h,/corretiva/); assert.doesNotMatch(modais[0].h,/checked/,'na corretiva nada vem marcado');
  assert.doesNotMatch(modais[0].h,/Óleo diferencial/,'na corretiva só mostra os itens encontrados');
  ctx._osSugerirExecucaoPlano(62); assert.equal(modais.length,2);
  assert.match(modais[1].h,/value="1" checked/,'na preventiva o item da OS vem marcado');
  assert.match(modais[1].h,/value="3" >/,'na preventiva os demais itens aparecem desmarcados');
  assert.match(modais[1].h,/value="110200"/,'leitura do fechamento da OS');
  assert.match(modais[1].h,/Pular/);
  const baixa=functionSource('confirmarBaixaOS');
  assert.match(baixa,/_osSugerirExecucaoPlano\(db\.ordens_servico\[i\]\.id\)/,'conclusão da OS abre a confirmação');
  assert.doesNotMatch(baixa,/ciclo\(s\) reiniciado/);
  console.log('PASS: confirmação aparece na preventiva concluída e na corretiva que trocou item do plano.');
}

// ── Consumo por trecho entre abastecimentos ──
{
  const hoje=new Date(2026,10,18,12);
  const d=n=>{ const x=new Date(hoje.getTime()-n*864e5); return x.toISOString().slice(0,10); };
  const mov=(dias,hod,lt,extra={})=>({equipamento_id:1,data:d(dias),hodometro:hod,litros:lt,...extra});
  ctx.db={ movimentos_combustivel:[mov(60,10000,100),mov(50,10250,100),mov(40,10500,100),mov(30,10750,100),mov(20,11000,100),
    mov(10,11100,100), mov(5,99999,50,{inconsistencia:'pendente'}), mov(3,11350,100,{excluido:true}), mov(1,11350,100)] };
  const tr=ctx._combConsumoTrechos(1,true);
  assert.equal(J(tr.map(t=>t.consumo)),J([2.5,2.5,2.5,2.5,1,2.5]),'km/L por trecho, sem pendente/excluído');
  assert.equal(ctx._combMediana([3,1,2]),2); assert.equal(ctx._combMediana([1,2,3,4]),2.5); assert.equal(ctx._combMediana([]),null);
  const eq={id:1,tipo_medida:'km'};
  assert.equal(J(ctx._combPadraoConsumo(eq,true)),J({valor:2.5,fonte:'mediana histórica',limite:35}));
  assert.equal(J(ctx._combPadraoConsumo({...eq,media_padrao:'2,0'.replace(',','.')},true)),J({valor:2,fonte:'cadastro',limite:25}));
  const an=ctx._combAnomaliasConsumo(eq,hoje,30);
  assert.equal(an.length,1,'só o trecho de 1 km/L, dentro dos 30 dias'); assert.equal(an[0].desvio,-60); assert.equal(an[0].un,'km/L');
  assert.equal(ctx._combAnomaliasConsumo(eq,hoje,5).length,0,'fora da janela');
  // poucos trechos: sem padrão, sem alerta
  ctx.db={ movimentos_combustivel:[mov(3,100,10),mov(2,200,10),mov(1,250,10)] };
  assert.equal(ctx._combPadraoConsumo(eq,true),null); assert.equal(ctx._combAnomaliasConsumo(eq,hoje,30).length,0);
  // horas: L/h
  ctx.db={ movimentos_combustivel:[mov(4,1000,50),mov(3,1010,50),mov(2,1020,50),mov(1,1030,50),mov(0,1040,50)].map(m=>({...m,equipamento_id:2})) };
  assert.equal(J(ctx._combConsumoTrechos(2,false).map(t=>t.consumo)),J([5,5,5,5]));
  assert.match(functionSource('_combVerificarInconsistencia'),/_combPadraoConsumo\(eq, isTipoKm\)/,'lançamento usa padrão cadastrado ou histórico');
  assert.match(functionSource('_pcmAnalisar'),/_combAnomaliasConsumo\(eq, hoje, 30\)/,'Painel PCM mostra consumo fora do padrão');
  console.log('PASS: consumo por trecho, padrão (cadastro ou mediana) e anomalias nos últimos 30 dias.');
}
