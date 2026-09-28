export interface ConfigEvolution {
  baseUrl: string
  apiKey: string
  instancia: string
}

export async function enviarMensagemWhatsApp(
  config: ConfigEvolution,
  telefone: string,
  texto: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const resposta = await fetchImpl(`${config.baseUrl}/message/sendText/${config.instancia}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: config.apiKey },
    body: JSON.stringify({ number: telefone, text: texto }),
  })
  if (!resposta.ok) {
    throw new Error(`Evolution API respondeu ${resposta.status} ao enviar mensagem`)
  }
}

export function extrairMensagemRecebida(payload: unknown): { telefone: string; texto: string } | null {
  if (!payload || typeof payload !== 'object') return null
  const corpo = payload as Record<string, unknown>
  if (corpo.event !== 'messages.upsert') return null

  const dados = corpo.data as Record<string, unknown> | undefined
  const key = dados?.key as Record<string, unknown> | undefined
  const remoteJid = typeof key?.remoteJid === 'string' ? key.remoteJid : ''
  if (!remoteJid || remoteJid.endsWith('@g.us')) return null
  if (key?.fromMe === true) return null

  const mensagem = dados?.message as Record<string, unknown> | undefined
  const texto = typeof mensagem?.conversation === 'string' ? mensagem.conversation : ''
  if (!texto) return null

  const telefone = remoteJid.split('@')[0]
  return { telefone, texto }
}
