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
const ctx=vm.createContext({Math,Number,String,Date,Array,Set,isNaN,isFinite,Object,JSON,parseInt,parseFloat});
for(const f of ['_eqTipoMedida','_eqMedidas','_ehFiltroTexto','_fichaTokens','_fichaMotivoForaFicha','_fichaTxt','_fichaNum','_fichaPlacaChave','_fichaNormDesc','_fichaEhFiltro','_fichaData','_fichaValorRotulo',
  '_fichaParseFicha','_fichaParseServicos','_fichaAnalisarAbas','_fichaAcharEquip','_fichaPlanejar']) vm.runInContext(functionSource(f),ctx);
const J=v=>JSON.stringify(v);

// Ficha no layout da FICHA DE CUSTEIO (aba "<MÊS> F"): cabeçalho, leituras, tabela de óleos e filtros
function ficha(mes, ini, fim, itens){
  const L=Array.from({length:21+itens.length+4},()=>Array(43).fill(null));
  L[0][0]='obs'; L[0][7]='CUSTEIO DE OPERAÇÃO E MANUTENÇÃO'; L[0][20]='MÊS/ANO:'; L[0][28]='EQUIPAMENTO:'; L[0][38]='ATIVO FIXO:';
  L[1][20]=mes; L[1][28]='CAVALO MECANICO'; L[1][38]='ABC 1D23';
  L[2][20]='OBRA:'; L[2][31]='MARCA/MODELO:'; L[2][39]='ANO:';
  L[3][31]='VOLVO FH 440'; L[3][39]='2009/2010';
  L[4][20]='TRECHO:'; L[4][33]='SÉRIE: PLACA ABC-1D23 (123456789 RENAVAN )';
  L[5][33]='9BVAS02C9AE000001';
  L[7][4]='HORAS OU KMs TRABALHADOS'; L[7][38]=fim-ini;
  L[9][4]='HORAS OU KMs LEITURAS DIRETA'; L[9][6]=ini; L[9][38]=fim;
  L[20][0]='PERÍODO TROCA OU VER.'; L[20][1]='TROCADO OU REVISADO'; L[20][3]='ÓLEOS E FILTROS RECOMENDADOS'; L[20][5]='COMPAR-TIMENTO'; L[20][6]='CAP';
  itens.forEach((it,i)=>{ const r=L[21+i]; r[0]=it[0]; r[1]=it[1]; r[2]=it[0]&&it[1]?it[0]+it[1]:it[0]; r[3]=it[2]; r[5]=it[3]; r[6]=it[4]; });
  L[21+itens.length+1][5]='GRAXA LITIO';
  return L;
}
function servicos(lin){
  const L=[['SERVIÇO(S) EXECUTADO',null,null,null,null,null,'PEÇAS APLICADAS'],
    ['ÍTEM','DATA','HR / KM','TIPO SERVIÇO','VALOR',null,'ÍTEM','DATA','HR / KM','DESDISCRIMINAÇÃO','REFERÊNCIA','UND','QUANT.','UNIT','TOTAL']];
  lin.forEach((x,i)=>L.push([i+1,x.data,null,x.desc,x.valor,null,i+1,x.pdata||null,null,x.peca||null,null,null,x.qtd||null,null,x.total||0]));
  L.push(['TOTAL SERVIÇOS']);
  return L;
}
const atual=[[null,null,'DIESEL','TANQUE',615],[10000,500000,'WEGA FCD2207',null,1],[10000,500000,'TOP TURBO PRO15W40','MOTOR D13',37],[10000,500000,'WEGA WO750',null,1],
  [40000,null,'MANN TB1374/13','FILTRO SECADOR',1],[40000,500000,'LUBRAX GOLD XP 75W80','CX MARCHA',17],[40000,500000,'TECFIL PEH314',null,1],[20000,500000,'TECFIL ARS 5574','FILTRO DE AR 1º',1]];
