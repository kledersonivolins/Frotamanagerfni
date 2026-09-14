import { describe, expect, it } from 'vitest'
import type { SyncOperation, SyncResult } from '../domain/contracts'
import { synchronize, type SyncRepository } from './client'

const operations: SyncOperation[] = [
  { operationId: 'a', entityType: 'loan', entityId: '1', kind: 'create', baseVersion: null, payload: {}, deviceCreatedAt: '2026-09-14T12:00:00Z' },
  { operationId: 'b', entityType: 'work_order', entityId: '2', kind: 'update', baseVersion: 1, payload: {}, deviceCreatedAt: '2026-09-14T12:00:00Z' },
]

it('confirma aceitos e preserva conflitos para atenção', async () => {
  const states = new Map([['a', 'pending'], ['b', 'pending']])
  const repository: SyncRepository = {
    pending: async () => operations,
    cursor: async () => null,
    synced: async id => { states.set(id, 'synced') },
    attention: async id => { states.set(id, 'attention') },
    retry: async () => undefined,
    apply: async () => undefined,
  }
  const results: SyncResult[] = [
    { operationId: 'a', outcome: 'accepted', serverVersion: 1 },
    { operationId: 'b', outcome: 'conflict', code: 'VERSION_CONFLICT' },
  ]
  const summary = await synchronize({ repository, transport: { exchange: async () => ({ results, changes: [], nextCursor: 'c1' }) } })
  expect(summary).toMatchObject({ accepted: 1, conflicts: 1 })
  expect(states.get('a')).toBe('synced')
  expect(states.get('b')).toBe('attention')
})

it('mantém falha transitória pendente', async () => {
  let retried = false
  const repository: SyncRepository = {
    pending: async () => operations.slice(0, 1), cursor: async () => null,
    synced: async () => undefined, attention: async () => undefined,
    retry: async () => { retried = true }, apply: async () => undefined,
  }
  await expect(synchronize({ repository, transport: { exchange: async () => { throw new Error('offline') } } })).rejects.toThrow('offline')
  expect(retried).toBe(true)
})
