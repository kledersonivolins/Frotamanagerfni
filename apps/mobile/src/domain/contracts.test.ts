import { describe, expect, it } from 'vitest'
import { parseSyncResult } from './contracts'

describe('parseSyncResult', () => {
  it('accepts an idempotent acknowledgement', () => {
    expect(parseSyncResult({
      operationId: 'op-1',
      outcome: 'duplicate',
      serverVersion: 3,
    }).outcome).toBe('duplicate')
  })

  it('rejects unknown outcomes', () => {
    expect(() => parseSyncResult({
      operationId: 'op-1',
      outcome: 'lost',
    })).toThrow()
  })
})
