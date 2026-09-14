import {useState} from 'react'
import type {Option,Reservation} from '../../app/runtime'
const dayKey=(d:Date)=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')
export function dayReservations(slots:Reservation[],day:string,vehicleId=''){
 const start=new Date(day+'T00:00:00'),end=new Date(start);end.setDate(end.getDate()+1)
 return slots.filter(s=>(!vehicleId||s.vehicleId===vehicleId)&&Date.parse(s.start)<end.getTime()&&Date.parse(s.end)>start.getTime())
}
export function LoanCalendar({reservations,vehicles,online}:{reservations:Reservation[];vehicles:Option[];online:boolean}){
 const [month,setMonth]=useState(()=>{const d=new Date();return new Date(d.getFullYear(),d.getMonth(),1)})
 const [selected,setSelected]=useState(()=>dayKey(new Date()))
 const [vehicleId,setVehicleId]=useState('')
 const slots=reservations.filter(s=>vehicles.some(v=>v.id===s.vehicleId))
 const days=new Date(month.getFullYear(),month.getMonth()+1,0).getDate()
 function move(offset:number){const d=new Date(month.getFullYear(),month.getMonth()+offset,1);setMonth(d);setSelected(dayKey(d))}
 const selectedSlots=dayReservations(slots,selected,vehicleId)
 return <section className="calendar">
  <h2>Calendário de disponibilidade</h2><p>Consulte os dias e horários dos veículos liberados para você.</p>
  {!online&&<div className="notice warning">Dados da última sincronização. Confirme a disponibilidade quando estiver online.</div>}
  <label>Veículo da agenda<select aria-label="Veículo da agenda" value={vehicleId} onChange={e=>setVehicleId(e.target.value)}><option value="">Todos os autorizados</option>{vehicles.map(v=><option key={v.id} value={v.id}>{v.label}</option>)}</select></label>
  <div className="calendar-controls"><button aria-label="Mês anterior" onClick={()=>move(-1)}>‹</button><strong>{month.toLocaleDateString('pt-BR',{month:'long',year:'numeric'})}</strong><button aria-label="Próximo mês" onClick={()=>move(1)}>›</button></div>
  <div className="calendar-grid" aria-label="Dias do mês">
   {['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(d=><span key={d}>{d}</span>)}
   {Array.from({length:month.getDay()},(_,i)=><span key={'blank'+i}/>)}
   {Array.from({length:days},(_,i)=>{const day=dayKey(new Date(month.getFullYear(),month.getMonth(),i+1));const busy=dayReservations(slots,day,vehicleId).length>0;return <button key={day} aria-label={day+(busy?' — com reservas':' — sem reservas')} aria-pressed={selected===day} className={selected===day?'selected':busy?'reserved':''} onClick={()=>setSelected(day)}>{i+1}<small>{busy?'●':'·'}</small></button>})}
  </div><p>● Dia com reserva — toque para consultar os horários.</p>
  <h3>{new Date(selected+'T12:00:00').toLocaleDateString('pt-BR')}</h3>
  <div className="cards">{vehicles.filter(v=>!vehicleId||v.id===vehicleId).map(v=>{const busy=selectedSlots.filter(s=>s.vehicleId===v.id).sort((a,b)=>a.start.localeCompare(b.start));return <article className="item" key={v.id}><strong>{v.label}</strong>{busy.length?busy.map((s,i)=><span key={i}>Reservado: {new Date(s.start).toLocaleString('pt-BR')} até {new Date(s.end).toLocaleString('pt-BR')}</span>):<span>Sem reservas neste dia</span>}</article>})}</div>
  {!vehicles.length&&<div className="empty">Nenhum veículo autorizado para esta conta.</div>}
 </section>
}
