import assert from 'node:assert/strict'
import test from 'node:test'
import { createMobileSyncHandler, type MobileSyncGateway } from './handler.ts'

const operation = {
  operationId: 'op-1', entityType: 'loan', entityId: 'loan-1', kind: 'create',
  deviceCreatedAt: '2026-09-14T12:00:00Z', payload: {},
}

function fakeGateway(overrides: Partial<MobileSyncGateway> = {}): MobileSyncGateway {
  return {
    authenticate: async () => ({ userId: 'user-1' }),
    getScope: async () => ({ tenant: 'tenant-a' }),
    registerDevice: async () => undefined,
    process: async (_deviceId, item) => ({ operationId: item.operationId, outcome: 'accepted' }),
    pull: async () => [],
    ...overrides,
  }
}

test('rejeita chamada sem bearer token', async () => {
  const response = await createMobileSyncHandler(() => fakeGateway())(
    new Request('http://local/mobile-sync', { method: 'POST' }),
  )
  assert.equal(response.status, 401)
})

test('rejeita mais de 50 operações', async () => {
  const response = await createMobileSyncHandler(() => fakeGateway())(
    new Request('http://local/mobile-sync', {
      method: 'POST', headers: { Authorization: 'Bearer token' },
      body: JSON.stringify({ deviceId: crypto.randomUUID(), operations: Array(51).fill(operation) }),
    }),
  )
  assert.equal(response.status, 400)
})

test('registra dispositivo, processa lote e entrega cursor', async () => {
  let registered = false
  const handler = createMobileSyncHandler(() => fakeGateway({
    registerDevice: async () => { registered = true },
    pull: async () => [{ entityType: 'loan', entityId: '1', cursor: '2026-09-14T12:01:00Z' }],
  }))
  const response = await handler(new Request('http://local/mobile-sync', {
    method: 'POST', headers: { Authorization: 'Bearer token' },
    body: JSON.stringify({ deviceId: crypto.randomUUID(), operations: [operation] }),
  }))
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(registered, true)
  assert.equal(body.results[0].outcome, 'accepted')
  assert.equal(body.nextCursor, '2026-09-14T12:01:00Z')
})
