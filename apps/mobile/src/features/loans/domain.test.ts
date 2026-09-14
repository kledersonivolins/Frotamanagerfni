import { describe, expect, it } from 'vitest'
import { canTransitionLoan, isProvisional, periodsOverlap } from './domain'

describe('loan domain', () => {
  it('permite períodos encostados e bloqueia sobreposição real', () => {
    expect(periodsOverlap({ start:'2026-09-20T08:00:00Z', end:'2026-09-20T10:00:00Z' }, { start:'2026-09-20T10:00:00Z', end:'2026-09-20T12:00:00Z' })).toBe(false)
    expect(periodsOverlap({ start:'2026-09-20T08:00:00Z', end:'2026-09-20T10:01:00Z' }, { start:'2026-09-20T10:00:00Z', end:'2026-09-20T12:00:00Z' })).toBe(true)
  })
  it('nunca deixa solicitante aprovar', () => {
    expect(canTransitionLoan('requested','approved',['loan.request'])).toBe(false)
    expect(canTransitionLoan('requested','approved',['loan.approve'])).toBe(true)
  })
  it('marca reservas ainda não confirmadas pelo servidor', () => {
    expect(isProvisional('availability_pending')).toBe(true)
    expect(isProvisional('approved')).toBe(false)
  })
})
