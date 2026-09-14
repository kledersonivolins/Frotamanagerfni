import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { EffectiveScope } from '../domain/contracts'
import type { AuthGateway } from './session'

const scopeSchema = z.object({
  tenant: z.string().min(1),
  userId: z.string().min(1),
  companyIds: z.array(z.string()),
  sectorIds: z.array(z.string()),
  vehicleIds: z.array(z.string()),
  driverIds: z.array(z.string()),
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
        userId: scope.userId,
        companyIds: scope.companyIds,
        sectorIds: scope.sectorIds,
        vehicleIds: scope.vehicleIds,
        driverIds: scope.driverIds,
        permissions: scope.permissions,
      }
    },

    async signOut() {
      const { error } = await client.auth.signOut()
      if (error) throw new Error(error.message)
    },
  }
}
