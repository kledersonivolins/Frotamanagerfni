import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { EffectiveScope } from '../domain/contracts'
import type { AuthGateway } from './session'

const scopeSchema = z.object({
  tenant: z.string().min(1),
  user_id: z.string().min(1),
  company_ids: z.array(z.string()),
  sector_ids: z.array(z.string()),
  vehicle_ids: z.array(z.string()),
  driver_ids: z.array(z.string()),
  permissions: z.array(z.string()),
})

export function createSupabaseAuthGateway(client: SupabaseClient): AuthGateway {
  return {
    async signIn(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email, password })
      if (error) throw new Error(error.message)
      if (!data.session) throw new Error('AUTH_SESSION_MISSING')
      return {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
      }
    },

    async getEffectiveScope(): Promise<Omit<EffectiveScope, 'validatedAt' | 'expiresAt'>> {
      const { data, error } = await client.rpc('get_mobile_scope')
      if (error) throw new Error(error.message)
      const scope = scopeSchema.parse(data)
      return {
        tenant: scope.tenant,
        userId: scope.user_id,
        companyIds: scope.company_ids,
        sectorIds: scope.sector_ids,
        vehicleIds: scope.vehicle_ids,
        driverIds: scope.driver_ids,
        permissions: scope.permissions,
      }
    },

    async signOut() {
      const { error } = await client.auth.signOut()
      if (error) throw new Error(error.message)
    },
  }
}
