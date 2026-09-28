import assert from 'node:assert/strict'
import test from 'node:test'
import { processarPasso, type ContextoPasso, type Empresa } from './conversa.ts'

const empresas: Empresa[] = [
  { id: 10, nome: 'Construtora Poty' },
  { id: 20, nome: 'Construtora BS' },
]

test('inicio sempre manda boas-vindas e pergunta o nome, ignorando a entrada', () => {
  const r = processarPasso('inicio', {}, 'oi', {})
  assert.equal(r.etapa, 'aguardando_nome')
  assert.deepEqual(r.dados, {})
  assert.match(r.respostas[0], /nome/i)
})

test('aguardando_nome com nome vazio repete a pergunta', () => {
  const r = processarPasso('aguardando_nome', {}, '   ', { empresas })
  assert.equal(r.etapa, 'aguardando_nome')
  assert.match(r.respostas[0], /não entendi/i)
})

test('aguardando_nome com nome válido guarda o nome e lista empresas', () => {
  const r = processarPasso('aguardando_nome', {}, 'Maria Silva', { empresas })
  assert.equal(r.etapa, 'aguardando_empresa')
  assert.equal(r.dados.nome, 'Maria Silva')
  assert.match(r.respostas[0], /1.*Construtora Poty/s)
  assert.match(r.respostas[0], /2.*Construtora BS/s)
})

test('aguardando_empresa com número válido avança para placa', () => {
  const r = processarPasso('aguardando_empresa', { nome: 'Maria' }, '2', { empresas })
  assert.equal(r.etapa, 'aguardando_placa')
  assert.equal(r.dados.empresaId, 20)
  assert.equal(r.dados.empresaNome, 'Construtora BS')
  assert.match(r.respostas[0], /placa/i)
})

test('aguardando_empresa aceita o nome da empresa por texto', () => {
  const r = processarPasso('aguardando_empresa', { nome: 'Maria' }, 'construtora poty', { empresas })
  assert.equal(r.dados.empresaId, 10)
})

test('aguardando_empresa com opção inválida repete a lista', () => {
  const r = processarPasso('aguardando_empresa', { nome: 'Maria' }, '9', { empresas })
  assert.equal(r.etapa, 'aguardando_empresa')
  assert.match(r.respostas[0], /não encontrei essa opção/i)
})

import type { Veiculo } from './conversa.ts'

const veiculos: Veiculo[] = [
  { id: 100, empresaId: 20, placa: 'ABC1234', modelo: 'Caminhão Munck' },
  { id: 101, empresaId: 20, placa: 'DEF5A67', modelo: 'Caminhonete' },
]

test('aguardando_placa aceita placa com hífen e casa com o cadastro', () => {
  const r = processarPasso(
    'aguardando_placa',
    { nome: 'Maria', empresaId: 20, empresaNome: 'Construtora BS', placaTentativas: 0 },
    'ABC-1234',
    { veiculosDaEmpresa: veiculos },
  )
  assert.equal(r.etapa, 'aguardando_tipo')
  assert.equal(r.dados.veiculoId, 100)
  assert.equal(r.dados.veiculoPlaca, 'ABC1234')
})

test('aguardando_placa aceita placa tudo junto minúscula', () => {
  const r = processarPasso(
    'aguardando_placa',
    { empresaId: 20, placaTentativas: 0 },
    'def5a67',
    { veiculosDaEmpresa: veiculos },
  )
  assert.equal(r.dados.veiculoId, 101)
})

test('aguardando_placa não encontrada pede de novo e conta tentativa', () => {
  const r = processarPasso(
    'aguardando_placa',
    { empresaId: 20, placaTentativas: 0 },
    'ZZZ9999',
    { veiculosDaEmpresa: veiculos },
  )
  assert.equal(r.etapa, 'aguardando_placa')
  assert.equal(r.dados.placaTentativas, 1)
  assert.match(r.respostas[0], /não encontrei/i)
})

test('aguardando_placa após 3 tentativas encaminha para atendimento humano', () => {
  const r = processarPasso(
    'aguardando_placa',
    { empresaId: 20, placaTentativas: 2 },
    'ZZZ9999',
    { veiculosDaEmpresa: veiculos },
  )
  assert.equal(r.etapa, 'encerrado_humano')
  assert.match(r.respostas[0], /99995-9427/)
})

