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
    default:
      return { etapa: etapaAtual, dados, respostas: [] }
  }
}
