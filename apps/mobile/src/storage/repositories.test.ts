import { describe, expect, it } from 'vitest'
import type { SyncOperation } from '../domain/contracts'
import type { EntityTable, MobileDatabase, MobileTransaction } from './database'
import {
  deleteMetadata,
  listPendingOperations,
  readMetadata,
  saveWithOperation,
  writeMetadata,
} from './repositories'

const operation: SyncOperation = {
  operationId: 'op-1',
  entityType: 'work_order',
  entityId: 'os-1',
  kind: 'create',
  baseVersion: null,
  payload: { status: 'open' },
  deviceCreatedAt: '2026-09-14T12:00:00.000Z',
}

class MemoryDatabase implements MobileDatabase {
  readonly entities = new Map<string, Record<string, unknown>>()
  readonly outbox = new Map<string, SyncOperation>()
  readonly metadata = new Map<string, string>()
  failOutboxInsert = false

  async transaction<T>(work: (transaction: MobileTransaction) => Promise<T>): Promise<T> {
    const entitySnapshot = new Map(this.entities)
    const outboxSnapshot = new Map(this.outbox)
    try {
      return await work({
        upsert: async (table, entityId, json) => {
          this.entities.set(`${table}:${entityId}`, structuredClone(json))
        },
        insertOutbox: async item => {
          if (this.failOutboxInsert) throw new Error('forced outbox failure')
          this.outbox.set(item.operationId, structuredClone(item))
        },
      })
    } catch (error) {
      this.entities.clear()
      this.outbox.clear()
      entitySnapshot.forEach((value, key) => this.entities.set(key, value))
      outboxSnapshot.forEach((value, key) => this.outbox.set(key, value))
      throw error
    }
  }

  async listPendingOperations(limit: number): Promise<SyncOperation[]> {
    return [...this.outbox.values()].slice(0, limit)
  }

  async readMetadata(key: string) { return this.metadata.get(key) ?? null }
  async writeMetadata(key: string, value: string) { this.metadata.set(key, value) }
  async deleteMetadata(key: string) { this.metadata.delete(key) }
  async markOperationSynced(operationId: string) { this.outbox.delete(operationId) }
  async markOperationAttention(operationId: string) { this.outbox.delete(operationId) }
  async markOperationRetry() { return undefined }
  async applyChangesAndCursor() { return undefined }
  async countOperations() { return this.outbox.size }

  entity(table: EntityTable, id: string) {
    return this.entities.get(`${table}:${id}`)
  }
}

describe('local repositories', () => {
  it('stores the entity and outbox operation in one transaction', async () => {
    const database = new MemoryDatabase()

    await saveWithOperation(database, {
      table: 'work_orders',
      entityId: 'os-1',
      json: { status: 'open' },
      operation,
    })

    expect(database.entity('work_orders', 'os-1')).toEqual({ status: 'open' })
    expect(await listPendingOperations(database, 10)).toEqual([operation])
  })

  it('rolls the entity back when the outbox insert fails', async () => {
    const database = new MemoryDatabase()
    database.failOutboxInsert = true

    await expect(saveWithOperation(database, {
      table: 'work_orders',
      entityId: 'os-1',
      json: { status: 'open' },
      operation,
    })).rejects.toThrow('forced outbox failure')

    expect(database.entity('work_orders', 'os-1')).toBeUndefined()
    expect(await listPendingOperations(database, 10)).toEqual([])
  })

  it('stores and removes metadata used by the offline session', async () => {
    const database = new MemoryDatabase()

    await writeMetadata(database, 'effective_scope', '{"tenant":"oficinafni"}')
    expect(await readMetadata(database, 'effective_scope')).toBe('{"tenant":"oficinafni"}')

    await deleteMetadata(database, 'effective_scope')
    expect(await readMetadata(database, 'effective_scope')).toBeNull()
  })
})
