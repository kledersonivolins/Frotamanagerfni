import { expect, it } from 'vitest'
import type { EffectiveScope } from '../../domain/contracts'
import { createWorkOrderRepository, type WorkOrderStorage } from './repository'
const scope:EffectiveScope={tenant:'t',userId:'u1',companyIds:['1'],sectorIds:[],vehicleIds:['eq1'],driverIds:[],permissions:['mobile.access','work_order.execute'],validatedAt:'',expiresAt:''}
it('persiste apontamento e operação com a mesma identidade',async()=>{const saved:any[]=[];const store:WorkOrderStorage={listWorkOrders:async()=>[],saveEntryAndOperation:async(e,o)=>{saved.push([e,o])}};const repo=createWorkOrderRepository(store,scope,()=> 'entry-1',()=>new Date('2026-09-14T12:00:00Z'));await repo.appendEntry('os1','start',{});expect(saved[0][0].id).toBe('entry-1');expect(saved[0][1].entityId).toBe('entry-1')})
