import { normalizarPlaca, placasCorrespondem } from './placa.ts'

export type Etapa =
  | 'inicio' | 'aguardando_nome' | 'aguardando_empresa' | 'aguardando_placa'
  | 'aguardando_tipo' | 'aguardando_motivo' | 'aguardando_dia' | 'aguardando_hora'
  | 'confirmando' | 'finalizado' | 'encerrado_humano'
  | 'lista_espera' | 'aguardando_confirmacao_espera'

export interface Empresa { id: number; nome: string }
export interface Veiculo { id: number; empresaId: number; placa: string; modelo: string }
export interface DiaComVaga { dia: string; vagasDia: number }
export interface HorarioComVaga { hora: number; vagas: number; capacidade: number }

export interface DadosSessao {
  nome?: string
  empresaId?: number
  empresaNome?: string
  placaTentativas?: number
  veiculoId?: number
  veiculoPlaca?: string
  tipo?: string
  descricao?: string
  dia?: string
  hora?: string
  ofertaDia?: string
  ofertaHora?: string
}

export interface ContextoPasso {
  empresas?: Empresa[]
  veiculosDaEmpresa?: Veiculo[]
  diasComVaga?: DiaComVaga[]
  horariosDoDia?: HorarioComVaga[]
}

export interface ResultadoPasso {
  etapa: Etapa
  dados: DadosSessao
  respostas: string[]
  acaoPendente?: 'criar_agendamento' | 'confirmar_espera'
}

const TIPOS_MANUTENCAO = ['Preventiva', 'Corretiva', 'Revisão', 'Outro'] as const
const LIMITE_TENTATIVAS_PLACA = 3
export const TELEFONE_ATENDIMENTO_HUMANO ='(86) 99995-9427'

function listarEmpresasTexto(empresas: Empresa[]): string {
  return empresas.map((e, i) => `${i + 1}. ${e.nome}`).join('\n')
}

function encontrarEmpresa(entrada: string, empresas: Empresa[]): Empresa | undefined {
  const texto = entrada.trim()
  const porNumero = Number(texto)
  if (Number.isInteger(porNumero) && porNumero >= 1 && porNumero <= empresas.length) {
    return empresas[porNumero - 1]
  }
  const alvo = texto.toLowerCase()
  return empresas.find(e => e.nome.toLowerCase() === alvo)
}

function listarTiposTexto(): string {
  return TIPOS_MANUTENCAO.map((t, i) => `${i + 1}. ${t}`).join('\n')
}

function encontrarTipo(entrada: string): string | undefined {
  const texto = entrada.trim()
  const porNumero = Number(texto)
  if (Number.isInteger(porNumero) && porNumero >= 1 && porNumero <= TIPOS_MANUTENCAO.length) {
    return TIPOS_MANUTENCAO[porNumero - 1]
  }
  const alvo = texto.toLowerCase()
  return TIPOS_MANUTENCAO.find(t => t.toLowerCase() === alvo)
}

function passoInicio(): ResultadoPasso {
  return {
    etapa: 'aguardando_nome',
    dados: {},
    respostas: ['Olá! 👋 Sou o assistente de agendamento da oficina. Qual é o seu nome?'],
  }
}

function passoAguardandoNome(dados: DadosSessao, entrada: string, contexto: ContextoPasso): ResultadoPasso {
  const nome = entrada.trim()
  if (!nome) {
    return { etapa: 'aguardando_nome', dados, respostas: ['Não entendi, pode me dizer seu nome?'] }
  }
  const empresas = contexto.empresas ?? []
  return {
    etapa: 'aguardando_empresa',
    dados: { ...dados, nome },
    respostas: [`Prazer, ${nome}! De qual empresa é o veículo? Responda com o número:\n${listarEmpresasTexto(empresas)}`],
  }
}

