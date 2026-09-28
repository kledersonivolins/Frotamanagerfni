import assert from 'node:assert/strict'
import test from 'node:test'
import { createWhatsAppAgendamentoHandler, type AgendamentoBotGateway } from './handler.ts'
import type { DadosSessao, Empresa, Veiculo, Etapa } from './conversa.ts'

const empresas: Empresa[] = [{ id: 20, nome: 'Construtora BS' }]
const veiculos: Veiculo[] = [{ id: 100, empresaId: 20, placa: 'ABC1234', modelo: 'Munck' }]

function fakeGateway(overrides: Partial<AgendamentoBotGateway> = {}): AgendamentoBotGateway {
  return {
    carregarSessao: async () => null,
    salvarSessao: async () => undefined,
    encerrarSessao: async () => undefined,
    listarEmpresas: async () => empresas,
    listarVeiculos: async () => veiculos,
    listarDiasComVaga: async () => [],
    listarHorariosDoDia: async () => [],
    solicitarAgendamento: async () => ({ protocolo: 'AG-1', status: 'autorizado' }),
    enviarMensagem: async () => undefined,
    extrairMensagem: () => ({ telefone: '5586999990000', texto: 'oi' }),
    ...overrides,
  }
}

function webhookRequest(corpo: unknown = {}): Request {
  return new Request('http://local/whatsapp-agendamento', { method: 'POST', body: JSON.stringify(corpo) })
}

test('sessao inexistente manda boas-vindas e cria sessao aguardando_nome', async () => {
  const salvas: Array<{ telefone: string; etapa: Etapa; dados: DadosSessao }> = []
  const enviadas: string[] = []
  const handler = createWhatsAppAgendamentoHandler(() => fakeGateway({
    salvarSessao: async (telefone, etapa, dados) => { salvas.push({ telefone, etapa, dados }) },
    enviarMensagem: async (_telefone, texto) => { enviadas.push(texto) },
  }))
  const resposta = await handler(webhookRequest())
  assert.equal(resposta.status, 200)
  assert.equal(salvas.length, 1)
  assert.equal(salvas[0].etapa, 'aguardando_nome')
  assert.match(enviadas[0], /nome/i)
})

test('mensagem que nao e do cliente e ignorada (200 sem efeitos)', async () => {
  let chamouSalvar = false
  const handler = createWhatsAppAgendamentoHandler(() => fakeGateway({
    extrairMensagem: () => null,
    salvarSessao: async () => { chamouSalvar = true },
  }))
  const resposta = await handler(webhookRequest())
  assert.equal(resposta.status, 200)
  assert.equal(chamouSalvar, false)
})

test('etapa aguardando_empresa avanca usando a lista de empresas do gateway', async () => {
  const salvas: Array<{ etapa: Etapa; dados: DadosSessao }> = []
  const handler = createWhatsAppAgendamentoHandler(() => fakeGateway({
    carregarSessao: async () => ({ etapa: 'aguardando_empresa', dados: { nome: 'Maria' } }),
    extrairMensagem: () => ({ telefone: '5586999990000', texto: '1' }),
    salvarSessao: async (_t, etapa, dados) => { salvas.push({ etapa, dados }) },
  }))
  await handler(webhookRequest())
  assert.equal(salvas[0].etapa, 'aguardando_placa')
  assert.equal(salvas[0].dados.empresaId, 20)
})

test('confirmacao com SIM chama solicitarAgendamento e encerra a sessao', async () => {
  let chamouSolicitar: unknown = null
  let encerrou = false
  const enviadas: string[] = []
  const handler = createWhatsAppAgendamentoHandler(() => fakeGateway({
    carregarSessao: async () => ({
      etapa: 'confirmando',
      dados: {
        nome: 'Maria', empresaId: 20, empresaNome: 'Construtora BS', veiculoId: 100,
        veiculoPlaca: 'ABC1234', tipo: 'Corretiva', descricao: 'Barulho', dia: '2026-10-01', hora: '08:00',
      },
    }),
    extrairMensagem: () => ({ telefone: '5586999990000', texto: 'sim' }),
    solicitarAgendamento: async (input) => { chamouSolicitar = input; return { protocolo: 'AG-42', status: 'autorizado' } },
    encerrarSessao: async () => { encerrou = true },
    enviarMensagem: async (_t, texto) => { enviadas.push(texto) },
  }))
  await handler(webhookRequest())
  assert.ok(chamouSolicitar)
  assert.equal((chamouSolicitar as { veiculoId: number }).veiculoId, 100)
  assert.equal((chamouSolicitar as { inicioISO: string }).inicioISO, '2026-10-01T08:00:00-03:00')
  assert.equal(encerrou, true)
  assert.match(enviadas[0], /AG-42/)
})

