import { describe, expect, it } from 'vitest'
import { createSupabaseAuthGateway } from './gateway'

describe('Supabase auth gateway', () => {
  it('maps auth tokens and the effective scope RPC', async () => {
    const client = {
      auth: {
        signInWithPassword: async () => ({
          data: { session: { access_token: 'access', refresh_token: 'refresh' } },
          error: null,
        }),
        signOut: async () => ({ error: null }),
      },
      rpc: async () => ({
        data: {
          tenant: 'oficinafni', user_id: 'user-1', company_ids: ['company-1'],
          sector_ids: ['sector-1'], vehicle_ids: ['vehicle-1'], driver_ids: ['driver-1'],
          permissions: ['mobile.access'],
        },
        error: null,
      }),
    }
    const gateway = createSupabaseAuthGateway(client as never)

    expect(await gateway.signIn('user@example.com', 'secret')).toEqual({
      accessToken: 'access', refreshToken: 'refresh',
    })
    expect(await gateway.getEffectiveScope()).toMatchObject({
      tenant: 'oficinafni', userId: 'user-1', companyIds: ['company-1'],
    })
  })
})
