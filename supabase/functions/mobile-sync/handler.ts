export interface MobileSyncGateway {
  authenticate(authorization: string): Promise<{ userId: string } | null>
  registerDevice(input: { deviceId: string; userId: string; tenant: string; name?: string; platform?: string; appVersion?: string }): Promise<void>
  getScope(): Promise<{ tenant: string }>
  process(deviceId: string, operation: Record<string, unknown>): Promise<Record<string, unknown>>
  pull(cursor: string | null): Promise<Array<Record<string, unknown>>>
}

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers })

function validOperation(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return ['operationId', 'entityType', 'entityId', 'kind', 'deviceCreatedAt']
    .every(key => typeof item[key] === 'string' && item[key] !== '')
}

export function createMobileSyncHandler(createGateway: (authorization: string) => MobileSyncGateway) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers })
    if (request.method !== 'POST') return reply({ error: 'Método não permitido.' }, 405)

    const authorization = request.headers.get('Authorization') ?? ''
    if (!/^Bearer\s+\S+/i.test(authorization)) return reply({ error: 'Sessão não autenticada.' }, 401)

    try {
      const gateway = createGateway(authorization)
      const identity = await gateway.authenticate(authorization)
      if (!identity) return reply({ error: 'Sessão inválida.' }, 401)

      const body = await request.json() as Record<string, unknown>
      const deviceId = typeof body.deviceId === 'string' ? body.deviceId : ''
      const operations = Array.isArray(body.operations) ? body.operations : null
      if (!deviceId || !operations || operations.length > 50 || !operations.every(validOperation)) {
        return reply({ error: 'Lote de sincronização inválido. Máximo de 50 operações.' }, 400)
      }

      const scope = await gateway.getScope()
      const device = body.device && typeof body.device === 'object'
        ? body.device as Record<string, unknown>
        : {}
      await gateway.registerDevice({
        deviceId,
        userId: identity.userId,
        tenant: scope.tenant,
        name: typeof device.name === 'string' ? device.name : undefined,
        platform: typeof device.platform === 'string' ? device.platform : undefined,
        appVersion: typeof device.appVersion === 'string' ? device.appVersion : undefined,
      })

      const results: Array<Record<string, unknown>> = []
      for (const operation of operations) results.push(await gateway.process(deviceId, operation))

      const cursor = typeof body.cursor === 'string' && body.cursor ? body.cursor : null
      const changes = await gateway.pull(cursor)
      const nextCursor = changes.length
        ? String(changes.at(-1)?.cursor ?? cursor ?? '')
        : cursor ?? new Date().toISOString()
      return reply({ results, changes, nextCursor })
    } catch (error) {
      return reply({ error: error instanceof Error ? error.message : 'Falha temporária de sincronização.' }, 503)
    }
  }
}