test('aguardando_dia com dia valido busca os horarios desse dia e lista as horas', async () => {
  const diasPedidos: string[] = []
  const salvas: Array<{ etapa: Etapa; dados: DadosSessao }> = []
  const enviadas: string[] = []
  const handler = createWhatsAppAgendamentoHandler(() => fakeGateway({
    carregarSessao: async () => ({ etapa: 'aguardando_dia', dados: { nome: 'Maria', empresaId: 20, veiculoId: 100 } }),
    extrairMensagem: () => ({ telefone: '5586999990000', texto: '2' }),
    listarDiasComVaga: async () => [{ dia: '2026-10-01', vagasDia: 3 }, { dia: '2026-10-02', vagasDia: 5 }],
    listarHorariosDoDia: async (dia) => {
      diasPedidos.push(dia)
      return [{ hora: 8, vagas: 1, capacidade: 2 }, { hora: 9, vagas: 0, capacidade: 2 }]
    },
    salvarSessao: async (_t, etapa, dados) => { salvas.push({ etapa, dados }) },
    enviarMensagem: async (_t, texto) => { enviadas.push(texto) },
  }))
  await handler(webhookRequest())
  assert.deepEqual(diasPedidos, ['2026-10-02'])
  assert.equal(salvas[0].etapa, 'aguardando_hora')
  assert.equal(salvas[0].dados.dia, '2026-10-02')
  assert.match(enviadas[0], /08:00/)
  assert.doesNotMatch(enviadas[0], /09:00/)
})

test('aguardando_dia com dia invalido nao busca horarios e relista os dias', async () => {
  let buscouHorarios = false
  const enviadas: string[] = []
  const handler = createWhatsAppAgendamentoHandler(() => fakeGateway({
    carregarSessao: async () => ({ etapa: 'aguardando_dia', dados: { nome: 'Maria' } }),
    extrairMensagem: () => ({ telefone: '5586999990000', texto: '9' }),
    listarDiasComVaga: async () => [{ dia: '2026-10-01', vagasDia: 3 }],
    listarHorariosDoDia: async () => { buscouHorarios = true; return [] },
    enviarMensagem: async (_t, texto) => { enviadas.push(texto) },
  }))
  await handler(webhookRequest())
  assert.equal(buscouHorarios, false)
  assert.match(enviadas[0], /01\/10/)
})

test('confirmar_espera envia inicioISO com offset de Fortaleza', async () => {
  let inicioISO = ''
  const handler = createWhatsAppAgendamentoHandler(() => fakeGateway({
    carregarSessao: async () => ({
      etapa: 'aguardando_confirmacao_espera',
      dados: {
        nome: 'Maria', empresaId: 20, veiculoId: 100, tipo: 'Corretiva', descricao: 'x',
        ofertaDia: '2026-10-05', ofertaHora: '09:00',
      },
    }),
    extrairMensagem: () => ({ telefone: '5586999990000', texto: 'sim' }),
    listarHorariosDoDia: async () => [{ hora: 9, vagas: 1, capacidade: 2 }],
    solicitarAgendamento: async (input) => { inicioISO = input.inicioISO; return { protocolo: 'AG-7', status: 'autorizado' } },
  }))
  await handler(webhookRequest())
  assert.equal(inicioISO, '2026-10-05T09:00:00-03:00')
})

test('confirmacao com SIM mas RPC falha mantem sessao em confirmando', async () => {
  const salvas: Array<{ etapa: Etapa }> = []
  let encerrou = false
  const handler = createWhatsAppAgendamentoHandler(() => fakeGateway({
    carregarSessao: async () => ({
      etapa: 'confirmando',
      dados: { nome: 'Maria', empresaId: 20, veiculoId: 100, tipo: 'Corretiva', descricao: 'x', dia: '2026-10-01', hora: '08:00' },
    }),
    extrairMensagem: () => ({ telefone: '5586999990000', texto: 'sim' }),
    solicitarAgendamento: async () => { throw new Error('fora do ar') },
    salvarSessao: async (_t, etapa) => { salvas.push({ etapa }) },
    encerrarSessao: async () => { encerrou = true },
  }))
  await handler(webhookRequest())
  assert.equal(encerrou, false)
  assert.equal(salvas[0].etapa, 'confirmando')
})
