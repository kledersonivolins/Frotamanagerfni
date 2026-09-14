import {describe,it,expect,vi} from 'vitest'
import {createMobileRuntime} from './runtime'
import type {SupabaseClient} from '@supabase/supabase-js'
const scope={tenant:'t',userId:'uuid',companyIds:['1'],sectorIds:['2'],vehicleIds:['10'],driverIds:['20'],permissions:['mobile.access','loan.request'],expiresAt:'2099-01-01'}
function fixture(){
 const from=vi.fn((table:string)=>{
  if(table==='emprestimos_veiculos')throw Error('Raw loan data must not be downloaded')
  const q:any={select:()=>q,eq:()=>q,in:()=>q,then:(resolve:any)=>Promise.resolve({data:[],error:null}).then(resolve)};return q
 })
 const rpc=vi.fn(async(name:string)=>({error:null,data:name==='get_mobile_scope'?scope:{loans:[{id:'9',solicitante_usuario_id:'123',status:'finalizado',veiculo_id:'10'}],reservations:[{vehicleId:'10',start:'2026-09-14T10:00',end:'2026-09-14T11:00'}]}}))
 const storage={getItem:vi.fn(()=>null),setItem:vi.fn(),removeItem:vi.fn()}
 const client={rpc,from,auth:{getSession:async()=>({data:{session:{user:{id:'uuid'}}}})}} as unknown as SupabaseClient
 return {runtime:createMobileRuntime(client,storage),storage,rpc}
}
describe('privacidade de empréstimos',()=>{
 it('usa retorno restrito do servidor, separa agenda sem dados pessoais e mapeia finalizado',async()=>{
  const {runtime,rpc,storage}=fixture()
  const data=await runtime.restore()
  expect(rpc).toHaveBeenCalledWith('get_mobile_loans')
  expect(data?.loans[0].requesterId).toBe('123')
  expect(data?.loans[0].status).toBe('completed')
  expect(Object.keys(data!.reservations![0]).sort()).toEqual(['end','start','vehicleId'])
  expect(storage.removeItem).toHaveBeenCalledWith('frotamanager.mobile.snapshot.v1')
 })
 it('não reapresenta cache antigo quando o servidor recusa a consulta',async()=>{
  const {runtime,rpc}=fixture()
  rpc.mockResolvedValueOnce({data:null,error:{message:'Acesso revogado'}} as any)
  await expect(runtime.restore()).rejects.toThrow('Acesso revogado')
 })
})