function passoAguardandoEmpresa(dados: DadosSessao, entrada: string, contexto: ContextoPasso): ResultadoPasso {
  const empresas = contexto.empresas ?? []
  const empresa = encontrarEmpresa(entrada, empresas)
  if (!empresa) {
    return {
      etapa: 'aguardando_empresa',
      dados,
      respostas: [`Não encontrei essa opção. Responda com o número da empresa:\n${listarEmpresasTexto(empresas)}`],
    }
  }
  return {
    etapa: 'aguardando_placa',
    dados: { ...dados, empresaId: empresa.id, empresaNome: empresa.nome, placaTentativas: 0 },
    respostas: ['Qual é a placa do veículo?'],
  }
}

function passoAguardandoPlaca(dados: DadosSessao, entrada: string, contexto: ContextoPasso): ResultadoPasso {
  const veiculos = contexto.veiculosDaEmpresa ?? []
  const veiculo = veiculos.find(v => placasCorrespondem(v.placa, entrada))
  if (veiculo) {
    return {
      etapa: 'aguardando_tipo',
      dados: { ...dados, veiculoId: veiculo.id, veiculoPlaca: normalizarPlaca(veiculo.placa), placaTentativas: 0 },
      respostas: [`Veículo encontrado: ${veiculo.placa} — ${veiculo.modelo}.\nQual o tipo de manutenção?\n${listarTiposTexto()}`],
    }
  }
  const tentativas = (dados.placaTentativas ?? 0) + 1
  if (tentativas >= LIMITE_TENTATIVAS_PLACA) {
    return {
      etapa: 'encerrado_humano',
      dados: { ...dados, placaTentativas: tentativas },
      respostas: [`Não consegui localizar essa placa no cadastro de ${dados.empresaNome ?? 'sua empresa'}. Vou te encaminhar para nosso atendimento: ${TELEFONE_ATENDIMENTO_HUMANO}.`],
    }
  }
  return {
    etapa: 'aguardando_placa',
    dados: { ...dados, placaTentativas: tentativas },
    respostas: [`Não encontrei essa placa no cadastro de ${dados.empresaNome ?? 'sua empresa'}. Confere e digita de novo (tentativa ${tentativas}/${LIMITE_TENTATIVAS_PLACA}).`],
  }
}

function passoAguardandoTipo(dados: DadosSessao, entrada: string): ResultadoPasso {
  const tipo = encontrarTipo(entrada)
  if (!tipo) {
    return { etapa: 'aguardando_tipo', dados, respostas: [`Não entendi. Escolha uma opção:\n${listarTiposTexto()}`] }
  }
  return {
    etapa: 'aguardando_motivo',
    dados: { ...dados, tipo },
    respostas: ['Me conta rapidamente qual é o problema ou serviço necessário.'],
  }
}

function formatarDataBR(iso: string): string {
  const [ano, mes, dia] = iso.split('-')
  return `${dia}/${mes}`
}

function listarDiasTexto(dias: DiaComVaga[]): string {
  return dias.map((d, i) => `${i + 1}. ${formatarDataBR(d.dia)}`).join('\n')
}

export function encontrarDia(entrada: string, dias: DiaComVaga[]): DiaComVaga | undefined {
  const texto = entrada.trim()
  const porNumero = Number(texto)
  if (Number.isInteger(porNumero) && porNumero >= 1 && porNumero <= dias.length) {
    return dias[porNumero - 1]
  }
  return dias.find(d => formatarDataBR(d.dia) === texto)
}

function formatarHora(hora: number): string {
  return `${String(hora).padStart(2, '0')}:00`
}

function horariosLivres(horarios: HorarioComVaga[]): HorarioComVaga[] {
  return horarios.filter(h => h.vagas > 0)
}

function listarHorariosTexto(horarios: HorarioComVaga[]): string {
  return horariosLivres(horarios).map((h, i) => `${i + 1}. ${formatarHora(h.hora)}`).join('\n')
}

function encontrarHorario(entrada: string, horarios: HorarioComVaga[]): HorarioComVaga | undefined {
  const livres = horariosLivres(horarios)
  const texto = entrada.trim()
  const porNumero = Number(texto)
  if (Number.isInteger(porNumero) && porNumero >= 1 && porNumero <= livres.length) {
    return livres[porNumero - 1]
  }
  return livres.find(h => formatarHora(h.hora) === texto)
}