const antigo=[[15000,100,'DONALD P550425','MOTOR D13',1],[15000,100,'TOP TURBO PRO15W40',null,37]];
// a ordem das abas NÃO é cronológica (como na planilha real): a mais recente fica no meio
const abas=[
  {nome:'MAIO 25 F', linhas:ficha('MAIO 2025',480000,490000,antigo)},
  {nome:'NOVEMBRO 26 F', linhas:ficha('NOVEMBRO 2026',500300,500400,atual)},
  {nome:'NOVEMBRO 26 V ', linhas:servicos([{data:'2026-11-12T00:00:00',desc:'CONFECAO MANGUEIRA',valor:186.3},{data:null,desc:'',valor:0,pdata:'12/11/2026',peca:'MANGUEIRA 1/2',qtd:2,total:80}])},
  {nome:'OUTUBRO 26 F', linhas:ficha('JULHO 2026',500000,500300,atual)},
];

// ── Escolha da aba e cabeçalho ──
const r=ctx._fichaAnalisarAbas(abas);
const f=r.fichas[0];
{
  assert.equal(J(r.fichas.map(x=>x.nome)),J(['NOVEMBRO 26 F','OUTUBRO 26 F','MAIO 25 F']),'mais recente pela leitura, não pelo nome/posição');
  assert.equal(f.leitura,500400);
  assert.equal(f.placa,'ABC1D23','placa com hífen e Mercosul');
  assert.equal(f.chassi,'9BVAS02C9AE000001'); assert.equal(f.modelo,'VOLVO FH 440'); assert.equal(f.mesAno,'NOVEMBRO 2026');
  assert.equal(f.anoFab,2009); assert.equal(f.anoMod,2010); assert.equal(f.equipamento,'CAVALO MECANICO');
  console.log('PASS: usa a ficha mais recente pela leitura e lê placa, chassi, modelo, ano e mês.');
}
// ── Itens ──
{
  assert.equal(f.itens.length,7); assert.equal(J(f.ignorados.map(x=>x.descricao)),J(['DIESEL']),'sem intervalo é ignorado');
  const it=d=>f.itens.find(x=>x.descricao===d);
  assert.equal(it('WEGA FCD2207').compartimento,'MOTOR D13','filtro herda o compartimento do bloco (linha de baixo)');
  assert.equal(it('WEGA WO750').compartimento,'MOTOR D13','filtro herda o compartimento do bloco (linha de cima)');
  assert.equal(it('TECFIL PEH314').compartimento,'CX MARCHA');
  assert.equal(it('MANN TB1374/13').ultimo,0,'última troca vazia = 0');
  assert.equal(it('TOP TURBO PRO15W40').unidade,'L'); assert.equal(it('TOP TURBO PRO15W40').capacidade,37); assert.equal(it('WEGA WO750').unidade,'un');
  assert.ok(!f.itens.some(x=>/GRAXA/.test(x.compartimento) && !x.descricao),'linha só com compartimento não vira item');
  console.log('PASS: itens com intervalo, última troca, compartimento herdado e capacidade.');
}
// ── Serviços da aba V correspondente ──
{
  assert.equal(f.servicosAba.nome,'NOVEMBRO 26 V ');
  assert.equal(J(f.servicosAba.servicos),J([{data:'2026-11-12',medida:null,descricao:'CONFECAO MANGUEIRA',valor:186.3}]));
  assert.equal(f.servicosAba.pecas[0].data,'2026-11-12'); assert.equal(f.servicosAba.pecas[0].total,80);
  assert.equal(r.fichas[1].servicosAba,null,'OUTUBRO sem aba V');
  assert.equal(ctx._fichaData(46338),'2026-11-12','data serial do Excel');
  console.log('PASS: serviços/peças da aba V do mesmo mês.');
}
// ── Vínculo com o equipamento ──
{
  const eqs=[{id:1,placa:'XYZ9999'},{id:2,placa:'abc-1323'},{id:3,placa:'ZZZ0000',placa_anterior:'ABC1D23'}];
  assert.equal(ctx._fichaAcharEquip(f,eqs).id,2,'Mercosul ABC1D23 = ABC1323');
  assert.equal(ctx._fichaAcharEquip(f,[eqs[0],eqs[2]]).id,3,'também procura na placa anterior');
  assert.equal(ctx._fichaAcharEquip(f,[eqs[0]]),null);
  assert.equal(ctx._fichaPlacaChave('OVW3E65'),'OVW3465');
  console.log('PASS: vincula pela placa (hífen, Mercosul, placa anterior).');
}
// ── O que a importação faz ──
{
  const eq={id:2,placa:'ABC1323',tipo_medida:'km',parametros:{km:500100},chassi:'',ano_fabricacao:null,ano_modelo:2010};
  const planos=[
    {id:10,equipamento_id:2,descricao:'top turbo pro15w40',intervalo_km:15000,ultimo_km:100,ativo:true},        // atualizar (intervalo e troca)
    {id:11,equipamento_id:2,descricao:'WEGA WO750',intervalo_km:10000,ultimo_km:510000,compartimento:'X',ativo:true}, // app mais recente: mantém
    {id:12,equipamento_id:2,descricao:'DONALD P550425',intervalo_km:15000,ultimo_km:100,ativo:true},            // fora da ficha
    {id:13,equipamento_id:9,descricao:'WEGA FCD2207',intervalo_km:1,ativo:true},                               // outro equipamento
  ];
  const pl=ctx._fichaPlanejar(f,eq,planos,{});
  assert.equal(pl.novos.length,5);
  assert.equal(J(pl.atualizar.map(x=>[x.plano.id,x.mudancas])),J([[10,{intervalo_km:10000,ultimo_km:500000,compartimento:'MOTOR D13'}]]));
  const wo=pl.iguais.find(x=>x.plano.id===11);
  assert.ok(wo && /mais recente/.test(wo.notas[0]),'não volta a última troca para trás');
  assert.equal(J(pl.fora.map(p=>p.id)),J([12]));
  assert.equal(J(pl.cadastro),J({km:500400,chassi:'9BVAS02C9AE000001',ano_fabricacao:2009}),'só preenche o que está vazio; ano_modelo já existia');
  assert.equal(pl.leituraRef,500400);
  // leitura da ficha menor que a do cadastro: não retrocede e avisa
  const pl2=ctx._fichaPlanejar(f,{...eq,parametros:{km:600000}},planos,{});
  assert.equal(pl2.cadastro.km,undefined); assert.equal(pl2.avisos.length,1);
  // equipamento por horas grava nos campos de horas
  const pl3=ctx._fichaPlanejar(f,{id:5,tipo_medida:'horas',parametros:{horas:100}},[{id:20,equipamento_id:5,descricao:'WEGA WO750',intervalo_horas:250,ultimo_horas:0}],{});
  assert.equal(pl3.cInt,'intervalo_horas'); assert.equal(J(pl3.atualizar[0].mudancas),J({intervalo_horas:10000,ultimo_horas:500000,compartimento:'MOTOR D13'}));
  assert.equal(pl3.cadastro.horas,500400);
  console.log('PASS: prévia — novos, atualizações (sem retroceder), itens fora da ficha e cadastro só onde está vazio.');
}
// ── Tela: confirmação exige equipamento; painel tem botão de importar ──
{
  const imp=functionSource('_fichaImportar');
  assert.match(imp,/Selecione o equipamento para vincular/);
  assert.match(imp,/_fichaPlanejar\(/,'grava exatamente o que a prévia mostrou');
  assert.match(functionSource('renderPainelPCM'),/openModalImportarFicha\(\)/);
  assert.match(functionSource('renderPainelPCM'),/value="proximos"/,'ordenar por mais próximos');
  console.log('PASS: importação vinculada e acessível pelo Painel PCM.');
}

// ── Caso real S3 (empilhadeira, horas): itens antigos PM0xx em km ficam de fora e vêm sugeridos para desativar ──
{
  const eq={id:7,placa:'S3',tipo_medida:'horas',parametros:{km:19809000,horas:3116}};
  const ficha={leitura:3116,itens:[
    {descricao:'15W40 CK-4',compartimento:'MOTOR CUMMINS 4B3.9 (2302171)',intervalo:250,ultimo:2997},
    {descricao:'HYDRA HV 68',compartimento:'HIDRAULICO',intervalo:2000,ultimo:2471},
    {descricao:'ATF TDX DERON III',compartimento:'TRANS YQX 100',intervalo:750,ultimo:2471},
    {descricao:'DIF DIANT',compartimento:'80W90 GL5',intervalo:1000,ultimo:3109},
    {descricao:'CUBO LD',compartimento:'80W90 GL5',intervalo:1000,ultimo:3109},
  ]};
  const planos=[
    {id:40,equipamento_id:7,codigo:'PM040',descricao:'OLEO CUBO',compartimento:'CUBO LE',intervalo_km:1000,ultimo_horas:2418,ultima_data:'2026-04-29',ativo:true},
    {id:32,equipamento_id:7,codigo:'PM032',descricao:'OLEO HIDRAULICO',compartimento:'Sistema Hidráulico',intervalo_horas:2000,ultimo_horas:2418,ativo:true},
    {id:50,equipamento_id:7,codigo:'PM050',descricao:'GRAXA PINOS',compartimento:'CHASSI',intervalo_horas:50,ultimo_horas:3100,ativo:true},
  ];
  const pl=ctx._fichaPlanejar(ficha,eq,planos,{});
  assert.equal(J(pl.fora.map(p=>p.id).sort()),J([32,40,50]));
  assert.match(pl.foraMotivo[40],/km, mas o equipamento é medido em horas/);
  assert.match(pl.foraMotivo[32],/mesmo compartimento/);
  assert.equal(pl.foraMotivo[50],undefined,'item legítimo sem duplicado não vem marcado');
  assert.equal(pl.cadastro.km,0,'zera o km lixo de máquina medida em horas');
  assert.equal(pl.desativarIds.size,0,'sem escolha explícita não desativa nada');
  const pl2=ctx._fichaPlanejar(ficha,eq,planos,{desativarIds:['40','32']});
  assert.equal(J([...pl2.desativarIds].sort()),J(['32','40']));
  // veículo sem tipo informado: não zera km nem acusa unidade
  const pl3=ctx._fichaPlanejar(ficha,{id:7,parametros:{km:5000,horas:10}},planos,{});
  assert.equal(pl3.cadastro.km,undefined);
  assert.ok(!/medido em horas/.test(pl3.foraMotivo[40]||''));
  assert.match(functionSource('_fichaImportar'),/\.ficha-fora:checked/,'grava só os itens marcados na prévia');
  // S3 sem tipo no cadastro: deduz horas, grava o tipo e zera o km
  const pl4=ctx._fichaPlanejar(ficha,{id:7,placa:'S3',parametros:{km:19809000,horas:3116}},planos,{});
  assert.equal(pl4.ehKm,false); assert.equal(pl4.cadastro.tipo_medida,'horas'); assert.equal(pl4.cadastro.km,0);
  assert.match(pl4.foraMotivo[40],/medido em horas/);
  assert.ok(ctx._fichaEhFiltro('FLEET LF3345') && ctx._fichaEhFiltro('UNIFILTER UA13302P') && !ctx._fichaEhFiltro('15W40 CK-4'));
  console.log('PASS: S3 — itens antigos duplicados/unidade errada sugeridos para desativar, km lixo zerado.');
}
