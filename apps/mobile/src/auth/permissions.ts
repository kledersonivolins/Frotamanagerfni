import type { EffectiveScope } from '../domain/contracts'

export type ScopedReference = 'company' | 'sector' | 'vehicle' | 'driver'

const scopeKey: Record<ScopedReference, keyof EffectiveScope> = {
  company: 'companyIds',
  sector: 'sectorIds',
  vehicle: 'vehicleIds',
  driver: 'driverIds',
}

export function hasPermission(scope: EffectiveScope | null, permission: string): boolean {
  return Boolean(scope?.permissions.includes('mobile.access') && scope.permissions.includes(permission))
}

export function canAccessReference(
  scope: EffectiveScope | null,
  reference: ScopedReference,
  id: string,
): boolean {
  if (!scope?.permissions.includes('mobile.access')) return false
  const ids = scope[scopeKey[reference]]
  return Array.isArray(ids) && ids.includes(id)
}
