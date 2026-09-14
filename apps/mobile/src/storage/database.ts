import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite'
import type { ChangeRecord, SyncOperation } from '../domain/contracts'

export type EntityTable =
  | 'reference_records'
  | 'loans'
  | 'loan_checklists'
  | 'work_orders'
  | 'work_order_entries'
  | 'drafts'
  | 'attachments'

export interface MobileTransaction {
  upsert(table: EntityTable, entityId: string, json: Record<string, unknown>): Promise<void>
  insertOutbox(operation: SyncOperation): Promise<void>
}

export interface MobileDatabase {
  transaction<T>(work: (transaction: MobileTransaction) => Promise<T>): Promise<T>
  listPendingOperations(limit: number): Promise<SyncOperation[]>
  readMetadata(key: string): Promise<string | null>
  writeMetadata(key: string, value: string): Promise<void>
  deleteMetadata(key: string): Promise<void>
  markOperationSynced(operationId: string): Promise<void>
  markOperationAttention(operationId: string, code: string, message?: string): Promise<void>
  markOperationRetry(operationId: string, message: string): Promise<void>
  applyChangesAndCursor(changes: ChangeRecord[], cursor: string): Promise<void>
  countOperations(state: 'pending' | 'attention'): Promise<number>
}

const DATABASE_NAME = 'frotamanager_mobile'
const DATABASE_VERSION = 1

const SCHEMA_VERSION_1 = `
CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reference_records (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT,
  status TEXT,
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS loans (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT,
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS loan_checklists (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT,
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS work_orders (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT,
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS work_order_entries (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT,
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT,
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT,
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS outbox (
  operation_id TEXT PRIMARY KEY NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  base_version INTEGER,
  payload TEXT NOT NULL,
  device_created_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outbox_state_created
  ON outbox(state, created_at);
CREATE TABLE IF NOT EXISTS conflicts (
  operation_id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL,
  message TEXT,
  server_payload TEXT,
  created_at TEXT NOT NULL
);
PRAGMA user_version = 1;
`

const sqlite = new SQLiteConnection(CapacitorSQLite)

export async function runMigrations(connection: SQLiteDBConnection): Promise<void> {
  const versionResult = await connection.query('PRAGMA user_version;')
  const version = Number(versionResult.values?.[0]?.user_version ?? 0)

  if (version < 1) {
    await connection.execute(SCHEMA_VERSION_1, true)
  }

  if (version > DATABASE_VERSION) {
    throw new Error(`Banco local ${version} é mais novo que o aplicativo ${DATABASE_VERSION}`)
  }
}

export async function openDatabase(encryptionSecret?: string): Promise<MobileDatabase> {
  const encrypted = Boolean(encryptionSecret)
  if (encryptionSecret) {
    const stored = await sqlite.isSecretStored()
    if (!stored.result) await sqlite.setEncryptionSecret(encryptionSecret)
  }

  const connection = await sqlite.createConnection(
    DATABASE_NAME,
    encrypted,
    encrypted ? 'secret' : 'no-encryption',
    DATABASE_VERSION,
    false,
  )
  await connection.open()
  await runMigrations(connection)
  return new SqliteMobileDatabase(connection)
}

class SqliteMobileDatabase implements MobileDatabase {
  constructor(private readonly connection: SQLiteDBConnection) {}

  async transaction<T>(work: (transaction: MobileTransaction) => Promise<T>): Promise<T> {
    await this.connection.beginTransaction()
    try {
      const result = await work(new SqliteMobileTransaction(this.connection))
      await this.connection.commitTransaction()
      return result
    } catch (error) {
      await this.connection.rollbackTransaction()
      throw error
    }
  }

