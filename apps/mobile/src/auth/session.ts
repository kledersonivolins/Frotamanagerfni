import type { EffectiveScope } from '../domain/contracts'

const OFFLINE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export interface SessionTokens {
  accessToken: string
  refreshToken: string
}

export interface AuthGateway {
  signIn(email: string, password: string): Promise<SessionTokens>
  getEffectiveScope(): Promise<Omit<EffectiveScope, 'validatedAt' | 'expiresAt'>>
  signOut(): Promise<void>
}

export interface SessionStore {
  getScope(): Promise<EffectiveScope | null>
  setScope(scope: EffectiveScope): Promise<void>
  setTokens(tokens: SessionTokens): Promise<void>
  clear(): Promise<void>
}

export interface SessionDependencies {
  gateway: AuthGateway
  store: SessionStore
  isOnline: () => boolean
  now: () => Date
}

export type OfflineAccess = 'write' | 'read-only' | 'none'

export function offlineAccess(scope: EffectiveScope | null, now: Date): OfflineAccess {
  if (!scope) return 'none'
  return now.getTime() < Date.parse(scope.expiresAt) ? 'write' : 'read-only'
}

export function createSessionService(dependencies: SessionDependencies) {
  return {
    async loginOnline(email: string, password: string): Promise<EffectiveScope> {
      if (!dependencies.isOnline()) {
        throw new Error('FIRST_LOGIN_REQUIRES_INTERNET')
      }

      const tokens = await dependencies.gateway.signIn(email.trim().toLowerCase(), password)
      try {
        const grantedScope = await dependencies.gateway.getEffectiveScope()
        if (!grantedScope.permissions.includes('mobile.access')) {
          throw new Error('MOBILE_ACCESS_DENIED')
        }

        const validatedAt = dependencies.now()
        const scope: EffectiveScope = {
          ...grantedScope,
          validatedAt: validatedAt.toISOString(),
          expiresAt: new Date(validatedAt.getTime() + OFFLINE_WINDOW_MS).toISOString(),
        }

        await dependencies.store.setTokens(tokens)
        await dependencies.store.setScope(scope)
        return scope
      } catch (error) {
        await dependencies.store.clear()
        await dependencies.gateway.signOut()
        throw error
      }
    },

    async getOfflineAccess(now = dependencies.now()): Promise<OfflineAccess> {
      return offlineAccess(await dependencies.store.getScope(), now)
    },

    async logout(): Promise<void> {
      try {
        if (dependencies.isOnline()) await dependencies.gateway.signOut()
      } finally {
        await dependencies.store.clear()
      }
    },
  }
}

export type SessionService = ReturnType<typeof createSessionService>