function passoAguardandoMotivo(dados: DadosSessao, entrada: string, contexto: ContextoPasso): ResultadoPasso {
  const descricao = entrada.trim()
  if (!descricao) {
    return { etapa: 'aguardando_motivo', dados, respostas: ['Não entendi, pode descrever o serviço?'] }
  }
  const dias = contexto.diasComVaga ?? []
  const novoDados = { ...dados, descricao }
  if (dias.length === 0) {
    return {
      etapa: 'lista_espera',
      dados: novoDados,
      respostas: ['No momento não há vaga disponível nos próximos dias. Coloquei seu pedido na lista de espera e aviso assim que abrir um horário.'],
    }
  }
  return {
    etapa: 'aguardando_dia',
    dados: novoDados,
    respostas: [`Escolha um dia (responda com o número):\n${listarDiasTexto(dias)}`],
  }
}

function passoAguardandoDia(dados: DadosSessao, entrada: string, contexto: ContextoPasso): ResultadoPasso {
  const dias = contexto.diasComVaga ?? []
  const escolhido = encontrarDia(entrada, dias)
  if (!escolhido) {
    return { etapa: 'aguardando_dia', dados, respostas: [`Não encontrei essa data. Escolha um dia:\n${listarDiasTexto(dias)}`] }
  }
  const horarios = contexto.horariosDoDia ?? []
  return {
    etapa: 'aguardando_hora',
    dados: { ...dados, dia: escolhido.dia },
    respostas: [`Horários disponíveis em ${formatarDataBR(escolhido.dia)}:\n${listarHorariosTexto(horarios)}`],
  }
}

function passoAguardandoHora(dados: DadosSessao, entrada: string, contexto: ContextoPasso): ResultadoPasso {
  const horarios = contexto.horariosDoDia ?? []
  const escolhido = encontrarHorario(entrada, horarios)
  if (!escolhido) {
    if (horariosLivres(horarios).length === 0) {
      const dias = contexto.diasComVaga ?? []
      return {
        etapa: 'aguardando_dia',
        dados,
        respostas: [`Esse dia acabou de lotar. Escolha outro:\n${listarDiasTexto(dias)}`],
      }
    }
    return { etapa: 'aguardando_hora', dados, respostas: [`Não encontrei esse horário. Escolha:\n${listarHorariosTexto(horarios)}`] }
  }
  const hora = formatarHora(escolhido.hora)
  return {
    etapa: 'confirmando',
    dados: { ...dados, hora },
    respostas: [
      `Confirma o agendamento?\nData: ${dados.dia ? formatarDataBR(dados.dia) : '?'} às ${hora}\nEmpresa: ${dados.empresaNome ?? '?'}\nVeículo: ${dados.veiculoPlaca ?? '?'}\nTipo: ${dados.tipo ?? '?'}\nMotivo: ${dados.descricao ?? '?'}\nResponda SIM para confirmar ou NÃO para cancelar.`,
    ],
  }
}

function interpretarSimNao(entrada: string): boolean | undefined {
  const texto = entrada.trim().toLowerCase()
  if (['sim', 's', 'yes'].includes(texto)) return true
  if (['nao', 'não', 'n', 'no'].includes(texto)) return false
  return undefined
}

function passoConfirmando(dados: DadosSessao, entrada: string): ResultadoPasso {
  const resposta = interpretarSimNao(entrada)
  if (resposta === undefined) {
    return { etapa: 'confirmando', dados, respostas: ['Não entendi. Responda SIM para confirmar ou NÃO para cancelar.'] }
  }
  if (!resposta) {
    return { etapa: 'finalizado', dados, respostas: ['Tudo bem, agendamento cancelado. Se quiser recomeçar, é só mandar outra mensagem.'] }
  }
  return { etapa: 'confirmando', dados, respostas: [], acaoPendente: 'criar_agendamento' }
}