  async listPendingOperations(limit: number): Promise<SyncOperation[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)))
    const result = await this.connection.query(
      `SELECT operation_id, entity_type, entity_id, kind, base_version,
              payload, device_created_at
         FROM outbox
        WHERE state = 'pending'
        ORDER BY created_at, operation_id
        LIMIT ?`,
      [safeLimit],
    )

    return (result.values ?? []).map(row => ({
      operationId: String(row.operation_id),
      entityType: row.entity_type,
      entityId: String(row.entity_id),
      kind: row.kind,
      baseVersion: row.base_version === null ? null : Number(row.base_version),
      payload: JSON.parse(String(row.payload)),
      deviceCreatedAt: String(row.device_created_at),
    }) as SyncOperation)
  }

  async readMetadata(key: string): Promise<string | null> {
    const result = await this.connection.query(
      'SELECT value FROM metadata WHERE key = ? LIMIT 1',
      [key],
    )
    return result.values?.length ? String(result.values[0].value) : null
  }

  async writeMetadata(key: string, value: string): Promise<void> {
    await this.connection.run(
      `INSERT INTO metadata (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value],
      true,
    )
  }

  async deleteMetadata(key: string): Promise<void> {
    await this.connection.run('DELETE FROM metadata WHERE key = ?', [key], true)
  }

  async markOperationSynced(operationId: string): Promise<void> {
    await this.connection.run("UPDATE outbox SET state = 'synced', last_error = NULL WHERE operation_id = ?", [operationId], true)
  }

  async markOperationAttention(operationId: string, code: string, message?: string): Promise<void> {
    await this.connection.beginTransaction()
    try {
      await this.connection.run("UPDATE outbox SET state = 'attention', last_error = ? WHERE operation_id = ?", [message ?? code, operationId], false)
      await this.connection.run(
        `INSERT INTO conflicts(operation_id, code, message, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(operation_id) DO UPDATE SET code=excluded.code, message=excluded.message`,
        [operationId, code, message ?? null, new Date().toISOString()], false,
      )
      await this.connection.commitTransaction()
    } catch (error) {
      await this.connection.rollbackTransaction()
      throw error
    }
  }

  async markOperationRetry(operationId: string, message: string): Promise<void> {
    await this.connection.run(
      "UPDATE outbox SET state = 'pending', attempts = attempts + 1, last_error = ? WHERE operation_id = ?",
      [message, operationId], true,
    )
  }

  async applyChangesAndCursor(changes: ChangeRecord[], cursor: string): Promise<void> {
    await this.connection.beginTransaction()
    try {
      const tx = new SqliteMobileTransaction(this.connection)
      for (const change of changes) {
        const table = entityTable(change.entityType)
        await tx.upsert(table, change.entityId, { ...change.payload, serverVersion: change.serverVersion, deleted: change.deleted })
      }
      await this.connection.run(
        `INSERT INTO metadata(key,value) VALUES ('sync_cursor',?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [cursor], false,
      )
      await this.connection.commitTransaction()
    } catch (error) {
      await this.connection.rollbackTransaction()
      throw error
    }
  }

  async countOperations(state: 'pending' | 'attention'): Promise<number> {
    const result = await this.connection.query('SELECT count(*) AS total FROM outbox WHERE state = ?', [state])
    return Number(result.values?.[0]?.total ?? 0)
  }
}

function entityTable(entityType: SyncOperation['entityType']): EntityTable {
  return ({
    loan: 'loans', loan_checklist: 'loan_checklists', work_order: 'work_orders',
    work_order_entry: 'work_order_entries', attachment: 'attachments',
  } as const)[entityType]
}

class SqliteMobileTransaction implements MobileTransaction {
  constructor(private readonly connection: SQLiteDBConnection) {}

  async upsert(table: EntityTable, entityId: string, json: Record<string, unknown>): Promise<void> {
    const status = typeof json.status === 'string' ? json.status : null
    const updatedAt = new Date().toISOString()
    await this.connection.run(
      `INSERT INTO ${table} (id, status, json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         json = excluded.json,
         updated_at = excluded.updated_at`,
      [entityId, status, JSON.stringify(json), updatedAt],
      false,
    )
  }

  async insertOutbox(operation: SyncOperation): Promise<void> {
    await this.connection.run(
      `INSERT INTO outbox (
        operation_id, entity_type, entity_id, kind, base_version,
        payload, device_created_at, state, attempts, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)`,
      [
        operation.operationId,
        operation.entityType,
        operation.entityId,
        operation.kind,
        operation.baseVersion,
        JSON.stringify(operation.payload),
        operation.deviceCreatedAt,
        new Date().toISOString(),
      ],
      false,
    )
  }
}
