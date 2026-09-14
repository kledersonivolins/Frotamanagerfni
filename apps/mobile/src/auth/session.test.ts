import { describe, expect, it } from 'vitest'
import type { EffectiveScope } from '../domain/contracts'
import {
  createSessionService,
  offlineAccess,
  type AuthGateway,
  type SessionStore,
} from './session'

const baseScope: Omit<EffectiveScope, 'validatedAt' | 'expiresAt'> = {
  tenant: 'oficinafni',
  userId: 'user-1',
  companyIds: ['company-1'],
  sectorIds: ['sector-1'],
  vehicleIds: ['vehicle-1'],
  driverIds: ['driver-1'],
  permissions: ['mobile.access', 'loan.request'],
}

class MemorySessionStore implements SessionStore {
  scope: EffectiveScope | null = null
  tokens: { accessToken: string; refreshToken: string } | null = null

  async getScope() { return this.scope }
  async setScope(scope: EffectiveScope) { this.scope = scope }
  async setTokens(tokens: { accessToken: string; refreshToken: string }) { this.tokens = tokens }
  async clear() { this.scope = null; this.tokens = null }
}

const gateway: AuthGateway = {
  async signIn() {
    return { accessToken: 'access', refreshToken: 'refresh' }
  },
  async getEffectiveScope() {
    return baseScope
  },
  async signOut() {},
}

describe('offline authorization', () => {
  it('allows writes before seven days and becomes read-only after expiry', () => {
    const scope: EffectiveScope = {
      ...baseScope,
      validatedAt: '2026-09-01T12:00:00.000Z',
      expiresAt: '2026-09-08T12:00:00.000Z',
    }

    expect(offlineAccess(scope, new Date('2026-09-08T11:59:59.999Z'))).toBe('write')
    expect(offlineAccess(scope, new Date('2026-09-08T12:00:00.000Z'))).toBe('read-only')
  })

  it('requires a connection for the first login', async () => {
    const service = createSessionService({
      gateway,
      store: new MemorySessionStore(),
      isOnline: () => false,
      now: () => new Date('2026-09-14T12:00:00.000Z'),
    })

    await expect(service.loginOnline('user@example.com', 'secret'))
      .rejects.toThrow('FIRST_LOGIN_REQUIRES_INTERNET')
  })

  it('stores tokens and a scope valid for exactly seven days', async () => {
    const store = new MemorySessionStore()
    const service = createSessionService({
      gateway,
      store,
      isOnline: () => true,
      now: () => new Date('2026-09-14T12:00:00.000Z'),
    })

    const scope = await service.loginOnline('user@example.com', 'secret')

    expect(scope.validatedAt).toBe('2026-09-14T12:00:00.000Z')
    expect(scope.expiresAt).toBe('2026-09-21T12:00:00.000Z')
    expect(store.tokens).toEqual({ accessToken: 'access', refreshToken: 'refresh' })
    expect(store.scope).toEqual(scope)
  })
})
