import 'jsr:@supabase/functions-js@2.4.4/edge-runtime.d.ts'

// Chamada só internamente (trigger do banco via pg_net, com o service role key).
// Avisa o grupo — e o cliente, se o contato parecer um telefone — que o
// agendamento foi aprovado e a Pré-OS foi gerada de verdade.

interface Payload {
  protocolo?: string
  contato?: string
  nomeSolicitante?: string
  empresaNome?: string
  placa?: string
  numeroOS?: string
}

function pareceTelefone(contato: string): boolean {
  const digitos = contato.replace(/\D/g, '')
  return digitos.length >= 10 && digitos.length <= 13
}

async function enviarWhatsApp(baseUrl: string, apiKey: string, instancia: string, numero: string, texto: string): Promise<void> {
  const resposta = await fetch(`${baseUrl}/message/sendText/${instancia}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: apiKey },
    body: JSON.stringify({ number: numero, text: texto }),
  })
  if (!resposta.ok) {
    throw new Error(`Evolution API respondeu ${resposta.status} ao enviar mensagem`)
  }
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405 })

  const payload = await request.json().catch(() => ({})) as Payload
  const { protocolo, contato, nomeSolicitante, empresaNome, placa, numeroOS } = payload
  if (!protocolo) return new Response(JSON.stringify({ ok: false, erro: 'protocolo ausente' }), { status: 400 })

  const baseUrl = Deno.env.get('EVOLUTION_API_URL')
  const apiKey = Deno.env.get('EVOLUTION_API_KEY')
  const instancia = Deno.env.get('EVOLUTION_INSTANCE')
  const grupoId = Deno.env.get('WHATSAPP_GRUPO_ID')

  if (!baseUrl || !apiKey || !instancia) {
    return new Response(JSON.stringify({ ok: false, erro: 'Evolution API não configurada' }), { status: 500 })
  }

  const textoGrupo = [
    '✅ Agendamento aprovado',
    `Protocolo: ${protocolo}`,
    numeroOS ? `OS: ${numeroOS}` : null,
    `Cliente: ${nomeSolicitante ?? '?'}`,
    `Empresa: ${empresaNome ?? '?'}`,
    `Veículo: ${placa ?? '?'}`,
  ].filter(Boolean).join('\n')

  const textoCliente = `Boa notícia! Seu agendamento (protocolo ${protocolo}) foi aprovado${numeroOS ? ` — OS ${numeroOS}` : ''}. Te esperamos na oficina!`

  const resultados: Record<string, string> = {}

  if (grupoId) {
    try {
      await enviarWhatsApp(baseUrl, apiKey, instancia, grupoId, textoGrupo)
      resultados.grupo = 'ok'
    } catch (erro) {
      console.error('whatsapp-notificar-aprovacao: falha ao notificar grupo', erro)
      resultados.grupo = 'falhou'
    }
  }

  if (contato && pareceTelefone(contato)) {
    try {
      await enviarWhatsApp(baseUrl, apiKey, instancia, contato, textoCliente)
      resultados.cliente = 'ok'
    } catch (erro) {
      console.error('whatsapp-notificar-aprovacao: falha ao avisar cliente', erro)
      resultados.cliente = 'falhou'
    }
  }

  return new Response(JSON.stringify({ ok: true, resultados }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
})
