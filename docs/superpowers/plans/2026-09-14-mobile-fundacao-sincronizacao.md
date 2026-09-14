# FrotaManager Mobile Foundation and Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the installable mobile foundation, secure offline session, local database, permission cache, and idempotent Supabase synchronization used by every mobile module.

**Architecture:** A React/TypeScript application in `apps/mobile` runs inside Capacitor and writes first to SQLite. A durable outbox sends authenticated operations to a Supabase Edge Function, which invokes transactional Postgres routines and returns accepted, duplicate, rejected, or conflict results.

**Tech Stack:** Node.js 22.12+, React 19.3.0, TypeScript 7.0.2, Vite 8.3.0, Capacitor 8.5.2, Capacitor Community SQLite 8.1.1, Supabase JS 2.116.0, Supabase CLI 2.117.0, Zod 4.6.5, Vitest 5.0.0, Playwright 1.63.0.

**Spec:** `docs/superpowers/specs/2026-09-14-aplicativo-movel-offline-design.md`

## Global Constraints

- The existing `index.html` remains the production administrative site during the mobile rollout.
- Mobile scope is limited to Empréstimos and Ordens de Serviço.
- First login on each device requires internet.
- Offline authorization lasts exactly seven days after the last successful server validation.
- Every local mutation must be durable before the UI reports success.
- Every server mutation must be idempotent by `tenant + operation_id`.
- No `service_role` key or database secret may be shipped in the client.
- Android package id is `br.com.ferronorte.frotamanager`; visible name is `FrotaManager`.
- Database migrations must be additive and preserve existing legacy ids.

---

## File Structure

- `apps/mobile/package.json`: pinned dependencies and scripts.
- `apps/mobile/capacitor.config.ts`: Android package and build directory.
- `apps/mobile/src/app/App.tsx`: routes and application providers.
- `apps/mobile/src/domain/contracts.ts`: shared mobile entity and sync contracts.
- `apps/mobile/src/storage/database.ts`: SQLite connection and migrations.
- `apps/mobile/src/storage/repositories.ts`: typed local reads and atomic writes.
- `apps/mobile/src/auth/session.ts`: online login, secure token storage, seven-day gate.
- `apps/mobile/src/auth/permissions.ts`: effective cached scope.
- `apps/mobile/src/sync/outbox.ts`: enqueue and state transitions.
- `apps/mobile/src/sync/client.ts`: push/pull orchestration and retry policy.
- `apps/mobile/src/sync/SyncProvider.tsx`: lifecycle/network triggers and visible state.
- `apps/mobile/src/features/sync/SyncScreen.tsx`: pending/conflict recovery UI.
- `supabase/migrations/20260914121956_mobile_sync_foundation.sql`: devices, operations, audit, RLS, RPC.
- `supabase/functions/mobile-sync/index.ts`: authenticated batch endpoint.
- `supabase/tests/mobile_sync_rls.sql`: allow/deny database tests.

### Task 1: Scaffold the Mobile Application

**Files:**
- Create: `apps/mobile/package.json`
- Create: `apps/mobile/package-lock.json`
- Create: `apps/mobile/index.html`
- Create: `apps/mobile/tsconfig.json`
- Create: `apps/mobile/vite.config.ts`
- Create: `apps/mobile/capacitor.config.ts`
- Create: `apps/mobile/src/main.tsx`
- Create: `apps/mobile/src/app/App.tsx`
- Create: `apps/mobile/src/app/App.test.tsx`

**Interfaces:**
- Produces: `App(): JSX.Element`, scripts `dev`, `build`, `test`, `test:e2e`, and Capacitor web directory `dist`.

- [ ] **Step 1: Write the failing shell test**

