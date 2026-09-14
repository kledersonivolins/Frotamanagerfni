import { describe, expect, it } from 'vitest'
import type { EffectiveScope } from '../domain/contracts'
import { canAccessReference, hasPermission } from './permissions'

const scope: EffectiveScope = {
  tenant: 'oficinafni',
  userId: 'user-1',
  companyIds: ['company-1'],
  sectorIds: ['sector-1'],
  vehicleIds: ['vehicle-1'],
  driverIds: ['driver-1'],
  permissions: ['mobile.access', 'loan.request'],
  validatedAt: '2026-09-14T12:00:00.000Z',
  expiresAt: '2026-09-21T12:00:00.000Z',
}

describe('cached permissions', () => {
  it('checks explicit action permissions without inferring roles', () => {
    expect(hasPermission(scope, 'loan.request')).toBe(true)
    expect(hasPermission(scope, 'loan.approve')).toBe(false)
  })

  it('checks company, sector, vehicle and driver identifiers', () => {
    expect(canAccessReference(scope, 'vehicle', 'vehicle-1')).toBe(true)
    expect(canAccessReference(scope, 'driver', 'driver-2')).toBe(false)
    expect(canAccessReference(scope, 'company', 'company-1')).toBe(true)
    expect(canAccessReference(scope, 'sector', 'sector-2')).toBe(false)
  })
})