export function finalizarComProtocolo(dados: DadosSessao, protocolo: string, statusRetornado: string): ResultadoPasso {
  const statusTexto = statusRetornado === 'autorizado'
    ? 'Confirmado — vaga reservada e Pré-OS gerada.'
    : 'Aguardando autorização.'
  return {
    etapa: 'finalizado',
    dados,
    respostas: [`Agendamento recebido! Protocolo: ${protocolo}.\n${statusTexto}`],
  }
}

export function falhaAoConfirmar(dados: DadosSessao): ResultadoPasso {
  return {
    etapa: 'confirmando',
    dados,
    respostas: [`Não consegui confirmar agora. Tente novamente em instantes ou fale com ${TELEFONE_ATENDIMENTO_HUMANO}.`],
  }
}

function passoListaEspera(dados: DadosSessao): ResultadoPasso {
  return {
    etapa: 'lista_espera',
    dados,
    respostas: ['Você continua na nossa lista de espera. Assim que abrir um horário, eu aviso por aqui.'],
  }
}

export function ofertarVaga(dados: DadosSessao, dia: string, hora: string): ResultadoPasso {
  return {
    etapa: 'aguardando_confirmacao_espera',
    dados: { ...dados, ofertaDia: dia, ofertaHora: hora },
    respostas: [`Abriu uma vaga em ${formatarDataBR(dia)} às ${hora}! Responda SIM para garantir ou NÃO para continuar esperando.`],
  }
}

function passoAguardandoConfirmacaoEspera(dados: DadosSessao, entrada: string): ResultadoPasso {
  const resposta = interpretarSimNao(entrada)
  if (resposta === undefined) {
    return { etapa: 'aguardando_confirmacao_espera', dados, respostas: ['Não entendi. Responda SIM para garantir a vaga ou NÃO para continuar esperando.'] }
  }
  if (!resposta) {
    return { etapa: 'lista_espera', dados, respostas: ['Sem problemas, você continua na lista de espera.'] }
  }
  return { etapa: 'aguardando_confirmacao_espera', dados, respostas: [], acaoPendente: 'confirmar_espera' }
}

export function confirmarEsperaComSucesso(dados: DadosSessao, protocolo: string, statusRetornado: string): ResultadoPasso {
  return finalizarComProtocolo(dados, protocolo, statusRetornado)
}

export function confirmarEsperaVagaPerdida(dados: DadosSessao): ResultadoPasso {
  return {
    etapa: 'lista_espera',
    dados,
    respostas: ['Esse horário já foi ocupado por outra pessoa. Você continua na lista de espera, aviso no próximo que abrir.'],
  }
}

export function processarPasso(
  etapaAtual: Etapa,
  dados: DadosSessao,
  entradaUsuario: string,
  contexto: ContextoPasso,
): ResultadoPasso {
  switch (etapaAtual) {
    case 'inicio':
      return passoInicio()
    case 'aguardando_nome':
      return passoAguardandoNome(dados, entradaUsuario, contexto)
    case 'aguardando_empresa':
      return passoAguardandoEmpresa(dados, entradaUsuario, contexto)
    case 'aguardando_placa':
      return passoAguardandoPlaca(dados, entradaUsuario, contexto)
    case 'aguardando_tipo':
      return passoAguardandoTipo(dados, entradaUsuario)
    case 'aguardando_motivo':
      return passoAguardandoMotivo(dados, entradaUsuario, contexto)
    case 'aguardando_dia':
      return passoAguardandoDia(dados, entradaUsuario, contexto)
    case 'aguardando_hora':
      return passoAguardandoHora(dados, entradaUsuario, contexto)
    case 'confirmando':
      return passoConfirmando(dados, entradaUsuario)
    case 'lista_espera':
      return passoListaEspera(dados)
    case 'aguardando_confirmacao_espera':
      return passoAguardandoConfirmacaoEspera(dados, entradaUsuario)
    default:
      return { etapa: etapaAtual, dados, respostas: [] }
  }
}
