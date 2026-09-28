import 'jsr:@supabase/functions-js@2.4.4/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2.57.4'
import { createWhatsAppAgendamentoHandler, type AgendamentoBotGateway } from './handler.ts'
import { enviarMensagemWhatsApp, extrairMensagemRecebida } from './evolution.ts'
import type { DadosSessao, Etapa } from './conversa.ts'

const TENANT = 'oficinafni'

// A Edge Function roda em UTC; o "hoje" da oficina é em America/Fortaleza (UTC-3).
function agoraFortaleza(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Fortaleza' }))
}

function dataISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function gateway(): AgendamentoBotGateway {
  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )
  const evolutionConfig = {
    baseUrl: Deno.env.get('EVOLUTION_API_URL')!,
    apiKey: Deno.env.get('EVOLUTION_API_KEY')!,
    instancia: Deno.env.get('EVOLUTION_INSTANCE')!,
  }

  return {
    async carregarSessao(telefone) {
      const { data, error } = await client.from('whatsapp_conversas')
        .select('etapa,dados').eq('tenant', TENANT).eq('telefone', telefone).maybeSingle()
      if (error) throw new Error(error.message)
      return data ? { etapa: data.etapa as Etapa, dados: (data.dados ?? {}) as DadosSessao } : null
    },
    async salvarSessao(telefone, etapa, dados) {
      const { error } = await client.from('whatsapp_conversas').upsert({
        tenant: TENANT, telefone, etapa, dados, atualizado_em: new Date().toISOString(),
      }, { onConflict: 'tenant,telefone' })
      if (error) throw new Error(error.message)
    },
    async encerrarSessao(telefone) {
      const { error } = await client.from('whatsapp_conversas').delete().eq('tenant', TENANT).eq('telefone', telefone)
      if (error) throw new Error(error.message)
    },
    async listarEmpresas() {
      const { data, error } = await client.rpc('agendamento_listar_empresas', { p_tenant: TENANT })
      if (error) throw new Error(error.message)
      return (data ?? []).map((e: { id: number; nome?: string; codigo?: string }) => ({ id: e.id, nome: e.nome || e.codigo || String(e.id) }))
    },
    async listarVeiculos(empresaId) {
      const { data, error } = await client.rpc('agendamento_listar_veiculos', { p_tenant: TENANT })
      if (error) throw new Error(error.message)
      return (data ?? [])
        .filter((v: { empresa_id: number }) => String(v.empresa_id) === String(empresaId))
        .map((v: { id: number; empresa_id: number; placa?: string; modelo?: string }) => ({ id: v.id, empresaId: v.empresa_id, placa: v.placa ?? '', modelo: v.modelo ?? '' }))
    },
    async listarDiasComVaga() {
      const hoje = agoraFortaleza()
      const hojeISO = dataISO(hoje)
      const dias: Array<{ dia: string; vagasDia: number }> = []
      for (const offsetMes of [0, 1]) {
        const ref = new Date(hoje.getFullYear(), hoje.getMonth() + offsetMes, 1)
        const { data, error } = await client.rpc('agendamento_ocupacao_mes', { p_tenant: TENANT, p_ano: ref.getFullYear(), p_mes: ref.getMonth() + 1 })
        if (error) throw new Error(error.message)
        for (const d of data ?? []) {
          if (d.tem_vaga && d.dia >= hojeISO) dias.push({ dia: d.dia, vagasDia: d.vagas_dia })
        }
      }
      return dias
    },
    async listarHorariosDoDia(diaISO) {
      const { data, error } = await client.rpc('agendamento_ocupacao_dia', { p_tenant: TENANT, p_data: diaISO })
      if (error) throw new Error(error.message)
      return (data ?? []).map((h: { hora: number; vagas: number; capacidade: number }) => ({ hora: h.hora, vagas: h.vagas, capacidade: h.capacidade }))
    },
    async solicitarAgendamento(input) {
      const { data, error } = await client.rpc('agendamento_solicitar', {
        p_tenant: TENANT, p_nome: input.nome, p_contato: input.contato, p_empresa_id: input.empresaId,
        p_veiculo_id: input.veiculoId, p_tipo: input.tipo, p_descricao: input.descricao, p_inicio: input.inicioISO,
      })
      if (error) throw new Error(error.message)
      const protocolo = data?.[0]?.protocolo
      if (!protocolo) throw new Error('RPC agendamento_solicitar não retornou protocolo')
      const { data: linha } = await client.from('agendamentos_externos').select('status').eq('protocolo', protocolo).eq('tenant', TENANT).maybeSingle()
      return { protocolo, status: linha?.status ?? 'pendente' }
    },
    async enviarMensagem(telefone, texto) {
      await enviarMensagemWhatsApp(evolutionConfig, telefone, texto)
    },
    extrairMensagem: extrairMensagemRecebida,
  }
}

Deno.serve(createWhatsAppAgendamentoHandler(gateway))
