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
const TELEFONE_ATENDIMENTO_HUMANO = '(86) 99995-9427'

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
    default:
      return { etapa: etapaAtual, dados, respostas: [] }
  }
}
