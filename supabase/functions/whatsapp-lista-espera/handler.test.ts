// supabase/functions/whatsapp-lista-espera/handler.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { createListaEsperaHandler, type ListaEsperaGateway } from './handler.ts'

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
