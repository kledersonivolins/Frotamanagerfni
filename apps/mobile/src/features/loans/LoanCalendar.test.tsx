import {fireEvent,render,screen} from '@testing-library/react'
import {describe,it,expect} from 'vitest'
import {LoanCalendar,dayReservations} from './LoanCalendar'
const vehicles=[{id:'1',label:'QRS5D27'},{id:'2',label:'OUC0141'}]
describe('calendário mensal',()=>{
 it('exibe dias mesmo sem reservas, permite trocar mês e filtrar veículo',()=>{
  render(<LoanCalendar reservations={[]} vehicles={vehicles} online/>)
  expect(screen.getByLabelText('Dias do mês').querySelectorAll('button').length).toBeGreaterThanOrEqual(28)
  fireEvent.click(screen.getByRole('button',{name:'Próximo mês'}))
  fireEvent.change(screen.getByLabelText('Veículo da agenda'),{target:{value:'1'}})
  expect(screen.getAllByText('Sem reservas neste dia')).toHaveLength(1)
 })
 it('reserva atravessa dias, mas término à meia-noite não ocupa o próximo dia',()=>{
  const slots=[{vehicleId:'1',start:'2026-09-14T23:00',end:'2026-09-16T00:00'}]
  expect(dayReservations(slots,'2026-09-15','1')).toHaveLength(1)
  expect(dayReservations(slots,'2026-09-16','1')).toHaveLength(0)
  expect(dayReservations(slots,'2026-09-15','2')).toHaveLength(0)
 })
})
