import {createClient, type SupabaseClient} from '@supabase/supabase-js'
import type {EffectiveScope} from '../domain/contracts'
import type {Loan, LoanStatus} from '../features/loans/domain'
import type {WorkOrder, WorkOrderStatus} from '../features/work-orders/domain'

export interface Option {id:string;label:string}
export interface LoanInput {vehicleId:string;driverId:string;start:string;end:string;destination:string;purpose:string}
export interface Reservation {vehicleId:string;start:string;end:string}
export interface MobileSnapshot {scope:EffectiveScope;vehicles:Option[];calendarVehicles?:Option[];drivers:Option[];loans:Loan[];orders:WorkOrder[];reservations?:Reservation[]}
export interface MobileRuntime {
  restore():Promise<MobileSnapshot|null>
  login(email:string,password:string):Promise<MobileSnapshot>
  logout():Promise<void>
  refresh():Promise<MobileSnapshot>
  requestLoan(input:LoanInput):Promise<void>
  transitionLoan(id:string,action:'approve'|'reject'|'release',reason?:string):Promise<MobileSnapshot>
  subscribeLoans?(listener:(snapshot:MobileSnapshot)=>void):()=>void
}

const URL='https://gocdyfhzqezpqyebixid.supabase.co'
const KEY='sb_publishable_i6Gue0-k2TnW4PsHe-QnPg__EECrNbS'
const CACHE='frotamanager.mobile.snapshot.v3'

