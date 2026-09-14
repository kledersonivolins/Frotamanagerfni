import { describe, expect, it } from 'vitest'
import type { EffectiveScope } from '../../domain/contracts'
import { createLoanRepository, type LoanStorage, type ReferenceOption } from './repository'

const scope:EffectiveScope={tenant:'t1',userId:'u1',companyIds:['c1'],sectorIds:['s1'],vehicleIds:['v1'],driverIds:['d2'],permissions:['mobile.access','loan.request'],validatedAt:'2026-09-14T12:00:00Z',expiresAt:'2026-09-21T12:00:00Z'}
class Memory implements LoanStorage {
  records:ReferenceOption[]=[{kind:'vehicle',id:'v1',label:'Carro 1'},{kind:'vehicle',id:'v2',label:'Carro 2'},{kind:'driver',id:'d1',label:'Um'},{kind:'driver',id:'d2',label:'Dois'}]
  loans:any[]=[]; operations:any[]=[]
  async listReferences(){return this.records}
  async listLoans(){return this.loans}
  async saveLoanAndOperation(loan:any,operation:any){this.loans.push(loan);this.operations.push(operation)}
}
describe('loan repository',()=>{
  it('retorna somente veículos e motoristas do escopo efetivo',async()=>{const repo=createLoanRepository(new Memory(),scope);expect((await repo.listVehicles()).map(x=>x.id)).toEqual(['v1']);expect((await repo.listDrivers()).map(x=>x.id)).toEqual(['d2'])})
  it('salva solicitação offline aguardando confirmação de disponibilidade',async()=>{const store=new Memory();const repo=createLoanRepository(store,scope,()=> 'uuid-1',()=>new Date('2026-09-14T12:00:00Z'));const loan=await repo.requestOffline({vehicleId:'v1',driverId:'d2',start:'2026-09-15T08:00:00Z',end:'2026-09-15T10:00:00Z',destination:'Obra',purpose:'Visita'});expect(loan.status).toBe('availability_pending');expect(store.operations).toHaveLength(1)})
})
