import { z } from 'zod'

export type ConnectionState = 'online' | 'offline'
export type SyncState = 'synced' | 'pending' | 'syncing' | 'attention'
export type OperationKind = 'create' | 'update' | 'transition' | 'delete' | 'attach'
export type MobileEntityType =
  | 'loan'
  | 'loan_checklist'
  | 'work_order'
  | 'work_order_entry'
  | 'attachment'

export interface EffectiveScope {
  tenant: string
  userId: string
  companyIds: string[]
  sectorIds: string[]
  vehicleIds: string[]
  driverIds: string[]
  permissions: string[]
  validatedAt: string
  expiresAt: string
}

export interface SyncOperation {
  operationId: string
  entityType: MobileEntityType
  entityId: string
  kind: OperationKind
  baseVersion: number | null
  payload: Record<string, unknown>
  deviceCreatedAt: string
}

export interface ChangeRecord {
  entityType: MobileEntityType
  entityId: string
  serverVersion: number
  deleted: boolean
  payload: Record<string, unknown>
  updatedAt: string
}

export interface SyncSummary {
  accepted: number
  duplicates: number
  rejected: number
  conflicts: number
  nextCursor: string
}

const syncResultSchema = z.object({
  operationId: z.string().min(1),
  outcome: z.enum(['accepted', 'duplicate', 'rejected', 'conflict']),
  serverVersion: z.number().int().nonnegative().optional(),
  serverEntityId: z.string().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
})

export type SyncResult = z.infer<typeof syncResultSchema>

export const parseSyncResult = (input: unknown): SyncResult =>
  syncResultSchema.parse(input)
