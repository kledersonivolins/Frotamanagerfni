import type { MobileDatabase } from '../storage/database'
import type { SyncRepository } from './client'

export const createSyncRepository = (database: MobileDatabase): SyncRepository => ({
  pending: limit => database.listPendingOperations(limit),
  cursor: () => database.readMetadata('sync_cursor'),
  synced: id => database.markOperationSynced(id),
  attention: (id, code, message) => database.markOperationAttention(id, code, message),
  retry: (id, message) => database.markOperationRetry(id, message),
  apply: (changes, cursor) => database.applyChangesAndCursor(changes, cursor),
})
