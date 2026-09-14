# FrotaManager Mobile Loans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the complete mobile vehicle-loan workflow, including offline requests, server-confirmed availability, approvals, departure/return checklists, use, and completion.

**Architecture:** Loan actions use a tested state machine and write to SQLite plus the durable outbox. Supabase transactional handlers validate role, sector, vehicle/driver scope, checklist requirements, and strict interval availability before changing the central record.

**Tech Stack:** React 19.3.0, TypeScript 7.0.2, Capacitor 8.5.2, SQLite, Supabase Postgres/Edge Functions/Storage, Vitest 5.0.0.

**Spec:** `docs/superpowers/specs/2026-09-14-aplicativo-movel-offline-design.md`

## Global Constraints

- Complete the foundation plan `docs/superpowers/plans/2026-09-14-mobile-fundacao-sincronizacao.md` first.
- Site-configured tenant, company, sector, vehicle, driver, role, and module permissions are authoritative.
- Solicitors can request but cannot approve.
- Offline reservations are provisional until the server confirms availability.
- Availability uses strict overlap: `existing.start < requested.end && requested.start < existing.end`.
- Back-to-back bookings with equal end/start timestamps are allowed.
- Approval and checklist identity, role, date, and time must be audited.

---

## File Structure

- `apps/mobile/src/features/loans/domain.ts`: entities, statuses, transitions, availability.
- `apps/mobile/src/features/loans/repository.ts`: local loan queries and mutations.
- `apps/mobile/src/features/loans/LoansHome.tsx`: list, filters, status, actions.
- `apps/mobile/src/features/loans/LoanCalendar.tsx`: month/day agenda.
- `apps/mobile/src/features/loans/LoanRequestForm.tsx`: staged request form.
- `apps/mobile/src/features/loans/LoanApproval.tsx`: approval/rejection.
- `apps/mobile/src/features/loans/LoanChecklist.tsx`: departure and return evidence.
- `apps/mobile/src/features/loans/LoanUse.tsx`: release, start, and return actions.
- `supabase/migrations/202609140002_mobile_loans.sql`: additive columns, indexes, handlers, RLS.
- `supabase/tests/mobile_loans.sql`: state, permission, and overlap tests.

### Task 1: Define Loan State Machine and Availability

**Files:**
- Create: `apps/mobile/src/features/loans/domain.ts`
- Create: `apps/mobile/src/features/loans/domain.test.ts`

**Interfaces:**
- Produces: `LoanStatus`, `Loan`, `LoanPeriod`, `canTransitionLoan(from, to, permissions): boolean`, `periodsOverlap(a, b): boolean`, `isProvisional(status): boolean`.

- [ ] **Step 1: Write failing transition and interval tests**

```ts
it('allows adjacent periods and blocks a real overlap', () => {
  expect(periodsOverlap(period('08:00', '10:00'), period('10:00', '12:00'))).toBe(false)
  expect(periodsOverlap(period('08:00', '10:01'), period('10:00', '12:00'))).toBe(true)
})

it('never lets a solicitor approve', () => {
  expect(canTransitionLoan('requested', 'approved', ['loan.request'])).toBe(false)
  expect(canTransitionLoan('requested', 'approved', ['loan.approve'])).toBe(true)
})
```

- [ ] **Step 2: Verify failure**

Run: `cd apps/mobile; npm test -- --run src/features/loans/domain.test.ts`

Expected: FAIL because loan domain functions do not exist.

- [ ] **Step 3: Implement the exact state model**

Use statuses `draft`, `pending_sync`, `availability_pending`, `requested`, `approved`, `rejected`, `released`, `in_use`, `return_pending`, `completed`, `cancelled`. Implement strict interval comparison with UTC ISO timestamps and permission-gated transitions.

```ts
export const periodsOverlap = (a: LoanPeriod, b: LoanPeriod) =>
  Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end)
```

- [ ] **Step 4: Verify**

Run: `cd apps/mobile; npm test -- --run src/features/loans/domain.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/mobile/src/features/loans/domain*
git commit -m "feat(mobile): definir fluxo de emprestimos"
```

### Task 2: Add Loan Server Handlers and Security Tests

