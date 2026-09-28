// supabase/functions/whatsapp-lista-espera/index.ts
import 'jsr:@supabase/functions-js@2.4.4/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2.57.4'
import { createListaEsperaHandler, ofertaJaRecusada, type ListaEsperaGateway } from './handler.ts'
import { enviarMensagemWhatsApp } from '../whatsapp-agendamento/evolution.ts'

const TENANT = 'oficinafni'

// A Edge Function roda em UTC; o "hoje" da oficina é em America/Fortaleza (UTC-3).
function agoraFortaleza(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Fortaleza' }))
}

function dataISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function gateway(): ListaEsperaGateway {
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
    async listarSessoesEmEspera() {
      const { data, error } = await client.from('whatsapp_conversas')
        .select('telefone,dados').eq('tenant', TENANT).eq('etapa', 'lista_espera')
      if (error) throw new Error(error.message)
      return (data ?? []).map(r => ({ telefone: r.telefone, dados: r.dados ?? {} }))
    },
    async primeiroHorarioLivre(dados) {
      const hoje = agoraFortaleza()
      const hojeISO = dataISO(hoje)
      for (const offsetMes of [0, 1]) {
        const ref = new Date(hoje.getFullYear(), hoje.getMonth() + offsetMes, 1)
        const { data: dias, error } = await client.rpc('agendamento_ocupacao_mes', { p_tenant: TENANT, p_ano: ref.getFullYear(), p_mes: ref.getMonth() + 1 })
        if (error) throw new Error(error.message)
        for (const d of dias ?? []) {
          if (!d.tem_vaga || d.dia < hojeISO) continue
          const { data: horas, error: erroHoras } = await client.rpc('agendamento_ocupacao_dia', { p_tenant: TENANT, p_data: d.dia })
          if (erroHoras) throw new Error(erroHoras.message)
          for (const h of (horas ?? []) as Array<{ hora: number; vagas: number }>) {
            if (h.vagas <= 0) continue
            const hora = `${String(h.hora).padStart(2, '0')}:00`
            // Pula horário que este cliente já recusou, senão a mesma oferta se repetiria para sempre.
            if (ofertaJaRecusada(dados, d.dia, hora)) continue
            return { dia: d.dia, hora }
          }
        }
      }
      return null
    },
    async salvarSessao(telefone, etapa, dados) {
      const { error } = await client.from('whatsapp_conversas').upsert({
        tenant: TENANT, telefone, etapa, dados, atualizado_em: new Date().toISOString(),
      }, { onConflict: 'tenant,telefone' })
      if (error) throw new Error(error.message)
    },
    async enviarMensagem(telefone, texto) {
      await enviarMensagemWhatsApp(evolutionConfig, telefone, texto)
    },
  }
}

Deno.serve(createListaEsperaHandler(gateway))
