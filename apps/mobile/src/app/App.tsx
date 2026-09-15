import {useEffect,useState,type FormEvent} from 'react'
import {App as NativeApp} from '@capacitor/app'
import {LoanCalendar} from '../features/loans/LoanCalendar'
import {LoanRequestForm} from '../features/loans/LoanRequestForm'
import {LoansHome} from '../features/loans/LoansHome'
import type {Loan} from '../features/loans/domain'
import {WorkOrdersHome} from '../features/work-orders/WorkOrdersHome'
import type {WorkOrder} from '../features/work-orders/domain'
import './app.css'
import {liveRuntime,type MobileRuntime,type MobileSnapshot} from './runtime'
type Page='home'|'loans'|'loan-new'|'calendar'|'orders'
export async function exitMobileApp(){
 try{await NativeApp.exitApp()}catch{window.close()}
}
export function App({runtime=liveRuntime}:{runtime?:MobileRuntime}){const[page,setPage]=useState<Page>('home');const[snapshot,setSnapshot]=useState<MobileSnapshot|null>(null);const[booting,setBooting]=useState(true);const[error,setError]=useState('');const online=typeof navigator==='undefined'||navigator.onLine
 useEffect(()=>{runtime.restore().then(setSnapshot).catch(e=>setError(e instanceof Error?e.message:'Falha ao abrir')).finally(()=>setBooting(false))},[runtime])
 useEffect(()=>{if(!snapshot)return;const reconnect=()=>runtime.refresh().then(setSnapshot).catch(()=>undefined);window.addEventListener('online',reconnect);return()=>window.removeEventListener('online',reconnect)},[runtime,snapshot])
 if(booting)return <div className="login-page"><div className="login-card"><h1>FrotaManager</h1><p>Carregando dados do aparelho…</p></div></div>
 if(!snapshot)return <Login error={error} onLogin={async(email,password)=>{setError('');setBooting(true);try{setSnapshot(await runtime.login(email,password))}catch(e){setError(e instanceof Error?e.message:'Falha no login')}finally{setBooting(false)}}}/>
 const loans:Loan[]=snapshot.loans;const orders:WorkOrder[]=snapshot.orders
 const canLoans=snapshot.scope.permissions.some(p=>p.startsWith('loan.'));const canOrders=snapshot.scope.permissions.includes('work_order.view')||snapshot.scope.permissions.includes('work_order.execute')||snapshot.scope.permissions.includes('work_order.create')
 let content=<section><h2>Olá</h2><p>Escolha um módulo para trabalhar. Os dados disponíveis respeitam os acessos definidos no site.</p><div className="cards">{canLoans&&<button className="item button-item" onClick={()=>setPage('loans')}><strong>Empréstimos</strong><span>Solicitar, aprovar, checklist e acompanhar reservas</span></button>}{canOrders&&<button className="item button-item" onClick={()=>setPage('orders')}><strong>Ordens de Serviço</strong><span>Executar tarefas, registrar horários e evidências</span></button>}{!canLoans&&!canOrders&&<div className="empty">Nenhum módulo móvel foi liberado para este usuário.</div>}</div></section>
 if(page==='loans')content=<LoansHome loans={loans} vehicles={snapshot.calendarVehicles??snapshot.vehicles} canRequest={snapshot.scope.permissions.includes('loan.request')} canApprove={snapshot.scope.permissions.includes('loan.approve')} canRelease={snapshot.scope.permissions.includes('loan.release')} onNew={()=>setPage('loan-new')} onCalendar={()=>setPage('calendar')} onAction={async(id,action)=>setSnapshot(await runtime.transitionLoan(id,action))}/>
 if(page==='loan-new')content=<LoanRequestForm online={online} vehicles={snapshot.vehicles} drivers={snapshot.drivers} onSubmit={async values=>{await runtime.requestLoan(values as any);setSnapshot(await runtime.restore()??snapshot);setPage('loans')}}/>
 if(page==='calendar')content=<LoanCalendar reservations={snapshot.reservations??[]} vehicles={snapshot.calendarVehicles??snapshot.vehicles} online={online}/>
 if(page==='orders')content=<WorkOrdersHome orders={orders} onOpen={()=>undefined}/>
 return <div className="app"><header className="top"><div><h1>FrotaManager</h1><span>Operação móvel · 1.0.4</span></div><div className="top-actions"><button aria-label="Sincronizar" onClick={async()=>setSnapshot(await runtime.refresh())}>↻</button><button className="exit-app" aria-label="Sair do aplicativo" onClick={()=>void exitMobileApp()}>Sair</button><span className={online?'online':'offline'}>{online?'● Online':'● Offline'}</span></div></header><main>{content}</main><nav className="bottom" aria-label="Navegação principal"><button className={page==='home'?'active':''} onClick={()=>setPage('home')}>Início</button>{canLoans&&<button className={page.startsWith('loan')?'active':''} onClick={()=>setPage('loans')}>Empréstimos</button>}{canLoans&&<button className={page==='calendar'?'active':''} onClick={()=>setPage('calendar')}>Calendário</button>}{canOrders&&<button className={page==='orders'?'active':''} onClick={()=>setPage('orders')}>Ordens de Serviço</button>}</nav></div>
}

function Login({error,onLogin}:{error:string;onLogin:(email:string,password:string)=>Promise<void>}){const[email,setEmail]=useState('');const[password,setPassword]=useState('');async function submit(e:FormEvent){e.preventDefault();await onLogin(email,password)}return <div className="login-page"><form className="login-card" onSubmit={submit}><div className="brand-mark">FM</div><h1>Entrar no FrotaManager</h1><p>Use o mesmo usuário e senha cadastrados no sistema.</p><label>E-mail<input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoCapitalize="none" required/></label><label>Senha<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>{error&&<div className="notice error">{error}</div>}<button className="primary" type="submit">Entrar</button><small>O primeiro acesso precisa de internet.</small></form></div>}
