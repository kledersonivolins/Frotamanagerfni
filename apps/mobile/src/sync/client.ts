import { parseSyncResult, type ChangeRecord, type SyncOperation, type SyncSummary } from '../domain/contracts'

export interface SyncRepository {
  pending(limit: number): Promise<SyncOperation[]>
  cursor(): Promise<string | null>
  synced(id: string): Promise<void>
  attention(id: string, code: string, message?: string): Promise<void>
  retry(id: string, message: string): Promise<void>
  apply(changes: ChangeRecord[], cursor: string): Promise<void>
}

export interface SyncTransport {
  exchange(input: { operations: SyncOperation[]; cursor: string | null }): Promise<{
    results: unknown[]; changes: ChangeRecord[]; nextCursor: string
  }>
}

export async function synchronize(deps: { repository: SyncRepository; transport: SyncTransport }): Promise<SyncSummary> {
  const operations = await deps.repository.pending(50)
  const cursor = await deps.repository.cursor()
  let response
  try {
    response = await deps.transport.exchange({ operations, cursor })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SYNC_TRANSIENT_FAILURE'
    await Promise.all(operations.map(item => deps.repository.retry(item.operationId, message)))
    throw error
  }

  const summary: SyncSummary = { accepted: 0, duplicates: 0, rejected: 0, conflicts: 0, nextCursor: response.nextCursor }
  for (const raw of response.results) {
    const result = parseSyncResult(raw)
    if (result.outcome === 'accepted' || result.outcome === 'duplicate') {
      await deps.repository.synced(result.operationId)
      if (result.outcome === 'accepted') summary.accepted++
      else summary.duplicates++
    } else {
      await deps.repository.attention(result.operationId, result.code ?? result.outcome.toUpperCase(), result.message)
      if (result.outcome === 'conflict') summary.conflicts++
      else summary.rejected++
    }
  }
  await deps.repository.apply(response.changes, response.nextCursor)
  return summary
}