Create `apps/mobile/src/app/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from './App'

describe('App', () => {
  it('renders the FrotaManager mobile shell', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'FrotaManager' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test and verify failure**

Run: `cd apps/mobile; npm test -- --run src/app/App.test.tsx`

Expected: FAIL because the package and `App` do not exist.

- [ ] **Step 3: Add pinned package configuration and minimal shell**

Use package id `br.com.ferronorte.frotamanager`, `webDir: 'dist'`, React StrictMode, and this minimal component:

```tsx
export function App() {
  return <main><h1>FrotaManager</h1><p>Carregando dados locais...</p></main>
}
```

Pin the versions listed in the plan header. Also pin `@capacitor/cli@8.4.3`, `@capacitor/android@8.5.2`, `@capacitor/app@8.1.1`, `@capacitor/camera@8.2.4`, `@capacitor/network@8.0.1`, `@capacitor/preferences@8.0.1`, `@capacitor/filesystem@8.1.3`, `@capacitor/barcode-scanner@3.1.2`, `@aparajita/capacitor-secure-storage@8.0.0`, `@testing-library/react@16.3.3`, `@vitejs/plugin-react@6.1.1`, and `@playwright/test@1.63.0`. Configure Vitest with `jsdom`, Testing Library setup, and Playwright with `testDir: './e2e'`.

- [ ] **Step 4: Verify test and production build**

Run: `cd apps/mobile; npm install; npm test -- --run; npm run build`

Expected: all tests PASS and `apps/mobile/dist/index.html` exists.

- [ ] **Step 5: Commit**

```powershell
git add apps/mobile
git commit -m "feat(mobile): criar base do aplicativo"
```

### Task 2: Define Stable Domain and Sync Contracts

**Files:**
- Create: `apps/mobile/src/domain/contracts.ts`
- Create: `apps/mobile/src/domain/contracts.test.ts`

**Interfaces:**
- Produces: `SyncOperation`, `SyncResult`, `ChangeRecord`, `SyncSummary`, `EffectiveScope`, `ConnectionState`, `SyncState`, `parseSyncResult(input): SyncResult`.

- [ ] **Step 1: Write contract tests**

```ts
import { describe, expect, it } from 'vitest'
import { parseSyncResult } from './contracts'

describe('parseSyncResult', () => {
  it('accepts an idempotent acknowledgement', () => {
    expect(parseSyncResult({ operationId: 'op-1', outcome: 'duplicate', serverVersion: 3 }).outcome)
      .toBe('duplicate')
  })
  it('rejects unknown outcomes', () => {
    expect(() => parseSyncResult({ operationId: 'op-1', outcome: 'lost' })).toThrow()
  })
})
```

- [ ] **Step 2: Verify failure**

Run: `cd apps/mobile; npm test -- --run src/domain/contracts.test.ts`

Expected: FAIL because `contracts.ts` does not exist.

- [ ] **Step 3: Implement exact contracts**

```ts
import { z } from 'zod'

export type ConnectionState = 'online' | 'offline'
export type SyncState = 'synced' | 'pending' | 'syncing' | 'attention'
export type OperationKind = 'create' | 'update' | 'transition' | 'delete' | 'attach'

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
  entityType: 'loan' | 'loan_checklist' | 'work_order' | 'work_order_entry' | 'attachment'
  entityId: string
  kind: OperationKind
  baseVersion: number | null
  payload: Record<string, unknown>
  deviceCreatedAt: string
}

