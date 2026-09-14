import { createContext, useContext, useMemo, useState, type PropsWithChildren } from 'react'
import type { SyncSummary, SyncState } from '../domain/contracts'

interface SyncContextValue {
  state: SyncState
  pendingCount: number
  conflicts: number
  lastSuccess: string | null
  synchronize(): Promise<SyncSummary>
}

const SyncContext = createContext<SyncContextValue | null>(null)

export function SyncProvider({ run, children }: PropsWithChildren<{ run: () => Promise<SyncSummary> }>) {
  const [state, setState] = useState<SyncState>('synced')
  const [pendingCount, setPendingCount] = useState(0)
  const [conflicts, setConflicts] = useState(0)
  const [lastSuccess, setLastSuccess] = useState<string | null>(null)
  const value = useMemo<SyncContextValue>(() => ({ state, pendingCount, conflicts, lastSuccess, async synchronize() {
    setState('syncing')
    try {
      const summary = await run()
      setPendingCount(summary.rejected + summary.conflicts)
      setConflicts(summary.conflicts)
      setState(summary.rejected + summary.conflicts ? 'attention' : 'synced')
      setLastSuccess(new Date().toISOString())
      return summary
    } catch (error) {
      setState('pending')
      setPendingCount(value => Math.max(1, value))
      throw error
    }
  } }), [conflicts, lastSuccess, pendingCount, run, state])
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}

export function useSync() {
  const value = useContext(SyncContext)
  if (!value) throw new Error('useSync precisa ser usado dentro de SyncProvider')
  return value
}