**Files:**
- Create: `supabase/migrations/202609140002_mobile_loans.sql`
- Create: `supabase/tests/mobile_loans.sql`
- Modify: `supabase/functions/mobile-sync/index.ts`

**Interfaces:**
- Produces: `apply_mobile_loan_operation(p_context jsonb, p_operation jsonb) returns jsonb`.
- Consumes: foundation `process_mobile_operation` dispatcher.

- [ ] **Step 1: Write failing database tests**

Test requested loan, approval by authorized sector approver, rejection of solicitor approval, rejection of cross-company vehicle/driver, provisional offline request, strict overlap conflict, adjacent-period acceptance, checklist-required release, and duplicate operation acknowledgement.

```sql
select is(
  public.mobile_periods_overlap('2026-09-20 08:00Z', '2026-09-20 10:00Z',
                                '2026-09-20 10:00Z', '2026-09-20 12:00Z'),
  false,
  'adjacent reservations are allowed'
);
```

- [ ] **Step 2: Verify failure**

Run: `supabase test db`

Expected: FAIL because the handler and additive columns are absent.

- [ ] **Step 3: Implement additive migration and dispatcher**

Preserve `emprestimos_veiculos.id`; add unique `mobile_uuid`, `row_version`, `updated_at`, `deleted_at`, `sync_status`, and normalized start/end timestamps when absent. Add an exclusion-safe transactional availability check and handlers for request, approve, reject, release, start, return, complete, and cancel. Derive actor identity from `auth.uid()`.

- [ ] **Step 4: Verify database and Edge Function tests**

Run: `supabase db reset; supabase test db; deno test supabase/functions/mobile-sync`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/202609140002_mobile_loans.sql supabase/tests/mobile_loans.sql supabase/functions/mobile-sync/index.ts
git commit -m "feat(supabase): suportar emprestimos mobile transacionais"
```

### Task 3: Implement Local Loan Repository and Scoped Reference Lists

**Files:**
- Create: `apps/mobile/src/features/loans/repository.ts`
- Create: `apps/mobile/src/features/loans/repository.test.ts`

**Interfaces:**
- Produces: `listLoans(filter): Promise<Loan[]>`, `listAvailableVehicles(period): Promise<VehicleOption[]>`, `listAllowedDrivers(): Promise<DriverOption[]>`, `saveLoanDraft`, `enqueueLoanAction`.
- Consumes: foundation storage and effective scope.

- [ ] **Step 1: Write scope and durability tests**

```ts
it('returns only drivers and vehicles in the effective scope', async () => {
  seedReferences({ vehicles: ['v1', 'v2'], drivers: ['d1', 'd2'] })
  setScope({ vehicleIds: ['v1'], driverIds: ['d2'] })
  expect(await listVehicleIds()).toEqual(['v1'])
  expect(await listDriverIds()).toEqual(['d2'])
})
```

- [ ] **Step 2: Verify failure**

Run: `cd apps/mobile; npm test -- --run src/features/loans/repository.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement repository**

Filter every query by the cached effective scope. A request created offline is stored as `availability_pending`, never `approved`. Use `saveWithOperation` so draft promotion and outbox insertion are atomic.

- [ ] **Step 4: Verify**

Run: `cd apps/mobile; npm test -- --run src/features/loans/repository.test.ts`

Expected: PASS for scope, offline status, restart persistence, and atomic rollback.

- [ ] **Step 5: Commit**

```powershell
git add apps/mobile/src/features/loans/repository*
git commit -m "feat(mobile): persistir emprestimos offline"
```

### Task 4: Build Loan List, Calendar, and Request Form

**Files:**
- Create: `apps/mobile/src/features/loans/LoansHome.tsx`
- Create: `apps/mobile/src/features/loans/LoanCalendar.tsx`
- Create: `apps/mobile/src/features/loans/LoanRequestForm.tsx`
- Create: `apps/mobile/src/features/loans/LoanRequestForm.test.tsx`
- Modify: `apps/mobile/src/app/App.tsx`

**Interfaces:**
- Produces routes `/loans`, `/loans/calendar`, `/loans/new`, `/loans/:id`.
- Consumes scoped repository and `useSync()`.

- [ ] **Step 1: Write the request behavior test**

