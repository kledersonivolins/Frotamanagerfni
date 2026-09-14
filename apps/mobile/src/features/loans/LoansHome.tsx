import type {Loan} from './domain'
import type {Option} from '../../app/runtime'
const labels:Record<string,string>={requested:'Solicitado',approved:'Aprovado',completed:'Finalizado',cancelled:'Cancelado',in_use:'Em uso',availability_pending:'Aguardando confirmação'}
export function LoansHome({loans,vehicles,canRequest,onNew,onCalendar}:{loans:Loan[];vehicles:Option[];canRequest:boolean;onNew:()=>void;onCalendar:()=>void}){
 return <section><div className="title-row"><h2>Solicitações</h2>{canRequest&&<button className="primary" onClick={onNew}>Nova solicitação</button>}</div><button className="secondary wide" onClick={onCalendar}>Abrir calendário de disponibilidade</button><div className="cards">{loans.length?loans.map(x=><article className="item" key={x.id}><strong>{vehicles.find(v=>v.id===x.vehicleId)?.label??'Veículo'}</strong><span>{x.destination}</span><span>{new Date(x.period.start).toLocaleString('pt-BR')}</span><em>{labels[x.status]??x.status.replaceAll('_',' ')}</em></article>):<div className="empty">Nenhuma solicitação disponível para você.</div>}</div></section>
}