const text=(value:unknown)=>value==null?'':String(value)
export const resolveScopedIds=(values:string[])=>{const parsed=values.map(Number).filter(Number.isFinite);return parsed.length?parsed:null}
const loanStatus=(value:unknown):LoanStatus=>{
  const normalized=text(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replaceAll(' ','_')
  const map:Record<string,LoanStatus>={solicitado:'requested',aprovado:'approved',rejeitado:'rejected',liberado:'released',em_uso:'in_use',devolucao_pendente:'return_pending',finalizado:'completed',concluido:'completed',cancelado:'cancelled'}
  return map[normalized]??'requested'
}
const orderStatus=(value:unknown):WorkOrderStatus=>{
  const normalized=text(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replaceAll(' ','_')
  const map:Record<string,WorkOrderStatus>={pre_os:'pre_order','pre-os':'pre_order',aberta:'open',aberto:'open',atribuida:'assigned',em_andamento:'in_progress',pausada:'paused',aguardando_pecas:'waiting_parts',aguardando_terceiro:'waiting_third_party',concluida:'completed',concluido:'completed',cancelada:'cancelled',cancelado:'cancelled',reaberta:'reopened'}
  return map[normalized]??'open'
}
const dateTime=(date:unknown,time:unknown)=>`${text(date)}T${text(time)||'00:00:00'}`

export function createMobileRuntime(client:SupabaseClient, storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>=localStorage):MobileRuntime {
  let current:MobileSnapshot|null=null
  const cache=(snapshot:MobileSnapshot)=>{current=snapshot;storage.setItem(CACHE,JSON.stringify(snapshot));return snapshot}
  const cached=()=>{try{return JSON.parse(storage.getItem(CACHE)??'null') as MobileSnapshot|null}catch{return null}}
  async function scope():Promise<EffectiveScope>{
    const {data,error}=await client.rpc('get_mobile_scope');if(error)throw new Error(error.message)
    return data as EffectiveScope
  }
  async function load(granted:EffectiveScope):Promise<MobileSnapshot>{
    const vehicleIds=resolveScopedIds(granted.vehicleIds)
    // Para usuários vinculados a setor, nenhum motorista encontrado significa nenhum acesso,
    // nunca acesso irrestrito. Sem setor, lista vazia mantém o padrão global do cadastro.
    const driverIds=granted.sectorIds.length ? (resolveScopedIds(granted.driverIds)??[]) : resolveScopedIds(granted.driverIds)
    // Registros legados podem ter excluido nulo; o site considera nulo como ativo.
    let vehicleQuery=client.from('equipamentos').select('id,placa,modelo').eq('tenant',granted.tenant)
    if(vehicleIds) vehicleQuery=vehicleQuery.in('id',vehicleIds)
    let driverQuery=client.from('motoristas').select('id,nome').eq('tenant',granted.tenant)
    if(driverIds!==null) driverQuery=driverQuery.in('id',driverIds)
    const hasLoans=granted.permissions.some(p=>p.startsWith('loan.'))
    const loanQuery=hasLoans ? client.rpc('get_mobile_loans') : Promise.resolve({data:{loans:[],reservations:[]},error:null})
    let orderQuery=client.from('ordens_servico').select('id,numero,equipamento_id,status,descricao,motivo,itens').eq('tenant',granted.tenant)
    if(vehicleIds) orderQuery=orderQuery.in('equipamento_id',vehicleIds)
    const hasOrders=granted.permissions.some(p=>p.startsWith('work_order.'))
    const [vehicles,drivers,loans,orders]=await Promise.all([vehicleQuery,driverQuery,loanQuery,hasOrders?orderQuery:Promise.resolve({data:[],error:null})])
    for(const result of [vehicles,drivers,loans,orders])if(result.error)throw new Error(result.error.message)
    const vehicleOption=(x:any)=>({id:text(x.id),label:`${text(x.placa)||'Sem placa'}${x.modelo?` — ${x.modelo}`:''}`})
    const requestVehicles=(vehicles.data??[]).map(vehicleOption)
    const calendarVehicles=(loans.data?.calendarVehicles??vehicles.data??[]).map(vehicleOption)
    return cache({scope:granted,
      vehicles:requestVehicles,
      calendarVehicles,
      drivers:(drivers.data??[]).map((x:any)=>({id:text(x.id),label:text(x.nome)})),
      reservations:loans.data?.reservations??[],
      loans:(loans.data?.loans??[]).map((x:any)=>({id:text(x.id),vehicleId:text(x.veiculo_id),driverId:text(x.motorista_id),requesterId:text(x.solicitante_usuario_id),sectorId:x.setor_id==null?null:text(x.setor_id),status:loanStatus(x.status),period:{start:dateTime(x.data_saida,x.hora_saida),end:dateTime(x.data_prevista_retorno,x.hora_prevista_retorno)},destination:text(x.destino),purpose:text(x.finalidade),checklistRequired:!!x.checklist_saida_obrigatorio,checklistDone:['concluido','concluida','finalizado','finalizada','aprovado','aprovada'].includes(text(x.checklist_saida_status).toLowerCase()),rejectionReason:text(x.motivo_recusa),decidedBy:text(x.decidido_por),decidedAt:text(x.decidido_em)})),
      orders:(orders.data??[]).map((x:any)=>({id:text(x.numero||x.id),equipmentId:x.equipamento_id==null?null:text(x.equipamento_id),status:orderStatus(x.status),description:text(x.descricao||x.motivo||'Sem descrição'),steps:[]})),
    })
  }
  return {
    async restore(){
      // Never reuse the previous release's unscoped cache.
      // Leave legacy storage untouched for recovery of any unsent offline records.
      const local=cached()
      const {data}=await client.auth.getSession();if(!data.session)return null
      if(typeof navigator!=='undefined'&&!navigator.onLine){
        if(local?.scope.userId===data.session.user.id && Date.parse(local.scope.expiresAt)>Date.now())return cache(local)
        return null
      }
      return load(await scope())
    },
    async login(email,password){const {data,error}=await client.auth.signInWithPassword({email:email.trim().toLowerCase(),password});if(error||!data.session)throw new Error(error?.message??'Falha no login');return load(await scope())},
    async logout(){await client.auth.signOut();current=null;storage.removeItem(CACHE)},
    async refresh(){return load(await scope())},
    async requestLoan(input){
      if(!current)throw new Error('Sessão não carregada')
      const vehicle=current.vehicles.find(x=>x.id===input.vehicleId),driver=current.drivers.find(x=>x.id===input.driverId)
      if(typeof navigator!=='undefined'&&!navigator.onLine){const id=`offline-${crypto.randomUUID()}`;current=cache({...current,loans:[...current.loans,{id,vehicleId:input.vehicleId,driverId:input.driverId,requesterId:current.scope.userId,sectorId:current.scope.sectorIds[0]??null,status:'availability_pending',period:{start:input.start,end:input.end},destination:input.destination,purpose:input.purpose}]});return}
      const {data:profile,error:profileError}=await client.from('usuarios').select('id').eq('auth_user_id',current.scope.userId).maybeSingle()
      if(profileError) throw new Error(profileError.message)
      if(!profile?.id) throw new Error('Perfil do solicitante não encontrado')
      const {error}=await client.from('emprestimos_veiculos').insert({id:Date.now(),tenant:current.scope.tenant,veiculo_id:Number(input.vehicleId),veiculo_placa:vehicle?.label.split(' — ')[0]??'',motorista_id:Number(input.driverId),motorista_nome:driver?.label??'',solicitante:'Aplicativo móvel',solicitante_usuario_id:Number(profile.id),finalidade:input.purpose,destino:input.destination,data_solicitacao:new Date().toISOString().slice(0,10),data_saida:input.start.slice(0,10),hora_saida:input.start.slice(11,16),data_prevista_retorno:input.end.slice(0,10),hora_prevista_retorno:input.end.slice(11,16),status:'Solicitado',setor_id:current.scope.sectorIds[0]?Number(current.scope.sectorIds[0]):null,ativo:true})
      if(error)throw new Error(error.message);await load(current.scope)
    },
    async transitionLoan(id,action,reason){
      if(!current)throw new Error('Sessão não carregada')
      if(typeof navigator!=='undefined'&&!navigator.onLine)throw new Error('Conecte-se à internet para decidir ou liberar o veículo')
      const payload:{p_loan_id:number;p_action:string;p_reason?:string}={p_loan_id:Number(id),p_action:action}
      if(action==='reject')payload.p_reason=reason?.trim()??''
      const {error}=await client.rpc('transition_mobile_loan',payload)
      if(error)throw new Error(error.message)
      return load(current.scope)
    },
    subscribeLoans(listener){
      if(!current)return()=>undefined
      const userId=current.scope.userId
      const channel=client.channel(`mobile_loans_${userId}`).on('postgres_changes',{event:'*',schema:'public',table:'emprestimos_veiculos',filter:`tenant=eq.${current.scope.tenant}`},()=>{
        if(!current||current.scope.userId!==userId)return
        void load(current.scope).then(listener).catch(()=>undefined)
      }).subscribe()
      return()=>{void client.removeChannel(channel)}
    },
  }
}

export const liveRuntime=createMobileRuntime(createClient(URL,KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}}))
