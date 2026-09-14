import 'jsr:@supabase/functions-js@2.4.4/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2.57.4'
import { createMobileSyncHandler, type MobileSyncGateway } from './handler.ts'

function gateway(authorization: string): MobileSyncGateway {
  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } },
  )

  return {
    async authenticate(header) {
      const token = header.replace(/^Bearer\s+/i, '')
      const { data, error } = await client.auth.getUser(token)
      return error || !data.user ? null : { userId: data.user.id }
    },
    async getScope() {
      const { data, error } = await client.rpc('get_mobile_scope')
      if (error || !data?.tenant) throw new Error(error?.message ?? 'Escopo mobile não disponível')
      return data
    },
    async registerDevice(input) {
      const { error } = await client.from('mobile_devices').upsert({
        id: input.deviceId,
        tenant: input.tenant,
        user_id: input.userId,
        name: input.name,
        platform: input.platform,
        app_version: input.appVersion,
        last_seen_at: new Date().toISOString(),
      }, { onConflict: 'id' })
      if (error) throw new Error(error.message)
    },
    async process(deviceId, operation) {
      const { data, error } = await client.rpc('process_mobile_operation', {
        p_device_id: deviceId,
        p_operation: operation,
      })
      if (error) throw new Error(error.message)
      return data
    },
    async pull(cursor) {
      let query = client.from('mobile_audit_events')
        .select('id,entity_type,entity_id,server_version,payload,created_at')
        .order('created_at').order('id').limit(500)
      if (cursor) query = query.gt('created_at', cursor)
      const { data, error } = await query
      if (error) throw new Error(error.message)
      return (data ?? []).map(row => ({
        entityType: row.entity_type,
        entityId: row.entity_id,
        serverVersion: row.server_version,
        deleted: row.payload?.deleted === true,
        payload: row.payload,
        updatedAt: row.created_at,
        cursor: row.created_at,
      }))
    },
  }
}

export const handler = createMobileSyncHandler(gateway)
Deno.serve(handler)
