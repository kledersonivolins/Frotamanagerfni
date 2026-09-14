# FrotaManager Mobile Work Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the complete offline-capable mobile work-order workflow with scoped lists, QR lookup, assignment, timing, tasks, parts, readings, photos, progress, and safe completion.

**Architecture:** Work orders use a shared state machine and append-only execution entries. SQLite plus the outbox preserves actions offline; transactional Supabase handlers validate scope, transitions, required data, equipment links, costs, and preventive-cycle effects.

**Tech Stack:** React 19.3.0, TypeScript 7.0.2, Capacitor 8.5.2, SQLite, Supabase Postgres/Edge Functions/Storage, Vitest 5.0.0.

**Spec:** `docs/superpowers/specs/2026-09-14-aplicativo-movel-offline-design.md`

## Global Constraints

- Complete the foundation plan before this plan.
- Site permissions and tenant/company/sector/equipment scope are authoritative.
- Work-order costs can never exist without both a work order and an equipment link.
- Mobile completion of preventive work updates maintenance cycles only in the server transaction.
- Progress is calculated from persisted required steps, never from a decorative percentage.
- Every start, pause, resume, entry, and completion records actor and device time.

---

## File Structure

- `apps/mobile/src/features/work-orders/domain.ts`: types, transitions, validation, progress.
- `apps/mobile/src/features/work-orders/repository.ts`: scoped SQLite operations.
- `apps/mobile/src/features/work-orders/WorkOrdersHome.tsx`: list and filters.
- `apps/mobile/src/features/work-orders/WorkOrderDetail.tsx`: current state and actions.
- `apps/mobile/src/features/work-orders/WorkOrderForm.tsx`: authorized creation.
- `apps/mobile/src/features/work-orders/WorkOrderExecution.tsx`: clock and entries.
- `apps/mobile/src/features/work-orders/QrScanner.tsx`: equipment/order lookup.
- `supabase/migrations/202609140003_mobile_work_orders.sql`: additive schema and handlers.
- `supabase/tests/mobile_work_orders.sql`: RLS, state, costs, preventive completion.

### Task 1: Define Work-Order State Machine, Requirements, and Progress

**Files:**
- Create: `apps/mobile/src/features/work-orders/domain.ts`
- Create: `apps/mobile/src/features/work-orders/domain.test.ts`

**Interfaces:**
- Produces: `WorkOrderStatus`, `WorkOrder`, `WorkOrderStep`, `canTransitionWorkOrder`, `validateCompletion`, `calculateProgress`.

- [ ] **Step 1: Write failing domain tests**

```ts
it('calculates progress from required persisted steps', () => {
  const steps = [step(true, true), step(true, false), step(false, false)]
  expect(calculateProgress(steps)).toBe(50)
})

it('blocks completion without equipment and required steps', () => {
  expect(validateCompletion({ equipmentId: null, steps: [step(true, false)] }))
    .toEqual(['EQUIPMENT_REQUIRED', 'REQUIRED_STEPS_INCOMPLETE'])
})
```

- [ ] **Step 2: Verify failure**