export interface ChangeRecord {
  entityType: SyncOperation['entityType']
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
export const parseSyncResult = (input: unknown): SyncResult => syncResultSchema.parse(input)
```

- [ ] **Step 4: Verify**

Run: `cd apps/mobile; npm test -- --run src/domain/contracts.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/mobile/src/domain
git commit -m "feat(mobile): definir contratos de dominio e sync"
```

### Task 3: Implement SQLite Migrations and Atomic Local Writes

**Files:**
- Create: `apps/mobile/src/storage/database.ts`
- Create: `apps/mobile/src/storage/repositories.ts`
- Create: `apps/mobile/src/storage/repositories.test.ts`

**Interfaces:**
- Produces: `openDatabase(): Promise<MobileDatabase>`, `runMigrations(db): Promise<void>`, `saveWithOperation(input): Promise<void>`, `listPendingOperations(limit): Promise<SyncOperation[]>`.
- Consumes: `SyncOperation` from Task 2.

- [ ] **Step 1: Write a failing atomicity test using an in-memory adapter**

```ts
it('stores the entity and outbox operation in one transaction', async () => {
  const db = createMemoryDatabase()
  await saveWithOperation(db, {
    table: 'work_orders', entityId: 'os-1', json: { status: 'open' },
    operation: operationFixture('op-1', 'work_order', 'os-1')
  })
  expect(await db.one('work_orders', 'os-1')).toMatchObject({ status: 'open' })
  expect(await listPendingOperations(db, 10)).toHaveLength(1)
})
```

- [ ] **Step 2: Verify failure**

Run: `cd apps/mobile; npm test -- --run src/storage/repositories.test.ts`

Expected: FAIL because the storage adapter and repository are missing.

- [ ] **Step 3: Implement schema version 1**

Create tables `metadata`, `reference_records`, `loans`, `loan_checklists`, `work_orders`, `work_order_entries`, `drafts`, `attachments`, `outbox`, and `conflicts`. Store domain payloads as JSON plus indexed identity/status/timestamp columns. Enforce `operation_id UNIQUE` and wrap entity plus outbox insert in one SQLite transaction.

```ts
export async function saveWithOperation(db: MobileDatabase, input: SaveWithOperation) {
  await db.transaction(async tx => {
    await tx.upsert(input.table, input.entityId, input.json)
    await tx.insertOutbox({ ...input.operation, state: 'pending', attempts: 0 })
  })
}
```

- [ ] **Step 4: Verify migration and atomicity tests**

Run: `cd apps/mobile; npm test -- --run src/storage`

Expected: PASS, including rollback when the outbox insert is forced to fail.

- [ ] **Step 5: Commit**

```powershell
git add apps/mobile/src/storage
git commit -m "feat(mobile): adicionar banco local transacional"
```

### Task 4: Implement Secure Session and Seven-Day Offline Gate

**Files:**
- Create: `apps/mobile/src/auth/session.ts`
- Create: `apps/mobile/src/auth/permissions.ts`
- Create: `apps/mobile/src/auth/session.test.ts`
- Create: `apps/mobile/src/auth/AuthProvider.tsx`

**Interfaces:**
- Produces: `loginOnline(email, password): Promise<EffectiveScope>`, `getOfflineAccess(now): Promise<'write'|'read-only'|'none'>`, `logout(): Promise<void>`, `useAuth()`.
- Consumes: `EffectiveScope` and local metadata storage.

- [ ] **Step 1: Write expiration tests**

```ts
it('allows offline writes before seven days and read-only after expiry', async () => {
  await storeScope(scopeValidatedAt('2026-09-01T12:00:00Z'))
  expect(await getOfflineAccess(new Date('2026-09-08T11:59:59Z'))).toBe('write')
  expect(await getOfflineAccess(new Date('2026-09-08T12:00:01Z'))).toBe('read-only')
})
```

- [ ] **Step 2: Verify failure**

Run: `cd apps/mobile; npm test -- --run src/auth/session.test.ts`

Expected: FAIL because session functions are missing.

- [ ] **Step 3: Implement online login and encrypted persistence**

Use Supabase password login only while online. Fetch the effective profile from a server RPC, calculate `expiresAt = validatedAt + 7 days`, store session material in Android secure storage, and store the non-secret scope in SQLite. Never authorize from user-editable metadata.

```ts
export function offlineAccess(scope: EffectiveScope, now: Date) {
  return now.getTime() < Date.parse(scope.expiresAt) ? 'write' as const : 'read-only' as const
}
```

- [ ] **Step 4: Verify auth tests**

Run: `cd apps/mobile; npm test -- --run src/auth`

Expected: PASS for online requirement, expiry boundary, logout with pending data warning, and disabled profile response.

- [ ] **Step 5: Commit**

```powershell
git add apps/mobile/src/auth
git commit -m "feat(mobile): adicionar sessao offline segura"
```

### Task 5: Add Supabase Sync Schema, RLS, and Transactional RPC

**Files:**
- Create: `supabase/migrations/20260914121956_mobile_sync_foundation.sql`
- Create: `supabase/tests/mobile_sync_rls.sql`

**Interfaces:**
- Produces: tables `mobile_devices`, `mobile_operations`, `mobile_audit_events`, `mobile_attachments`; RPC `process_mobile_operation(p_device_id uuid, p_operation jsonb) returns jsonb`; RPC `get_mobile_scope() returns jsonb`.

- [ ] **Step 1: Write failing pgTAP/RLS assertions**

Cover: unauthenticated access denied; tenant A cannot read tenant B; inactive user cannot register a device; duplicate operation returns the stored result; authenticated user cannot forge another `user_id`.

```sql
select throws_ok(
  $$ select public.process_mobile_operation(gen_random_uuid(), '{"operationId":"x"}'::jsonb) $$,
  '42501'
);
```

- [ ] **Step 2: Run tests and verify failure**

Run: `supabase test db`

Expected: FAIL because tables and RPCs do not exist.

- [ ] **Step 3: Implement additive migration**

Enable RLS on all four tables; revoke `anon`; grant only required actions to `authenticated`; derive `user_id` from `auth.uid()`; set a fixed safe `search_path`; add unique `(tenant, operation_id)` and indexes for `(tenant, updated_at, id)`. Add `usuarios.mobile_permissions jsonb NOT NULL DEFAULT '{}'::jsonb`. The RPC inserts the operation once, validates the current profile and calls an entity handler in one transaction.

- [ ] **Step 4: Verify database tests**

Run: `supabase db reset; supabase test db`

Expected: PASS for all allow and deny assertions.

- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/20260914121956_mobile_sync_foundation.sql supabase/tests/mobile_sync_rls.sql
git commit -m "feat(supabase): criar fundacao de sincronizacao mobile"
```

### Task 6: Implement the Authenticated Sync Edge Function

**Files:**
- Create: `supabase/functions/mobile-sync/index.ts`
- Create: `supabase/functions/mobile-sync/index.test.ts`

**Interfaces:**
- Consumes: `{ deviceId: string, operations: SyncOperation[], cursor?: string }`.
- Produces: `{ results: SyncResult[], changes: ChangeRecord[], nextCursor: string }`.

- [ ] **Step 1: Write handler tests**

```ts
Deno.test('rejects requests without bearer auth', async () => {
  const response = await handler(new Request('http://local/mobile-sync', { method: 'POST' }))
  if (response.status !== 401) throw new Error(`expected 401, got ${response.status}`)
})
```

Add cases for malformed payload, maximum 50 operations, duplicate acknowledgement, conflict response, and cursor pull.

- [ ] **Step 2: Verify failure**

Run: `deno test supabase/functions/mobile-sync/index.test.ts`

Expected: FAIL because `handler` is missing.

- [ ] **Step 3: Implement the endpoint**

Validate JWT with Supabase, parse the request with explicit schemas, limit batches to 50, invoke `process_mobile_operation` sequentially, then fetch permitted changes after the cursor. Return HTTP 200 for per-operation conflicts, HTTP 401 for invalid sessions, HTTP 400 for invalid envelopes, and HTTP 503 for transient backend failure.

- [ ] **Step 4: Verify function tests**

Run: `deno test supabase/functions/mobile-sync/index.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add supabase/functions/mobile-sync
git commit -m "feat(supabase): adicionar endpoint de sync mobile"
```

### Task 7: Implement Push/Pull, Retry, and Recovery UI

**Files:**
- Create: `apps/mobile/src/sync/outbox.ts`
- Create: `apps/mobile/src/sync/client.ts`
- Create: `apps/mobile/src/sync/client.test.ts`
- Create: `apps/mobile/src/sync/SyncProvider.tsx`
- Create: `apps/mobile/src/features/sync/SyncScreen.tsx`
- Modify: `apps/mobile/src/app/App.tsx`

**Interfaces:**
- Produces: `synchronize(): Promise<SyncSummary>`, `retryOperation(id): Promise<void>`, `useSync(): { state, pendingCount, conflicts, synchronize }`.
- Consumes: repository functions, AuthProvider, and the Edge Function response.

- [ ] **Step 1: Write synchronization state tests**

```ts
it('keeps transient failures pending and stores permanent conflicts', async () => {
  server.respondWithResults([
    { operationId: 'a', outcome: 'accepted', serverVersion: 1 },
    { operationId: 'b', outcome: 'conflict', code: 'VERSION_CONFLICT' }
  ])
  const summary = await synchronize(deps)
  expect(summary).toMatchObject({ accepted: 1, conflicts: 1 })
  expect(await outbox.state('a')).toBe('synced')
  expect(await outbox.state('b')).toBe('attention')
})
```

- [ ] **Step 2: Verify failure**

Run: `cd apps/mobile; npm test -- --run src/sync/client.test.ts`

Expected: FAIL because the sync client is missing.

- [ ] **Step 3: Implement orchestration**

Trigger synchronization on login, app resume, network-online events, and manual action. Use delays of 2, 5, 15, 30, and 60 seconds for transient retries, capped at 60 seconds while active. Never delete an operation until accepted or acknowledged as duplicate. Apply pull changes and cursor atomically.

- [ ] **Step 4: Add the visible state screen**

Render connection, last successful sync, pending counter, conflicts with reason, and retry action. Keep domain content available while sync runs.

- [ ] **Step 5: Verify**

Run: `cd apps/mobile; npm test -- --run; npm run build`

Expected: PASS and the built app contains the Sync screen.

- [ ] **Step 6: Commit**

```powershell
git add apps/mobile/src/sync apps/mobile/src/features/sync apps/mobile/src/app/App.tsx
git commit -m "feat(mobile): sincronizar fila offline com recuperacao"
```

### Task 8: Integrate Mobile Access Control into the Main Site

**Files:**
- Modify: `index.html`
- Create: `mobile-permissions-regression.mjs`

**Interfaces:**
- Produces: persisted `usuarios.mobile_permissions` keys `mobile.access`, `loan.view`, `loan.request`, `loan.approve`, `loan.release`, `loan.checklist`, `work_order.view`, `work_order.create`, `work_order.execute`, `work_order.complete`.
- Consumes: existing user editor, tenant/company/sector/vehicle/driver assignments, and `get_mobile_scope()`.

- [ ] **Step 1: Write the failing site regression**

The Node regression must extract the site scripts, create a user fixture, select only `loan.request` and `work_order.view`, save, reload from the serialized Supabase row shape, and assert that the same two permissions remain while company/sector/vehicle/driver restrictions are unchanged.

- [ ] **Step 2: Run and verify failure**

Run: `node mobile-permissions-regression.mjs`

Expected: FAIL because the editor does not expose or persist mobile permissions.

- [ ] **Step 3: Add the mobile-access section to the existing user editor**

Render a visible `Acesso ao aplicativo` section. Require `mobile.access` before any module action can be selected. Group Empréstimos and Ordens de Serviço actions and persist them to `mobile_permissions`; do not infer approval from a generic operator role. Keep the existing company, sector, vehicle, and driver selectors as the scope source.

- [ ] **Step 4: Verify site and scope behavior**

Run: `node mobile-permissions-regression.mjs; node usuario-empresa-isolamento-regression.mjs; node usuario-setor-regression.mjs; node emprestimos-veiculos-vinculados-regression.mjs`

Expected: all commands PASS.

- [ ] **Step 5: Commit**

```powershell
git add index.html mobile-permissions-regression.mjs
git commit -m "feat(site): controlar permissoes do aplicativo"
```

### Task 9: Foundation End-to-End Gate

**Files:**
- Create: `apps/mobile/e2e/foundation-offline.spec.ts`
- Create: `docs/mobile/testing-foundation.md`

**Interfaces:**
- Verifies all interfaces produced by Tasks 1–8.

- [ ] **Step 1: Add the end-to-end scenario**

Script: login online, receive scope, go offline, create a local operation, reload, confirm the operation remains, reconnect, simulate one transient failure, receive acceptance, and verify pending count becomes zero.

- [ ] **Step 2: Run with the transient failure and verify the assertion catches premature deletion**

Run: `cd apps/mobile; npm run test:e2e -- foundation-offline.spec.ts`

Expected before final wiring: FAIL at the pending-operation preservation assertion.

- [ ] **Step 3: Wire missing lifecycle behavior only**

Add no new feature; connect the providers and adapters needed by the scenario.

- [ ] **Step 4: Run all foundation gates**

Run: `cd apps/mobile; npm test -- --run; npm run build; npm run test:e2e -- foundation-offline.spec.ts`

Run: `supabase test db`

Expected: all commands PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/mobile/e2e docs/mobile/testing-foundation.md apps/mobile/src
git commit -m "test(mobile): validar fundacao offline ponta a ponta"
```
