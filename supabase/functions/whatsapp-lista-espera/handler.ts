// supabase/functions/whatsapp-lista-espera/handler.ts
import { ofertarVaga } from '../whatsapp-agendamento/conversa.ts'
import type { DadosSessao, Etapa } from '../whatsapp-agendamento/conversa.ts'

export interface ListaEsperaGateway {
  listarSessoesEmEspera(): Promise<Array<{ telefone: string; dados: DadosSessao }>>
  primeiroHorarioLivre(): Promise<{ dia: string; hora: string } | null>
  salvarSessao(telefone: string, etapa: Etapa, dados: DadosSessao): Promise<void>
  enviarMensagem(telefone: string, texto: string): Promise<void>
}

const headers = { 'Content-Type': 'application/json' }
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })

export function createListaEsperaHandler(createGateway: () => ListaEsperaGateway) {
  return async (_request: Request): Promise<Response> => {
    const gateway = createGateway()
    const sessoes = await gateway.listarSessoesEmEspera()
    let ofertadas = 0

    for (const sessao of sessoes) {
      const horario = await gateway.primeiroHorarioLivre()
      if (!horario) continue
      const resultado = ofertarVaga(sessao.dados, horario.dia, horario.hora)
      await gateway.salvarSessao(sessao.telefone, resultado.etapa, resultado.dados)
      for (const texto of resultado.respostas) await gateway.enviarMensagem(sessao.telefone, texto)
      ofertadas++
    }

    return reply({ ok: true, sessoesAvaliadas: sessoes.length, ofertasEnviadas: ofertadas })
  }
}
