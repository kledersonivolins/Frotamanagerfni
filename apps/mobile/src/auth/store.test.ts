import { describe, expect, it } from 'vitest'
import type { EffectiveScope } from '../domain/contracts'
import { createSecureSessionStore } from './store'

describe('secure session store', () => {
  it('keeps tokens in secure storage and scope in database metadata', async () => {
    const secureValues = new Map<string, string>()
    const metadata = new Map<string, string>()
    const store = createSecureSessionStore({
      secureStorage: {
        getItem: async key => secureValues.get(key) ?? null,
        setItem: async (key, value) => { secureValues.set(key, value) },
        removeItem: async key => { secureValues.delete(key) },
      },
      metadata: {
        readMetadata: async key => metadata.get(key) ?? null,
        writeMetadata: async (key, value) => { metadata.set(key, value) },
        deleteMetadata: async key => { metadata.delete(key) },
      },
    })
    const scope = { tenant: 'oficinafni', permissions: ['mobile.access'] } as EffectiveScope

    await store.setTokens({ accessToken: 'access', refreshToken: 'refresh' })
    await store.setScope(scope)

    expect(secureValues.get('session_tokens')).toContain('refresh')
    expect(metadata.get('effective_scope')).toContain('oficinafni')
    expect(await store.getScope()).toEqual(scope)

    await store.clear()
    expect(secureValues.size).toBe(0)
    expect(metadata.size).toBe(0)
  })
})
