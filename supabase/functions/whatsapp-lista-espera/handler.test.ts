// supabase/functions/whatsapp-lista-espera/handler.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { createListaEsperaHandler, ofertaJaRecusada, type ListaEsperaGateway } from './handler.ts'
import type { DadosSessao } from '../whatsapp-agendamento/conversa.ts'

function fakeGateway(overrides: Partial<ListaEsperaGateway> = {}): ListaEsperaGateway {
  return {
    listarSessoesEmEspera: async () => [],
    primeiroHorarioLivre: async () => null,
    salvarSessao: async () => undefined,
    enviarMensagem: async () => undefined,
    ...overrides,
  }
}

test('sem sessoes em espera, nao faz nada', async () => {
  let salvouAlgo = false
  const handler = createListaEsperaHandler(() => fakeGateway({ salvarSessao: async () => { salvouAlgo = true } }))
  const resposta = await handler(new Request('http://local/whatsapp-lista-espera', { method: 'POST' }))
  assert.equal(resposta.status, 200)
  assert.equal(salvouAlgo, false)
})

test('sessao em espera sem horario livre ainda, permanece sem mudanca', async () => {
  let salvouAlgo = false
  const handler = createListaEsperaHandler(() => fakeGateway({
    listarSessoesEmEspera: async () => [{ telefone: '5586999990000', dados: { nome: 'Maria' } }],
    primeiroHorarioLivre: async () => null,
    salvarSessao: async () => { salvouAlgo = true },
  }))
  await handler(new Request('http://local/whatsapp-lista-espera', { method: 'POST' }))
  assert.equal(salvouAlgo, false)
})

test('sessao em espera com horario livre recebe oferta por whatsapp', async () => {
  const salvas: Array<{ telefone: string; etapa: string }> = []
  const enviadas: string[] = []
  const handler = createListaEsperaHandler(() => fakeGateway({
    listarSessoesEmEspera: async () => [{ telefone: '5586999990000', dados: { nome: 'Maria' } }],
    primeiroHorarioLivre: async () => ({ dia: '2026-10-05', hora: '09:00' }),
    salvarSessao: async (telefone, etapa) => { salvas.push({ telefone, etapa }) },
    enviarMensagem: async (_t, texto) => { enviadas.push(texto) },
  }))
  await handler(new Request('http://local/whatsapp-lista-espera', { method: 'POST' }))
  assert.equal(salvas[0].etapa, 'aguardando_confirmacao_espera')
  assert.match(enviadas[0], /09:00/)
})

// Simula o gateway real: percorre os horários livres em ordem e pula os já recusados pela sessão.
function primeiroNaoRecusado(candidatos: Array<{ dia: string; hora: string }>) {
  return async (dados: DadosSessao) => candidatos.find(c => !ofertaJaRecusada(dados, c.dia, c.hora)) ?? null
}

test('ofertaJaRecusada reconhece dia|hora recusados', () => {
  const dados: DadosSessao = { ofertasRecusadas: ['2026-10-05|09:00'] }
  assert.equal(ofertaJaRecusada(dados, '2026-10-05', '09:00'), true)
  assert.equal(ofertaJaRecusada(dados, '2026-10-05', '10:00'), false)
  assert.equal(ofertaJaRecusada({}, '2026-10-05', '09:00'), false)
})

test('horario ja recusado pela sessao e pulado em favor do proximo', async () => {
  const dadosRecebidos: DadosSessao[] = []
  const enviadas: string[] = []
  const salvas: Array<{ etapa: string; dados: DadosSessao }> = []
  const buscar = primeiroNaoRecusado([{ dia: '2026-10-05', hora: '09:00' }, { dia: '2026-10-05', hora: '10:00' }])
  const handler = createListaEsperaHandler(() => fakeGateway({
    listarSessoesEmEspera: async () => [{ telefone: '5586999990000', dados: { nome: 'Maria', ofertasRecusadas: ['2026-10-05|09:00'] } }],
    primeiroHorarioLivre: async (dados) => { dadosRecebidos.push(dados); return buscar(dados) },
    salvarSessao: async (_t, etapa, dados) => { salvas.push({ etapa, dados }) },
    enviarMensagem: async (_t, texto) => { enviadas.push(texto) },
  }))
  await handler(new Request('http://local/whatsapp-lista-espera', { method: 'POST' }))
  assert.deepEqual(dadosRecebidos[0].ofertasRecusadas, ['2026-10-05|09:00'])
  assert.match(enviadas[0], /10:00/)
  assert.equal(salvas[0].dados.ofertaHora, '10:00')
})

test('se o gateway devolver um horario ja recusado, nao reoferece', async () => {
  let enviou = false
  const handler = createListaEsperaHandler(() => fakeGateway({
    listarSessoesEmEspera: async () => [{ telefone: '5586999990000', dados: { ofertasRecusadas: ['2026-10-05|09:00'] } }],
    primeiroHorarioLivre: async () => ({ dia: '2026-10-05', hora: '09:00' }),
    enviarMensagem: async () => { enviou = true },
  }))
  await handler(new Request('http://local/whatsapp-lista-espera', { method: 'POST' }))
  assert.equal(enviou, false)
})

test('falha em uma sessao nao interrompe as demais', async () => {
  const salvos: string[] = []
  const handler = createListaEsperaHandler(() => fakeGateway({
    listarSessoesEmEspera: async () => [
      { telefone: '111', dados: {} },
      { telefone: '222', dados: {} },
    ],
    primeiroHorarioLivre: async () => ({ dia: '2026-10-05', hora: '09:00' }),
    enviarMensagem: async (telefone) => { if (telefone === '111') throw new Error('evolution fora do ar') },
    salvarSessao: async (telefone) => { salvos.push(telefone) },
  }))
  const resposta = await handler(new Request('http://local/whatsapp-lista-espera', { method: 'POST' }))
  assert.equal(resposta.status, 200)
  const corpo = await resposta.json()
  assert.equal(corpo.ofertasEnviadas, 1)
  assert.equal(corpo.falhas, 1)
  // envio falhou para 111: a sessão não foi movida para aguardando_confirmacao_espera
  assert.deepEqual(salvos, ['222'])
})