test('aguardando_tipo com opção numerada avança para motivo', () => {
  const r = processarPasso('aguardando_tipo', { veiculoId: 100 }, '2', {})
  assert.equal(r.etapa, 'aguardando_motivo')
  assert.equal(r.dados.tipo, 'Corretiva')
})

test('aguardando_tipo aceita o nome do tipo por texto', () => {
  const r = processarPasso('aguardando_tipo', { veiculoId: 100 }, 'revisão', {})
  assert.equal(r.dados.tipo, 'Revisão')
})

test('aguardando_tipo com opção inválida repete a pergunta', () => {
  const r = processarPasso('aguardando_tipo', { veiculoId: 100 }, 'não sei', {})
  assert.equal(r.etapa, 'aguardando_tipo')
})

import type { DiaComVaga, HorarioComVaga } from './conversa.ts'

const dias: DiaComVaga[] = [
  { dia: '2026-10-01', vagasDia: 2 },
  { dia: '2026-10-02', vagasDia: 1 },
]
const horarios: HorarioComVaga[] = [
  { hora: 8, vagas: 2, capacidade: 3 },
  { hora: 9, vagas: 0, capacidade: 3 },
]

test('aguardando_motivo com texto guarda a descricao e lista os dias', () => {
  const r = processarPasso('aguardando_motivo', { tipo: 'Corretiva' }, 'Barulho no motor', { diasComVaga: dias })
  assert.equal(r.etapa, 'aguardando_dia')
  assert.equal(r.dados.descricao, 'Barulho no motor')
  assert.match(r.respostas[0], /01\/10/)
})

test('aguardando_motivo vazio repete a pergunta', () => {
  const r = processarPasso('aguardando_motivo', { tipo: 'Corretiva' }, '  ', { diasComVaga: dias })
  assert.equal(r.etapa, 'aguardando_motivo')
})

test('aguardando_motivo sem nenhum dia com vaga vai direto pra lista de espera', () => {
  const r = processarPasso('aguardando_motivo', { tipo: 'Corretiva' }, 'Revisao geral', { diasComVaga: [] })
  assert.equal(r.etapa, 'lista_espera')
  assert.match(r.respostas[0], /lista de espera/i)
})

test('aguardando_dia com numero valido lista horarios livres', () => {
  const r = processarPasso('aguardando_dia', { descricao: 'x' }, '1', { diasComVaga: dias, horariosDoDia: horarios })
  assert.equal(r.etapa, 'aguardando_hora')
  assert.equal(r.dados.dia, '2026-10-01')
  assert.match(r.respostas[0], /08:00/)
  assert.doesNotMatch(r.respostas[0], /09:00/)
})

test('aguardando_dia com opcao invalida repete a lista', () => {
  const r = processarPasso('aguardando_dia', {}, '9', { diasComVaga: dias })
  assert.equal(r.etapa, 'aguardando_dia')
})

test('aguardando_hora com numero valido avanca para confirmacao', () => {
  const r = processarPasso(
    'aguardando_hora', { dia: '2026-10-01', descricao: 'x' }, '1',
    { horariosDoDia: horarios },
  )
  assert.equal(r.etapa, 'confirmando')
  assert.equal(r.dados.hora, '08:00')
  assert.match(r.respostas[0], /SIM/)
})

test('aguardando_hora quando o dia acabou de lotar volta pra escolher outro dia', () => {
  const r = processarPasso(
    'aguardando_hora', { dia: '2026-10-01' }, '1',
    { horariosDoDia: [], diasComVaga: dias },
  )
  assert.equal(r.etapa, 'aguardando_dia')
  assert.match(r.respostas[0], /acabou de lotar/i)
})

import { finalizarComProtocolo, falhaAoConfirmar } from './conversa.ts'

const dadosConfirmando = {
  nome: 'Maria', empresaNome: 'Construtora BS', veiculoPlaca: 'ABC1234',
  tipo: 'Corretiva', descricao: 'Barulho no motor', dia: '2026-10-01', hora: '08:00',
}

