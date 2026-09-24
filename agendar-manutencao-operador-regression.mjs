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

// ── Teste 5: _kmAtualLabel lê km/horas atuais do equipamento conforme tipo_medida ──
{
  const context = vm.createContext({ String });
  vm.runInContext(functionSource('_kmAtualLabel'), context);

  const porKm = context._kmAtualLabel({ tipo_medida:'km', parametros:{ km:45230 } });
  assert.equal(porKm.valor, 45230, 'equipamento medido por km deve trazer o km atual');
  assert.equal(porKm.unidade, 'km', 'unidade deve ser km');

  const porHoras = context._kmAtualLabel({ tipo_medida:'horas', parametros:{ horas:1200 } });
  assert.equal(porHoras.valor, 1200, 'equipamento medido por horas deve trazer o horímetro atual');
  assert.equal(porHoras.unidade, 'h', 'unidade deve ser h (horímetro)');

  assert.equal(context._kmAtualLabel({ tipo_medida:'km', parametros:{} }), null, 'sem valor registrado, deve retornar null');
  assert.equal(context._kmAtualLabel(null), null, 'sem equipamento, deve retornar null');
  console.log('PASS: _kmAtualLabel lê o parâmetro certo conforme o tipo de medida do equipamento.');
}

// ── Teste 6: _mediaPermanenciaDias calcula a média histórica de permanência em dias ──
{
  const context = vm.createContext({ String, Date, Math, fmtDt: d=>d });
  vm.runInContext(functionSource('_calcPermanenciaOS'), context);
  vm.runInContext(functionSource('_mediaPermanenciaDias'), context);

  // Duas OS encerradas: 2 dias e 4 dias de permanência -> média 3
  const os = [
    { data_abertura:'2026-09-01', hora_inicio:'08:00', data_conclusao:'2026-09-03', hora_fim:'08:00' },
    { data_abertura:'2026-09-01', hora_inicio:'08:00', data_conclusao:'2026-09-05', hora_fim:'08:00' },
  ];
  assert.equal(context._mediaPermanenciaDias(os), 3, 'média de 2 e 4 dias de permanência deve ser 3');

  // OS ainda aberta não entra na média (histórico só conta OS já concluídas)
  const comAberta = [...os, { data_abertura:'2026-09-01', hora_inicio:'08:00' }];
  assert.equal(context._mediaPermanenciaDias(comAberta), 3, 'OS em aberto não deve entrar na média histórica');

  assert.equal(context._mediaPermanenciaDias([]), null, 'sem histórico, não há média a calcular');
  assert.equal(context._mediaPermanenciaDias(undefined), null, 'lista ausente também deve retornar null');
  console.log('PASS: _mediaPermanenciaDias calcula a média de permanência ignorando OS ainda abertas.');
}

// ── Teste 7: _prognosticoTexto informa previsão de conclusão a partir da média histórica ──
{
  const context = vm.createContext({ String, Date, Math });
  vm.runInContext(functionSource('_prognosticoTexto'), context);

  assert.equal(
    context._prognosticoTexto('2026-10-01', 2.4),
    '≈2 dias · previsão de conclusão: 03/10',
    'deve arredondar a média e somar à data escolhida'
  );
  assert.equal(
    context._prognosticoTexto('2026-10-01', 0.4),
    '≈1 dia · previsão de conclusão: 02/10',
    'previsão mínima é de 1 dia, no singular'
  );
  assert.equal(
    context._prognosticoTexto('2026-10-01', null),
    'Sem histórico suficiente para estimar prazo.',
    'sem média histórica, deve avisar que não há estimativa'
  );
  console.log('PASS: _prognosticoTexto informa a previsão de conclusão com base na média histórica.');
}

