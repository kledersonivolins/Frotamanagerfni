import { SecureStorage } from '@aparajita/capacitor-secure-storage'
import type { EffectiveScope } from '../domain/contracts'
import type { SessionStore, SessionTokens } from './session'

const TOKENS_KEY = 'session_tokens'
const SCOPE_KEY = 'effective_scope'

export interface SecureKeyValueStore {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

export interface MetadataStore {
  readMetadata(key: string): Promise<string | null>
  writeMetadata(key: string, value: string): Promise<void>
  deleteMetadata(key: string): Promise<void>
}

export interface SecureSessionStoreDependencies {
  secureStorage: SecureKeyValueStore
  metadata: MetadataStore
}

export function createSecureSessionStore(
  dependencies: SecureSessionStoreDependencies,
): SessionStore {
  return {
    async getScope() {
      const value = await dependencies.metadata.readMetadata(SCOPE_KEY)
      return value ? JSON.parse(value) as EffectiveScope : null
    },

    async setScope(scope: EffectiveScope) {
      await dependencies.metadata.writeMetadata(SCOPE_KEY, JSON.stringify(scope))
    },

    async setTokens(tokens: SessionTokens) {
      await dependencies.secureStorage.setItem(TOKENS_KEY, JSON.stringify(tokens))
    },

    async clear() {
      await Promise.all([
        dependencies.secureStorage.removeItem(TOKENS_KEY),
        dependencies.metadata.deleteMetadata(SCOPE_KEY),
      ])
    },
  }
}

export function createNativeSessionStore(metadata: MetadataStore): SessionStore {
  return createSecureSessionStore({
    secureStorage: SecureStorage,
    metadata,
  })
}