Run: `cd apps/mobile; npm test -- --run src/features/work-orders/domain.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement exact states and rules**

Use statuses `pre_order`, `open`, `assigned`, `in_progress`, `paused`, `waiting_parts`, `waiting_third_party`, `completed`, `cancelled`, `reopened`. Progress is completed required steps divided by all required steps; if no required step exists, it is zero until server-confirmed completion.

```ts
export function calculateProgress(steps: WorkOrderStep[]) {
  const required = steps.filter(step => step.required)
  if (!required.length) return 0
  return Math.round(required.filter(step => step.completed).length * 100 / required.length)
}
```

- [ ] **Step 4: Verify**

Run: `cd apps/mobile; npm test -- --run src/features/work-orders/domain.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/mobile/src/features/work-orders/domain*
git commit -m "feat(mobile): definir fluxo de ordens de servico"
```

### Task 2: Add Work-Order Server Handlers and RLS Tests

**Files:**
- Create: `supabase/migrations/202609140003_mobile_work_orders.sql`
- Create: `supabase/tests/mobile_work_orders.sql`
- Modify: `supabase/functions/mobile-sync/index.ts`

**Interfaces:**
- Produces: `apply_mobile_work_order_operation(p_context jsonb, p_operation jsonb) returns jsonb`.
- Consumes: foundation dispatcher and existing `ordens_servico`, equipment, costs, maintenance plans.

- [ ] **Step 1: Write failing database tests**

Test allowed scoped read/create, denied cross-company access, start/pause/resume, invalid transition rejection, completion without equipment rejection, cost without equipment rejection, duplicate entry idempotency, and preventive-cycle update exactly once.

```sql
select throws_ok(
  $$ select public.apply_mobile_work_order_operation(
       jsonb_build_object('user_id', auth.uid()),
       '{"operationId":"finish-1","entityId":"os-without-equipment","kind":"transition","payload":{"to":"completed"}}'
     ) $$,
  'P0001', 'EQUIPMENT_REQUIRED'
);
```

- [ ] **Step 2: Verify failure**

Run: `supabase test db`

Expected: FAIL.

- [ ] **Step 3: Implement additive schema and transactional handler**

Preserve legacy OS ids. Add `mobile_uuid`, `row_version`, `updated_at`, `deleted_at`, and origin fields when absent. Create append-only mobile execution entries with unique UUIDs. Validate equipment, assignment, actor, required steps, readings, and status. In the same completion transaction, create linked costs and maintenance history and advance preventive cycles once.

- [ ] **Step 4: Verify server tests**

Run: `supabase db reset; supabase test db; deno test supabase/functions/mobile-sync`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/202609140003_mobile_work_orders.sql supabase/tests/mobile_work_orders.sql supabase/functions/mobile-sync/index.ts
git commit -m "feat(supabase): suportar ordens de servico mobile"
```

### Task 3: Implement Scoped Local Repository and Durable Execution Entries

**Files:**
- Create: `apps/mobile/src/features/work-orders/repository.ts`
- Create: `apps/mobile/src/features/work-orders/repository.test.ts`

**Interfaces:**
- Produces: `listWorkOrders(filter)`, `getWorkOrder(id)`, `createWorkOrder`, `enqueueWorkOrderTransition`, `appendExecutionEntry`, `findByQrPayload`.
- Consumes: effective scope, storage transaction, outbox.

- [ ] **Step 1: Write failing repository tests**

```ts
it('persists a timing entry and its operation atomically', async () => {
  await appendExecutionEntry('os-1', { type: 'start', actorId: 'u1', at: ISO_TIME })
  expect(await entriesFor('os-1')).toHaveLength(1)
  expect(await pendingForEntity('os-1')).toHaveLength(1)
})
```

Add cross-scope query and forced-rollback cases.

- [ ] **Step 2: Verify failure**