test('confirmando com SIM sinaliza acao pendente de criar agendamento', () => {
  const r = processarPasso('confirmando', dadosConfirmando, 'sim', {})
  assert.equal(r.etapa, 'confirmando')
  assert.equal(r.acaoPendente, 'criar_agendamento')
})

test('confirmando com NAO cancela e finaliza', () => {
  const r = processarPasso('confirmando', dadosConfirmando, 'nao', {})
  assert.equal(r.etapa, 'finalizado')
  assert.equal(r.acaoPendente, undefined)
  assert.match(r.respostas[0], /cancelado/i)
})

test('confirmando com resposta ambigua repete a pergunta', () => {
  const r = processarPasso('confirmando', dadosConfirmando, 'talvez', {})
  assert.equal(r.etapa, 'confirmando')
  assert.equal(r.acaoPendente, undefined)
  assert.match(r.respostas[0], /SIM.*NÃO/s)
})

test('finalizarComProtocolo com status autorizado confirma vaga', () => {
  const r = finalizarComProtocolo(dadosConfirmando, 'AG-123', 'autorizado')
  assert.equal(r.etapa, 'finalizado')
  assert.match(r.respostas[0], /AG-123/)
  assert.match(r.respostas[0], /Confirmado/i)
})

test('finalizarComProtocolo com outro status avisa que aguarda autorizacao', () => {
  const r = finalizarComProtocolo(dadosConfirmando, 'AG-124', 'pendente')
  assert.match(r.respostas[0], /aguardando autorização/i)
})

test('finalizarComProtocolo com status recusado avisa oficina lotada e o motivo', () => {
  const r = finalizarComProtocolo(dadosConfirmando, 'AG-125', 'recusado', 'Oficina sem vagas: 4 de 4')
  assert.equal(r.etapa, 'finalizado')
  assert.match(r.respostas[0], /AG-125/)
  assert.match(r.respostas[0], /lotada/i)
  assert.match(r.respostas[0], /Motivo: Oficina sem vagas: 4 de 4/)
  assert.doesNotMatch(r.respostas[0], /aguardando autorização/i)
  assert.doesNotMatch(r.respostas[0], /Confirmado/i)
})

test('finalizarComProtocolo com status recusado sem motivo nao mostra linha de motivo', () => {
  const r = finalizarComProtocolo(dadosConfirmando, 'AG-126', 'recusado')
  assert.match(r.respostas[0], /lotada/i)
  assert.doesNotMatch(r.respostas[0], /Motivo:/)
})

test('falhaAoConfirmar mantem etapa confirmando e avisa erro', () => {
  const r = falhaAoConfirmar(dadosConfirmando)
  assert.equal(r.etapa, 'confirmando')
  assert.match(r.respostas[0], /99995-9427/)
})

test('falhaAoConfirmar com motivo mantem confirmando e mostra o motivo ao cliente', () => {
  const r = falhaAoConfirmar(dadosConfirmando, 'Há uma ordem de serviço aberta para este veículo.')
  assert.equal(r.etapa, 'confirmando')
  assert.match(r.respostas[0], /Há uma ordem de serviço aberta para este veículo\./)
  assert.match(r.respostas[0], /99995-9427/)
})

import { ofertarVaga, confirmarEsperaComSucesso, confirmarEsperaVagaPerdida } from './conversa.ts'

test('lista_espera so lembra o cliente, sem avancar etapa', () => {
  const r = processarPasso('lista_espera', { nome: 'Maria' }, 'e ai, alguma novidade?', {})
  assert.equal(r.etapa, 'lista_espera')
  assert.match(r.respostas[0], /lista de espera/i)
})

test('ofertarVaga muda etapa e guarda a oferta', () => {
  const r = ofertarVaga({ nome: 'Maria' }, '2026-10-05', '09:00')
  assert.equal(r.etapa, 'aguardando_confirmacao_espera')
  assert.equal(r.dados.ofertaDia, '2026-10-05')
  assert.equal(r.dados.ofertaHora, '09:00')
  assert.match(r.respostas[0], /09:00/)
})

test('aguardando_confirmacao_espera com SIM sinaliza acao pendente', () => {
  const r = processarPasso(
    'aguardando_confirmacao_espera',
    { nome: 'Maria', ofertaDia: '2026-10-05', ofertaHora: '09:00' },
    'sim', {},
  )
  assert.equal(r.acaoPendente, 'confirmar_espera')
})

