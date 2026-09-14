import { useSync } from '../../sync/SyncProvider'

export function SyncScreen() {
  const sync = useSync()
  return <section aria-labelledby="sync-title">
    <h2 id="sync-title">Sincronização</h2>
    <p>Estado: {sync.state}</p>
    <p>Pendentes: {sync.pendingCount}</p>
    <p>Precisam de atenção: {sync.conflicts}</p>
    <button type="button" disabled={sync.state === 'syncing'} onClick={() => void sync.synchronize()}>
      {sync.state === 'syncing' ? 'Sincronizando…' : 'Sincronizar agora'}
    </button>
  </section>
}
