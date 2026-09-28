import assert from 'node:assert/strict'
import test from 'node:test'
import { enviarMensagemWhatsApp, extrairMensagemRecebida, type ConfigEvolution } from './evolution.ts'

const config: ConfigEvolution = { baseUrl: 'https://evo.exemplo.com', apiKey: 'chave-123', instancia: 'oficinafni' }

test('enviarMensagemWhatsApp chama o endpoint certo com o payload certo', async () => {
  const chamadas: Array<{ url: string; init: RequestInit }> = []
  const fetchFalso = async (url: string, init: RequestInit) => {
    chamadas.push({ url, init })
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }
  await enviarMensagemWhatsApp(config, '5586999990000', 'Olá!', fetchFalso as typeof fetch)
  assert.equal(chamadas.length, 1)
  assert.equal(chamadas[0].url, 'https://evo.exemplo.com/message/sendText/oficinafni')
  assert.equal((chamadas[0].init.headers as Record<string, string>)['apikey'], 'chave-123')
  const corpo = JSON.parse(String(chamadas[0].init.body))
  assert.equal(corpo.number, '5586999990000')
  assert.equal(corpo.text, 'Olá!')
})

test('enviarMensagemWhatsApp lanca erro se a Evolution API responder com falha', async () => {
  const fetchFalso = async () => new Response('erro interno', { status: 500 })
  await assert.rejects(() => enviarMensagemWhatsApp(config, '5586999990000', 'oi', fetchFalso as typeof fetch))
})

test('extrairMensagemRecebida le uma mensagem de texto recebida', () => {
  const payload = {
    event: 'messages.upsert',
    data: { key: { remoteJid: '5586999990000@s.whatsapp.net', fromMe: false }, message: { conversation: 'Olá, quero agendar' } },
  }
  const r = extrairMensagemRecebida(payload)
  assert.deepEqual(r, { telefone: '5586999990000', texto: 'Olá, quero agendar' })
})

test('extrairMensagemRecebida ignora mensagem enviada pelo proprio bot', () => {
  const payload = {
    event: 'messages.upsert',
    data: { key: { remoteJid: '5586999990000@s.whatsapp.net', fromMe: true }, message: { conversation: 'oi' } },
  }
  assert.equal(extrairMensagemRecebida(payload), null)
})

test('extrairMensagemRecebida ignora eventos que nao sao mensagem', () => {
  assert.equal(extrairMensagemRecebida({ event: 'connection.update' }), null)
})

test('extrairMensagemRecebida ignora mensagem de grupo', () => {
  const payload = {
    event: 'messages.upsert',
    data: { key: { remoteJid: '123456-group@g.us', fromMe: false }, message: { conversation: 'oi' } },
  }
  assert.equal(extrairMensagemRecebida(payload), null)
})
