import type { SyncOperation } from '../domain/contracts'
import type { EntityTable, MobileDatabase } from './database'

export interface SaveWithOperationInput {
  table: EntityTable
  entityId: string
  json: Record<string, unknown>
  operation: SyncOperation
}

export async function saveWithOperation(
  database: MobileDatabase,
  input: SaveWithOperationInput,
): Promise<void> {
  if (input.entityId !== input.operation.entityId) {
    throw new Error('O registro e a operação precisam usar o mesmo identificador')
  }

  await database.transaction(async transaction => {
    await transaction.upsert(input.table, input.entityId, input.json)
    await transaction.insertOutbox(input.operation)
  })
}

export function listPendingOperations(
  database: MobileDatabase,
  limit: number,
): Promise<SyncOperation[]> {
  return database.listPendingOperations(limit)
}
