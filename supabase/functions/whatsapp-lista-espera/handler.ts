// supabase/functions/whatsapp-lista-espera/handler.ts
import { ofertarVaga } from '../whatsapp-agendamento/conversa.ts'
import type { DadosSessao, Etapa } from '../whatsapp-agendamento/conversa.ts'

export interface ListaEsperaGateway {
  listarSessoesEmEspera(): Promise<Array<{ telefone: string; dados: DadosSessao }>>
  /** Primeiro horário livre que esta sessão ainda não recusou (ver ofertaJaRecusada). */
  primeiroHorarioLivre(dados: DadosSessao): Promise<{ dia: string; hora: string } | null>
  salvarSessao(telefone: string, etapa: Etapa, dados: DadosSessao): Promise<void>
  enviarMensagem(telefone: string, texto: string): Promise<void>
}

/** true se o cliente desta sessão já recusou a oferta dia+hora (formato "AAAA-MM-DD|HH:MM"). */
export function ofertaJaRecusada(dados: DadosSessao, dia: string, hora: string): boolean {
  return (dados.ofertasRecusadas ?? []).includes(`${dia}|${hora}`)
}

const headers = { 'Content-Type': 'application/json' }
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })

export function createListaEsperaHandler(createGateway: () => ListaEsperaGateway) {
  return async (_request: Request): Promise<Response> => {
    const gateway = createGateway()
    const sessoes = await gateway.listarSessoesEmEspera()
    let ofertadas = 0
    let falhas = 0

    for (const sessao of sessoes) {
      // Falha de uma sessão (RPC, envio, gravação) não interrompe as demais nesta execução.
      try {
        const horario = await gateway.primeiroHorarioLivre(sessao.dados)
        if (!horario || ofertaJaRecusada(sessao.dados, horario.dia, horario.hora)) continue
        const resultado = ofertarVaga(sessao.dados, horario.dia, horario.hora)
        // Envia antes de gravar: se o envio falhar a sessão continua em lista_espera e é
        // reavaliada na próxima execução, em vez de ficar presa aguardando uma resposta
        // a uma oferta que o cliente nunca recebeu.
        for (const texto of resultado.respostas) await gateway.enviarMensagem(sessao.telefone, texto)
        await gateway.salvarSessao(sessao.telefone, resultado.etapa, resultado.dados)
        ofertadas++
      } catch (erro) {
        falhas++
        console.error(`whatsapp-lista-espera: falha ao processar sessao ${sessao.telefone}`, erro)
      }
    }

    return reply({ ok: true, sessoesAvaliadas: sessoes.length, ofertasEnviadas: ofertadas, falhas })
  }
}