test('aguardando_confirmacao_espera com NAO volta pra lista de espera', () => {
  const r = processarPasso(
    'aguardando_confirmacao_espera',
    { nome: 'Maria', ofertaDia: '2026-10-05', ofertaHora: '09:00' },
    'nao', {},
  )
  assert.equal(r.etapa, 'lista_espera')
  assert.deepEqual(r.dados.ofertasRecusadas, ['2026-10-05|09:00'])
})

test('aguardando_confirmacao_espera com NAO acumula ofertas recusadas anteriores', () => {
  const dados = { nome: 'Maria', ofertaDia: '2026-10-06', ofertaHora: '10:00', ofertasRecusadas: ['2026-10-05|09:00'] }
  const r = processarPasso('aguardando_confirmacao_espera', dados, 'não', {})
  assert.deepEqual(r.dados.ofertasRecusadas, ['2026-10-05|09:00', '2026-10-06|10:00'])
  // função pura: não altera o objeto de entrada
  assert.deepEqual(dados.ofertasRecusadas, ['2026-10-05|09:00'])
})

test('aguardando_confirmacao_espera com NAO nao duplica oferta ja recusada', () => {
  const r = processarPasso(
    'aguardando_confirmacao_espera',
    { ofertaDia: '2026-10-05', ofertaHora: '09:00', ofertasRecusadas: ['2026-10-05|09:00'] },
    'n', {},
  )
  assert.deepEqual(r.dados.ofertasRecusadas, ['2026-10-05|09:00'])
})

test('confirmarEsperaComSucesso finaliza com protocolo', () => {
  const r = confirmarEsperaComSucesso({ nome: 'Maria' }, 'AG-500', 'autorizado')
  assert.equal(r.etapa, 'finalizado')
  assert.match(r.respostas[0], /AG-500/)
})

test('confirmarEsperaVagaPerdida volta pra lista de espera avisando', () => {
  const r = confirmarEsperaVagaPerdida({ nome: 'Maria' })
  assert.equal(r.etapa, 'lista_espera')
  assert.match(r.respostas[0], /já foi ocupado/i)
})

test('fluxo completo: do inicio ate finalizado, passo a passo', () => {
  let etapa: import('./conversa.ts').Etapa = 'inicio'
  let dados = {}

  let r = processarPasso(etapa, dados, '', {})
  etapa = r.etapa; dados = r.dados
  assert.equal(etapa, 'aguardando_nome')

  r = processarPasso(etapa, dados, 'João', { empresas })
  etapa = r.etapa; dados = r.dados
  assert.equal(etapa, 'aguardando_empresa')

  r = processarPasso(etapa, dados, '2', { empresas })
  etapa = r.etapa; dados = r.dados
  assert.equal(etapa, 'aguardando_placa')

  r = processarPasso(etapa, dados, 'abc-1234', { veiculosDaEmpresa: veiculos })
  etapa = r.etapa; dados = r.dados
  assert.equal(etapa, 'aguardando_tipo')

  r = processarPasso(etapa, dados, '1', {})
  etapa = r.etapa; dados = r.dados
  assert.equal(etapa, 'aguardando_motivo')

  r = processarPasso(etapa, dados, 'Troca de óleo', { diasComVaga: dias })
  etapa = r.etapa; dados = r.dados
  assert.equal(etapa, 'aguardando_dia')

  r = processarPasso(etapa, dados, '1', { diasComVaga: dias, horariosDoDia: horarios })
  etapa = r.etapa; dados = r.dados
  assert.equal(etapa, 'aguardando_hora')

  r = processarPasso(etapa, dados, '1', { horariosDoDia: horarios })
  etapa = r.etapa; dados = r.dados
  assert.equal(etapa, 'confirmando')

  r = processarPasso(etapa, dados, 'sim', {})
  assert.equal(r.acaoPendente, 'criar_agendamento')

  const final = finalizarComProtocolo(r.dados, 'AG-999', 'autorizado')
  assert.equal(final.etapa, 'finalizado')
  assert.match(final.respostas[0], /AG-999/)
})
