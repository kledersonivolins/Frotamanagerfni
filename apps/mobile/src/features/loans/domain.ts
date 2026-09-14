export type LoanStatus = 'draft'|'pending_sync'|'availability_pending'|'requested'|'approved'|'rejected'|'released'|'in_use'|'return_pending'|'completed'|'cancelled'
export interface LoanPeriod { start: string; end: string }
export interface Loan { id:string; vehicleId:string; driverId:string; requesterId:string; sectorId:string|null; status:LoanStatus; period:LoanPeriod; destination:string; purpose:string; checklistDone?:boolean }

export const periodsOverlap = (a:LoanPeriod,b:LoanPeriod) => Date.parse(a.start)<Date.parse(b.end) && Date.parse(b.start)<Date.parse(a.end)
export const isProvisional = (status:LoanStatus) => ['pending_sync','availability_pending'].includes(status)

const transitionPermission: Partial<Record<LoanStatus,string>> = {
  requested:'loan.request', approved:'loan.approve', rejected:'loan.approve', released:'loan.release',
  in_use:'loan.release', return_pending:'loan.release', completed:'loan.release', cancelled:'loan.request',
}
const transitions: Record<LoanStatus,LoanStatus[]> = {
  draft:['pending_sync','availability_pending','requested','cancelled'], pending_sync:['availability_pending','requested','cancelled'],
  availability_pending:['requested','cancelled'], requested:['approved','rejected','cancelled'], approved:['released','cancelled'],
  rejected:[], released:['in_use'], in_use:['return_pending'], return_pending:['completed'], completed:[], cancelled:[],
}
export function canTransitionLoan(from:LoanStatus,to:LoanStatus,permissions:string[]) {
  const needed=transitionPermission[to]
  return transitions[from].includes(to) && (!needed || permissions.includes(needed))
}
