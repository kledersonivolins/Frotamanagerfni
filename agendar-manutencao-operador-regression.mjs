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

// ── Teste 1: menu, título e mapa de páginas contêm "Agendar Manutenção" para operador ──
{
  assert.match(html, /\{\s*page:'agendar_manutencao',\s*icon:'fa-calendar-plus',\s*label:'Agendar Manutenção',\s*min:'operador'\s*\}/,
    'MENU deve conter item Agendar Manutenção acessível a partir do nível operador');
  assert.match(html, /agendar_manutencao:'🗓️ Agendar Manutenção'/, 'PAGE_TITLES deve ter título de Agendar Manutenção');
  assert.match(html, /agendar_manutencao:\s*renderAgendarManutencao/, 'PAGE_FNS deve mapear agendar_manutencao para renderAgendarManutencao');
  console.log('PASS: item de menu, título e função de renderização de "Agendar Manutenção" estão registrados.');
}

// ── Teste 2: _disponibilidadeEq classifica corretamente cada situação do veículo ──
{
  const context = vm.createContext({
    String,
    _osVisiveis: ()=>[{equipamento_id:2,numero:'0099',status:'aberta'}],
    _isOSAbertaOperacional: (o)=>!!o && o.status==='aberta',
    _preOSAbertasDoEquipamento: (id)=> String(id)==='3' ? [{numero:'0050'}] : [],
  });
  vm.runInContext(functionSource('_disponibilidadeEq'), context);

  const livre    = context._disponibilidadeEq({id:1});
  const ocupado  = context._disponibilidadeEq({id:2});
  const comPreOS = context._disponibilidadeEq({id:3});

  assert.equal(livre.key, 'livre', 'veículo sem OS aberta e sem Pré-OS deve estar livre');
  assert.equal(ocupado.key, 'em_manutencao', 'veículo com OS operacional aberta deve estar em manutenção');
  assert.equal(ocupado.ref, 'OS #0099', 'referência deve citar o número da OS aberta');
  assert.equal(comPreOS.key, 'pre_os', 'veículo com Pré-OS pendente deve ser sinalizado');
  assert.equal(comPreOS.ref, '#0050', 'referência deve citar o número da Pré-OS pendente');
  console.log('PASS: _disponibilidadeEq distingue livre / em manutenção / Pré-OS pendente.');
}

// ── Teste 3: _calcPermanenciaOS calcula dias/horas/minutos de permanência no pátio ──
{
  const context = vm.createContext({
    Date, Math, String,
    fmtDt: (d)=> d ? String(d).split('-').reverse().join('/') : '-',
  });
  vm.runInContext(functionSource('_calcPermanenciaOS'), context);

  // OS encerrada: 10/09 08:00 -> 12/09 10:30 = 2 dias, 2 horas, 30 minutos
  const fechada = context._calcPermanenciaOS({
    data_abertura:'2026-09-10', hora_inicio:'08:00',
    data_conclusao:'2026-09-12', hora_fim:'10:30'
  });
  assert.equal(fechada.aberta, false, 'OS com data de saída deve ser tratada como encerrada');
  assert.equal(fechada.dias, 2);
  assert.equal(fechada.horas, 2);
  assert.equal(fechada.minutos, 30);

  // OS ainda aberta: calcula até agora
  const aberta = context._calcPermanenciaOS({ data_abertura:'2020-01-01', hora_inicio:'00:00' });
  assert.equal(aberta.aberta, true, 'OS sem data de saída deve ser tratada como ainda em aberto');
  assert.ok(aberta.dias > 1000, 'permanência de uma OS aberta desde 2020 deve somar milhares de dias');

  // Sem data de entrada não é possível calcular
  assert.equal(context._calcPermanenciaOS({}), null, 'sem data de entrada, o cálculo deve retornar null');
  console.log('PASS: _calcPermanenciaOS calcula corretamente permanência encerrada e em aberto.');
}

// ── Teste 4: impressão da OS não deve mais exibir valores financeiros ──
{
  const inicio = html.indexOf('function imprimirOS(i){');
  const fim = html.indexOf('function imprimirRelOSAbertas', inicio);
  assert.ok(inicio !== -1 && fim !== -1 && fim > inicio, 'função imprimirOS deve existir e ter função seguinte localizável');
  const bloco = html.slice(inicio, fim);

  assert.ok(!/Valores da OS/.test(bloco), 'página de "Valores da OS" não deve mais existir na impressão');
  assert.ok(!/Custo Lançado na OS/.test(bloco), '"Custo Lançado na OS" não deve mais ser impresso');
  assert.ok(!/Total Geral \(itens\)/.test(bloco), 'totais de itens (R$) não devem mais ser impressos');
  assert.ok(!/Peças \/ Materiais \/ Serviços/.test(bloco), 'tabela de peças/materiais com custo não deve mais ser impressa');

  // Garantir que nenhuma interpolação de valor monetário (R$ ...) restou na função inteira
  const temValorMonetario = /R\$\s*\$\{/.test(bloco);
  assert.equal(temValorMonetario, false, 'não deve haver nenhuma interpolação de valor em R$ na impressão da OS');

  assert.ok(/Diagnóstico do Engenheiro/.test(bloco), 'deve haver campo em branco de Diagnóstico do Engenheiro');
  assert.ok(/Diagnóstico do Mecânico/.test(bloco), 'deve haver campo em branco de Diagnóstico do Mecânico');
  assert.ok(/Observações Finais/.test(bloco), 'deve haver campo em branco de Observações Finais');
  assert.ok(/Tempo Total de Permanência no Pátio/.test(bloco), 'deve haver resumo do tempo de permanência no pátio');
  console.log('PASS: impressão da OS remove valores financeiros e inclui a nova página de resumo.');
}

console.log('\nTODOS OS TESTES PASSARAM: Agendar Manutenção (operador) + impressão de OS sem valores financeiros.');