```tsx
it('saves an offline request as awaiting availability confirmation', async () => {
  renderLoanRequest({ online: false })
  await fillRequiredLoanFields()
  await user.click(screen.getByRole('button', { name: 'Enviar solicitação' }))
  expect(await screen.findByText('Aguardando confirmação de disponibilidade')).toBeVisible()
})
```

- [ ] **Step 2: Verify failure**

Run: `cd apps/mobile; npm test -- --run src/features/loans/LoanRequestForm.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement screens**

Build short form steps: period, vehicle/driver, trip details, review. Show cached agenda with a stale-data banner while offline. Disable submit when end is not after start or required fields are missing. Display provisional status explicitly.

- [ ] **Step 4: Verify UI tests and build**

Run: `cd apps/mobile; npm test -- --run src/features/loans; npm run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/mobile/src/features/loans apps/mobile/src/app/App.tsx
git commit -m "feat(mobile): adicionar agenda e solicitacao de emprestimo"
```

### Task 5: Build Approval, Checklists, and Vehicle Use

**Files:**
- Create: `apps/mobile/src/features/loans/LoanApproval.tsx`
- Create: `apps/mobile/src/features/loans/LoanChecklist.tsx`
- Create: `apps/mobile/src/features/loans/LoanUse.tsx`
- Create: `apps/mobile/src/features/loans/LoanActions.test.tsx`

**Interfaces:**
- Produces actions `approveLoan`, `rejectLoan`, `completeChecklist`, `releaseLoan`, `startLoan`, `returnLoan`, `completeLoan`.
- Consumes state machine, camera/attachment service, and local repository.

- [ ] **Step 1: Write permission and checklist tests**

```tsx
it('hides approval from solicitors and blocks release without departure checklist', async () => {
  const { rerender } = renderLoanDetail({ permissions: ['loan.request'], status: 'requested' })
  expect(screen.queryByRole('button', { name: 'Aprovar' })).not.toBeInTheDocument()
  rerender(detail({ permissions: ['loan.release'], status: 'approved', checklistDone: false }))
  expect(screen.getByRole('button', { name: 'Liberar veículo' })).toBeDisabled()
})
```

- [ ] **Step 2: Verify failure**

Run: `cd apps/mobile; npm test -- --run src/features/loans/LoanActions.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement actions and forms**

Record actor, role, device timestamp, KM, fuel, damage answers, observations, signature, and photo references. Every action uses the atomic repository method and shows `Pendente` offline. Require the configured checklist before release and return completion.

- [ ] **Step 4: Verify**

Run: `cd apps/mobile; npm test -- --run src/features/loans; npm run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/mobile/src/features/loans
git commit -m "feat(mobile): completar fluxo de emprestimos"
```

### Task 6: Loan End-to-End and Legacy Site Regression Gate

**Files:**
- Create: `apps/mobile/e2e/loans-offline.spec.ts`
- Modify: `emprestimos-agenda-regression.mjs`
- Modify: `emprestimos-aprovacao-persistencia-regression.mjs`
- Modify: `emprestimos-disponibilidade-periodo-regression.mjs`

**Interfaces:**
- Verifies Tasks 1–5 and compatibility with the existing site.

- [ ] **Step 1: Add the mobile scenario**

Cover: request offline, restart, sync and confirm; approve with correct actor; checklist offline with photo; release/use/return; and two conflicting offline reservations where only one is confirmed.

- [ ] **Step 2: Run once against an intentionally conflicting fixture**

Run: `cd apps/mobile; npm run test:e2e -- loans-offline.spec.ts`

Expected before final fixture wiring: FAIL at server conflict reconciliation.

- [ ] **Step 3: Wire fixtures and preserve existing web behavior**

Update only regression fixtures/selectors needed for additive sync columns; do not weaken existing assertions.

- [ ] **Step 4: Run all loan gates**

Run: `cd apps/mobile; npm test -- --run; npm run test:e2e -- loans-offline.spec.ts`

Run: `node emprestimos-agenda-regression.mjs; node emprestimos-aprovacao-persistencia-regression.mjs; node emprestimos-disponibilidade-periodo-regression.mjs`

Run: `supabase test db`

Expected: all commands PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/mobile/e2e/loans-offline.spec.ts *emprestimos*regression.mjs
git commit -m "test(mobile): validar emprestimos offline ponta a ponta"
```