// ── Teste 8: modal de agendamento reaproveita o calendário/vagas do link externo ──
{
  const modal = functionSource('_abrirModalAgendamento');
  assert.match(modal, /id="agm_motorista"/, 'modal deve ter campo de motorista responsável (texto livre)');
  assert.match(modal, /id="agm_km"/, 'modal deve ter campo de km/horas atual');
  assert.match(modal, /id="agm_cal"/, 'modal deve ter o contêiner do calendário do mês');
  assert.match(modal, /id="agm_slots"/, 'modal deve ter o contêiner da grade de horários/vagas');
  assert.match(modal, /id="agm_prognostico"/, 'modal deve ter o contêiner do prognóstico de conclusão');

  assert.notEqual(html.indexOf('function _agmCarregarMes('), -1, '_agmCarregarMes deve existir para popular o calendário do mês');
  assert.notEqual(html.indexOf('function _agmCarregarSlots('), -1, '_agmCarregarSlots deve existir para popular a grade de horários');

  const carregarMes = functionSource('_agmCarregarMes');
  assert.match(carregarMes, /agendamento_ocupacao_mes/, '_agmCarregarMes deve reaproveitar a RPC agendamento_ocupacao_mes do link externo');

  const carregarSlots = functionSource('_agmCarregarSlots');
  assert.match(carregarSlots, /agendamento_ocupacao_dia/, '_agmCarregarSlots deve reaproveitar a RPC agendamento_ocupacao_dia do link externo');
  assert.match(carregarSlots, /_mediaPermanenciaDias/, '_agmCarregarSlots deve calcular a média histórica de permanência');
  assert.match(carregarSlots, /_prognosticoTexto/, '_agmCarregarSlots deve exibir o prognóstico de conclusão');

  const salvar = functionSource('_salvarAgendamentoOperador');
  assert.match(salvar, /motorista_responsavel/, '_salvarAgendamentoOperador deve persistir o motorista responsável');
  assert.match(salvar, /km_atual_agendamento/, '_salvarAgendamentoOperador deve persistir o km/horas atual informado');
  assert.match(salvar, /agendamento_ocupacao_dia/, '_salvarAgendamentoOperador deve revalidar a vaga do horário antes de gravar');
  console.log('PASS: modal de Agendar Manutenção reaproveita calendário, vagas e prognóstico do link externo, e persiste motorista/km.');
}

// ── Teste 9: "Meus Agendamentos" exibe motorista responsável e km/horas informados ──
{
  const render = functionSource('renderAgendarManutencao');
  assert.match(render, /Motorista/, 'tabela de Meus Agendamentos deve ter coluna Motorista');
  assert.match(render, /motorista_responsavel/, 'tabela de Meus Agendamentos deve exibir o motorista_responsavel de cada OS');
  assert.match(render, /km_atual_agendamento/, 'tabela de Meus Agendamentos deve exibir o km_atual_agendamento de cada OS');
  console.log('PASS: "Meus Agendamentos" exibe motorista responsável e km/horas registrados no agendamento.');
}

// ── Teste 10: _empresaTemOSAbertaBloqueio detecta OS de agendamento ainda sem baixa ──
{
  const context = vm.createContext({ String });
  vm.runInContext(functionSource('_empresaTemOSAbertaBloqueio'), context);

  const comPreOS = [{ empresa_id:1778591635572, status:'pre_os', origem:'agendamento_operador' }];
  assert.equal(context._empresaTemOSAbertaBloqueio(1778591635572, comPreOS), true, 'Pré-OS sem baixa deve bloquear novo agendamento da mesma empresa');

  const emAndamento = [{ empresa_id:1778591635572, status:'em_andamento', origem:'agendamento_externo' }];
  assert.equal(context._empresaTemOSAbertaBloqueio(1778591635572, emAndamento), true, 'OS em andamento também bloqueia');

  const concluida = [{ empresa_id:1778591635572, status:'concluida', origem:'agendamento_operador' }];
  assert.equal(context._empresaTemOSAbertaBloqueio(1778591635572, concluida), false, 'OS já concluída (com baixa) não bloqueia');

  const outraEmpresa = [{ empresa_id:999, status:'pre_os', origem:'agendamento_operador' }];
  assert.equal(context._empresaTemOSAbertaBloqueio(1778591635572, outraEmpresa), false, 'OS aberta de outra empresa não bloqueia');

  const excluida = [{ empresa_id:1778591635572, status:'pre_os', origem:'agendamento_operador', excluido:true }];
  assert.equal(context._empresaTemOSAbertaBloqueio(1778591635572, excluida), false, 'OS excluída não conta');

  const osManual = [{ empresa_id:1778591635572, status:'aberta', origem:null }];
  assert.equal(context._empresaTemOSAbertaBloqueio(1778591635572, osManual), false, 'OS aberta manualmente (fora do agendamento) não entra nessa checagem');

  console.log('PASS: _empresaTemOSAbertaBloqueio detecta corretamente OS de agendamento ainda sem baixa da mesma empresa.');
}

// ── Teste 11: modal de agendamento bloqueia a FERRO LESTE enquanto ela tiver OS aberta ──
{
  const modal = functionSource('_abrirModalAgendamento');
  assert.match(modal, /1778591635572/, 'modal deve checar o empresa_id da FERRO LESTE (1778591635572)');
  assert.match(modal, /_empresaTemOSAbertaBloqueio/, 'modal deve usar _empresaTemOSAbertaBloqueio antes de liberar o formulário');
  console.log('PASS: modal de Agendar Manutenção bloqueia novo agendamento da FERRO LESTE enquanto houver OS aberta.');
}

console.log('\nTODOS OS TESTES PASSARAM: Agendar Manutenção (operador) + impressão de OS sem valores financeiros.');
