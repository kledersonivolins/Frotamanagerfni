import {
  processarPasso, finalizarComProtocolo, falhaAoConfirmar,
  confirmarEsperaComSucesso, confirmarEsperaVagaPerdida,
  type Etapa, type DadosSessao, type Empresa, type Veiculo,
  type DiaComVaga, type HorarioComVaga, type ContextoPasso, type ResultadoPasso,
} from './conversa.ts'

export interface AgendamentoBotGateway {
  carregarSessao(telefone: string): Promise<{ etapa: Etapa; dados: DadosSessao } | null>
  salvarSessao(telefone: string, etapa: Etapa, dados: DadosSessao): Promise<void>
  encerrarSessao(telefone: string): Promise<void>
  listarEmpresas(): Promise<Empresa[]>
  listarVeiculos(empresaId: number): Promise<Veiculo[]>
  listarDiasComVaga(): Promise<DiaComVaga[]>
  listarHorariosDoDia(diaISO: string): Promise<HorarioComVaga[]>
  solicitarAgendamento(input: {
    nome: string; contato: string; empresaId: number; veiculoId: number
    tipo: string; descricao: string; inicioISO: string
  }): Promise<{ protocolo: string; status: string }>
  enviarMensagem(telefone: string, texto: string): Promise<void>
  extrairMensagem(payload: unknown): { telefone: string; texto: string } | null
}

const headers = { 'Content-Type': 'application/json' }
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })

async function montarContexto(gateway: AgendamentoBotGateway, etapa: Etapa, dados: DadosSessao): Promise<ContextoPasso> {
  switch (etapa) {
    case 'aguardando_nome':
    case 'aguardando_empresa':
      return { empresas: await gateway.listarEmpresas() }
    case 'aguardando_placa':
      return { veiculosDaEmpresa: dados.empresaId ? await gateway.listarVeiculos(dados.empresaId) : [] }
    case 'aguardando_motivo':
    case 'aguardando_dia':
      return { diasComVaga: await gateway.listarDiasComVaga() }
    case 'aguardando_hora':
      return {
        horariosDoDia: dados.dia ? await gateway.listarHorariosDoDia(dados.dia) : [],
        diasComVaga: await gateway.listarDiasComVaga(),
      }
    default:
      return {}
  }
}

async function executarAcaoPendente(gateway: AgendamentoBotGateway, telefone: string, resultado: ResultadoPasso): Promise<ResultadoPasso> {
  if (resultado.acaoPendente === 'criar_agendamento') {
    const d = resultado.dados
    if (!d.empresaId || !d.veiculoId || !d.tipo || !d.descricao || !d.dia || !d.hora) return falhaAoConfirmar(resultado.dados)
    try {
      const r = await gateway.solicitarAgendamento({
        nome: d.nome ?? '', contato: telefone, empresaId: d.empresaId, veiculoId: d.veiculoId,
        tipo: d.tipo, descricao: d.descricao, inicioISO: `${d.dia}T${d.hora}:00`,
      })
      return finalizarComProtocolo(d, r.protocolo, r.status)
    } catch {
      return falhaAoConfirmar(d)
    }
  }
  if (resultado.acaoPendente === 'confirmar_espera') {
    const d = resultado.dados
    if (!d.empresaId || !d.veiculoId || !d.tipo || !d.descricao || !d.ofertaDia || !d.ofertaHora) return falhaAoConfirmar(d)
    const horarios = await gateway.listarHorariosDoDia(d.ofertaDia)
    const horaOfertada = Number(d.ofertaHora.slice(0, 2))
    const aindaLivre = horarios.some(h => h.hora === horaOfertada && h.vagas > 0)
    if (!aindaLivre) return confirmarEsperaVagaPerdida(d)
    try {
      const r = await gateway.solicitarAgendamento({
        nome: d.nome ?? '', contato: telefone, empresaId: d.empresaId, veiculoId: d.veiculoId,
        tipo: d.tipo, descricao: d.descricao, inicioISO: `${d.ofertaDia}T${d.ofertaHora}:00`,
      })
      return confirmarEsperaComSucesso(d, r.protocolo, r.status)
    } catch {
      return falhaAoConfirmar(d)
    }
  }
  return resultado
}

export function createWhatsAppAgendamentoHandler(createGateway: (payload: unknown) => AgendamentoBotGateway) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers })
    if (request.method !== 'POST') return reply({ error: 'Método não permitido.' }, 405)

    const payload = await request.json().catch(() => ({}))
    const gateway = createGateway(payload)
    const mensagem = gateway.extrairMensagem(payload)
    if (!mensagem) return reply({ ok: true, ignorado: true })

    const sessaoAtual = await gateway.carregarSessao(mensagem.telefone)
    const etapaAtual: Etapa = sessaoAtual?.etapa ?? 'inicio'
    const dadosAtuais: DadosSessao = sessaoAtual?.dados ?? {}

    const contexto = await montarContexto(gateway, etapaAtual, dadosAtuais)
    let resultado = processarPasso(etapaAtual, dadosAtuais, mensagem.texto, contexto)
    resultado = await executarAcaoPendente(gateway, mensagem.telefone, resultado)

    if (resultado.etapa === 'finalizado' || resultado.etapa === 'encerrado_humano') {
      await gateway.encerrarSessao(mensagem.telefone)
    } else {
      await gateway.salvarSessao(mensagem.telefone, resultado.etapa, resultado.dados)
    }

    for (const texto of resultado.respostas) await gateway.enviarMensagem(mensagem.telefone, texto)

    return reply({ ok: true })
  }
}
