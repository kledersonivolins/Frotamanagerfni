import type { EffectiveScope, SyncOperation } from '../../domain/contracts'
import type { WorkOrder } from './domain'
export interface ExecutionEntry {id:string;workOrderId:string;type:string;actorId:string;at:string;data:Record<string,unknown>}
export interface WorkOrderStorage {listWorkOrders():Promise<WorkOrder[]>;saveEntryAndOperation(entry:ExecutionEntry,operation:SyncOperation):Promise<void>}
export function createWorkOrderRepository(storage:WorkOrderStorage,scope:EffectiveScope,id:()=>string=()=>crypto.randomUUID(),now=()=>new Date()){
 return {async listWorkOrders(){return (await storage.listWorkOrders()).filter(os=>!os.equipmentId||scope.vehicleIds.includes(os.equipmentId))},async appendEntry(workOrderId:string,type:string,data:Record<string,unknown>){
  if(!scope.permissions.includes('work_order.execute'))throw new Error('WORK_ORDER_EXECUTION_DENIED')
  const entityId=id();const at=now().toISOString();const entry:ExecutionEntry={id:entityId,workOrderId,type,actorId:scope.userId,at,data};const operation:SyncOperation={operationId:id(),entityType:'work_order_entry',entityId,kind:'create',baseVersion:null,payload:entry as unknown as Record<string,unknown>,deviceCreatedAt:at};await storage.saveEntryAndOperation(entry,operation);return entry
 }}
}
