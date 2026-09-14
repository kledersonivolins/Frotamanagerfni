import {useState} from 'react'
import {LoanCalendar} from '../features/loans/LoanCalendar'
import {LoanRequestForm} from '../features/loans/LoanRequestForm'
import {LoansHome} from '../features/loans/LoansHome'
import type {Loan} from '../features/loans/domain'
import {WorkOrdersHome} from '../features/work-orders/WorkOrdersHome'
import type {WorkOrder} from '../features/work-orders/domain'
import './app.css'
type Page='home'|'loans'|'loan-new'|'calendar'|'orders'
export function App(){const[page,setPage]=useState<Page>('home');const[loans]=useState<Loan[]>([]);const[orders]=useState<WorkOrder[]>([]);const online=typeof navigator==='undefined'||navigator.onLine
 let content=<section><h2>Olá</h2><p>Escolha um módulo para trabalhar. Os dados pendentes permanecem no aparelho até a sincronização.</p><div className="cards"><button className="item button-item" onClick={()=>setPage('loans')}><strong>Empréstimos</strong><span>Solicitar, aprovar, checklist e acompanhar reservas</span></button><button className="item button-item" onClick={()=>setPage('orders')}><strong>Ordens de Serviço</strong><span>Executar tarefas, registrar horários e evidências</span></button></div></section>
 if(page==='loans')content=<LoansHome loans={loans} onNew={()=>setPage('loan-new')} onCalendar={()=>setPage('calendar')}/>
 if(page==='loan-new')content=<LoanRequestForm online={online} vehicles={[]} drivers={[]} onSubmit={async()=>undefined}/>
 if(page==='calendar')content=<LoanCalendar loans={loans} online={online}/>
 if(page==='orders')content=<WorkOrdersHome orders={orders} onOpen={()=>undefined}/>
 return <div className="app"><header className="top"><div><h1>FrotaManager</h1><span>Operação móvel</span></div><span className={online?'online':'offline'}>{online?'● Online':'● Offline'}</span></header><main>{content}</main><nav className="bottom" aria-label="Navegação principal"><button className={page==='home'?'active':''} onClick={()=>setPage('home')}>Início</button><button className={page.startsWith('loan')||page==='calendar'?'active':''} onClick={()=>setPage('loans')}>Empréstimos</button><button className={page==='orders'?'active':''} onClick={()=>setPage('orders')}>Ordens de Serviço</button></nav></div>
}
