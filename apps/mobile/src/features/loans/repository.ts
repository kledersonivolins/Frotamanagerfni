import type { EffectiveScope, SyncOperation } from '../../domain/contracts'
import type { Loan } from './domain'
export interface ReferenceOption {kind:'vehicle'|'driver';id:string;label:string}
export interface LoanStorage {listReferences():Promise<ReferenceOption[]>;listLoans():Promise<Loan[]>;saveLoanAndOperation(loan:Loan,operation:SyncOperation):Promise<void>}
export interface OfflineLoanRequest {vehicleId:string;driverId:string;start:string;end:string;destination:string;purpose:string}
export function createLoanRepository(storage:LoanStorage,scope:EffectiveScope,id:()=>string=()=>crypto.randomUUID(),now=()=>new Date()){
 const allowed=(kind:'vehicle'|'driver',ids:string[])=>storage.listReferences().then(rows=>rows.filter(x=>x.kind===kind&&ids.includes(x.id)))
 return {listVehicles:()=>allowed('vehicle',scope.vehicleIds),listDrivers:()=>allowed('driver',scope.driverIds),listLoans:()=>storage.listLoans(),async requestOffline(input:OfflineLoanRequest){
  if(!scope.permissions.includes('loan.request'))throw new Error('LOAN_REQUEST_DENIED')
  if(!scope.vehicleIds.includes(input.vehicleId)||!scope.driverIds.includes(input.driverId))throw new Error('ITEM_NOT_ALLOWED')
  if(Date.parse(input.start)>=Date.parse(input.end))throw new Error('INVALID_PERIOD')
  const entityId=id();const at=now().toISOString();const loan:Loan={id:entityId,vehicleId:input.vehicleId,driverId:input.driverId,requesterId:scope.userId,sectorId:scope.sectorIds[0]??null,status:'availability_pending',period:{start:input.start,end:input.end},destination:input.destination,purpose:input.purpose}
  const operation:SyncOperation={operationId:id(),entityType:'loan',entityId,kind:'create',baseVersion:null,payload:loan as unknown as Record<string,unknown>,deviceCreatedAt:at}
  await storage.saveLoanAndOperation(loan,operation);return loan
 }}
}