Run: `cd apps/mobile; npm test -- --run src/features/work-orders/repository.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement repository**

Apply effective scope to all equipment and OS reads. Use immutable UUID entries for clocks, steps, parts, readings, notes, and photos. Store denormalized current status/progress locally for fast lists, but recalculate on every accepted change.

- [ ] **Step 4: Verify**

Run: `cd apps/mobile; npm test -- --run src/features/work-orders/repository.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/mobile/src/features/work-orders/repository*
git commit -m "feat(mobile): persistir execucao de OS offline"
```

### Task 4: Build Lists, Detail, Creation, and Real Progress

**Files:**
- Create: `apps/mobile/src/features/work-orders/WorkOrdersHome.tsx`
- Create: `apps/mobile/src/features/work-orders/WorkOrderDetail.tsx`
- Create: `apps/mobile/src/features/work-orders/WorkOrderForm.tsx`
- Create: `apps/mobile/src/features/work-orders/WorkOrders.test.tsx`
- Modify: `apps/mobile/src/app/App.tsx`

**Interfaces:**
- Produces routes `/work-orders`, `/work-orders/new`, `/work-orders/:id`.

- [ ] **Step 1: Write list and progress tests**

```tsx
it('shows persisted progress and only authorized actions', async () => {
  renderWorkOrder({ requiredDone: 2, requiredTotal: 4, permissions: ['work_order.execute'] })
  expect(screen.getByText('50%')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Iniciar' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Verify failure**

Run: `cd apps/mobile; npm test -- --run src/features/work-orders/WorkOrders.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement screens**

Add filters for plate/equipment, status, sector, assignee, and period. Detail shows sync state, required steps, entries, progress, responsible users, and only permitted state actions. Creation requires equipment and required fields before enqueue.

- [ ] **Step 4: Verify**

Run: `cd apps/mobile; npm test -- --run src/features/work-orders; npm run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/mobile/src/features/work-orders apps/mobile/src/app/App.tsx
git commit -m "feat(mobile): adicionar telas de ordens de servico"
```

### Task 5: Build QR Lookup and Execution Workflow

**Files:**
- Create: `apps/mobile/src/features/work-orders/QrScanner.tsx`
- Create: `apps/mobile/src/features/work-orders/WorkOrderExecution.tsx`
- Create: `apps/mobile/src/features/work-orders/WorkOrderExecution.test.tsx`
- Create: `apps/mobile/src/native/barcode.ts`
- Create: `apps/mobile/src/native/camera.ts`

**Interfaces:**
- Produces: `scanQr(): Promise<QrResult>`, `captureEvidence(): Promise<LocalAttachment>`, execution entry forms.

- [ ] **Step 1: Write QR and execution tests**

```tsx
it('opens a cached allowed equipment and rejects a forbidden code', async () => {
  scanner.results(['FM:EQUIPMENT:eq-allowed', 'FM:EQUIPMENT:eq-forbidden'])
  expect(await resolveNextScan()).toMatchObject({ kind: 'equipment', id: 'eq-allowed' })
  await expect(resolveNextScan()).rejects.toThrow('ITEM_NOT_ALLOWED')
})
```

Test start, pause, resume, complete-step, add part, add reading, attach photo, and validation before finish.

- [ ] **Step 2: Verify failure**

Run: `cd apps/mobile; npm test -- --run src/features/work-orders/WorkOrderExecution.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement scanner and execution**

Accept only versioned payloads `FM:EQUIPMENT:<id>` and `FM:WORK_ORDER:<id>`. Resolve from the local authorized cache. Unknown offline codes show `Conecte-se para atualizar este QR Code`; forbidden codes show `Você não possui acesso`. Compress captured photos, save local URI plus checksum, and enqueue upload metadata.

- [ ] **Step 4: Verify**

Run: `cd apps/mobile; npm test -- --run src/features/work-orders; npm run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/mobile/src/features/work-orders apps/mobile/src/native
git commit -m "feat(mobile): executar OS por QR Code"
```

### Task 6: Work-Order End-to-End and Web Regression Gate

**Files:**
- Create: `apps/mobile/e2e/work-orders-offline.spec.ts`
- Create: `ordens-servico-mobile-regression.mjs`

**Interfaces:**
- Verifies Tasks 1–5 and the existing site's OS visibility/persistence.

- [ ] **Step 1: Add the end-to-end scenario**

Cover: scoped list, QR lookup, start offline, restart, task/part/reading/photo, pause/resume, sync, conflict with another device, complete, and server-side cost/preventive effects exactly once.

- [ ] **Step 2: Run before final integration**

Run: `cd apps/mobile; npm run test:e2e -- work-orders-offline.spec.ts`

Expected before final wiring: FAIL at central completion reconciliation.

- [ ] **Step 3: Add the web regression**

The Node regression must load the production `index.html` scripts and assert that additive mobile fields do not hide an OS, change company filtering, trigger auto-refresh, or detach equipment-linked costs.

- [ ] **Step 4: Run all OS gates**

Run: `cd apps/mobile; npm test -- --run; npm run test:e2e -- work-orders-offline.spec.ts`

Run: `node ordens-servico-mobile-regression.mjs; node manual-refresh-os-emprestimos-regression.mjs`

Run: `supabase test db`

Expected: all commands PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/mobile/e2e/work-orders-offline.spec.ts ordens-servico-mobile-regression.mjs
git commit -m "test(mobile): validar ordens de servico offline"
```
