import {act, fireEvent, render, screen, waitFor} from '@testing-library/react'
import {describe, expect, it, vi} from 'vitest'
import {App} from './App'
import type {MobileRuntime, MobileSnapshot} from './runtime'
import type {Loan} from '../features/loans/domain'

const snapshot: MobileSnapshot = {
  scope: {tenant:'oficinafni',userId:'u1',companyIds:['1'],sectorIds:['2'],vehicleIds:['10'],driverIds:['20'],permissions:['mobile.access','loan.view','loan.request','work_order.view'],validatedAt:'2026-09-14T10:00:00Z',expiresAt:'2026-09-21T10:00:00Z'},
  vehicles:[{id:'10',label:'ABC1D23 — Strada'}], drivers:[{id:'20',label:'Maria'}],
  loans:[], orders:[{id:'30',equipmentId:'10',status:'open',description:'Trocar óleo',steps:[]}],
}

function runtime(): MobileRuntime {
  return {restore:async()=>null,login:async()=>snapshot,logout:async()=>undefined,refresh:async()=>snapshot,requestLoan:async()=>undefined,transitionLoan:async()=>snapshot}
}

describe('App', () => {
  it('mostra calendário na navegação para quem só pode solicitar',async()=>{
    const r=runtime()
    r.restore=async()=>({...snapshot,scope:{...snapshot.scope,permissions:['mobile.access','loan.request']}})
    render(<App runtime={r}/>)
    fireEvent.click(await screen.findByRole('button',{name:'Calendário'}))
    expect(screen.getByRole('heading',{name:'Calendário de disponibilidade'})).toBeVisible()
    expect(screen.getByRole('button',{name:'Próximo mês'})).toBeVisible()
  })
  it('exige login antes de abrir os módulos', async () => {
    render(<App runtime={runtime()} />)
    expect(await screen.findByRole('heading',{name:'Entrar no FrotaManager'})).toBeVisible()
    expect(screen.queryByRole('button',{name:'Empréstimos'})).not.toBeInTheDocument()
  })

  it('carrega o escopo e os dados reais depois do login', async () => {
    render(<App runtime={runtime()} />)
    fireEvent.change(await screen.findByLabelText('E-mail'),{target:{value:'usuario@empresa.com.br'}})
    fireEvent.change(screen.getByLabelText('Senha'),{target:{value:'segredo'}})
    fireEvent.click(screen.getByRole('button',{name:'Entrar'}))
    await waitFor(()=>expect(screen.getByRole('button',{name:'Ordens de Serviço'})).toBeVisible())
    fireEvent.click(screen.getByRole('button',{name:'Ordens de Serviço'}))
    expect(await screen.findByText('Trocar óleo')).toBeVisible()
  })

  it('oferece saída do aplicativo após o login', async () => {
    const r=runtime();r.restore=async()=>snapshot
    render(<App runtime={r}/>)
    expect(await screen.findByRole('button',{name:'Sair do aplicativo'})).toBeVisible()
  })

  it('permite ao aprovador aprovar e depois liberar a solicitação do setor',async()=>{
    const permissions=['mobile.access','loan.view','loan.approve','loan.release']
    const approve=async()=>({...snapshot,loans:[{...loan,status:'approved' as const}],scope:{...snapshot.scope,permissions}})
    const loan:Loan={id:'99',vehicleId:'10',driverId:'20',requesterId:'30',sectorId:'2',status:'requested',period:{start:'2026-09-15T14:00',end:'2026-09-15T17:00'},destination:'Obra',purpose:'Serviço',checklistRequired:true,checklistDone:false}
    const r=runtime();r.restore=async()=>({...snapshot,loans:[loan],scope:{...snapshot.scope,permissions}});r.transitionLoan=async(_id,action)=>action==='approve'?approve():snapshot
    render(<App runtime={r}/>)
    fireEvent.click(await screen.findByRole('button',{name:'Empréstimos'}))
    fireEvent.click(await screen.findByRole('button',{name:'Aprovar solicitação'}))
    expect(await screen.findByRole('button',{name:'Registrar saída / liberar'})).toBeEnabled()
  })

  it('recebe aprovação de outro usuário enquanto o aplicativo está aberto',async()=>{
    let listener:((value:MobileSnapshot)=>void)|undefined
    const r=runtime();r.restore=async()=>({...snapshot,loans:[],scope:{...snapshot.scope,permissions:['mobile.access','loan.release']}});r.subscribeLoans=callback=>{listener=callback;return()=>undefined}
    render(<App runtime={r}/>)
    fireEvent.click(await screen.findByRole('button',{name:'Empréstimos'}))
    const approved:Loan={id:'99',vehicleId:'10',driverId:'20',requesterId:'30',sectorId:'2',status:'approved',period:{start:'2026-09-15T14:00',end:'2026-09-15T17:00'},destination:'Obra',purpose:'Serviço'}
    act(()=>listener?.({...snapshot,loans:[approved],scope:{...snapshot.scope,permissions:['mobile.access','loan.release']}}))
    expect(await screen.findByRole('button',{name:'Registrar saída / liberar'})).toBeEnabled()
  })

  it('permite ao coordenador recusar uma solicitação informando o motivo',async()=>{
    const loan:Loan={id:'99',vehicleId:'10',driverId:'20',requesterId:'30',sectorId:'2',status:'requested',period:{start:'2026-09-15T14:00',end:'2026-09-15T17:00'},destination:'Obra',purpose:'Serviço'}
    const r=runtime();r.restore=async()=>({...snapshot,loans:[loan],scope:{...snapshot.scope,permissions:['mobile.access','loan.view','loan.approve']}})
    r.transitionLoan=vi.fn(async()=>({...snapshot,loans:[{...loan,status:'rejected' as const}],scope:{...snapshot.scope,permissions:['mobile.access','loan.view','loan.approve']}}))
    render(<App runtime={r}/>)
    fireEvent.click(await screen.findByRole('button',{name:'Empréstimos'}))
    fireEvent.click(await screen.findByRole('button',{name:'Recusar solicitação'}))
    fireEvent.change(screen.getByLabelText('Motivo da recusa'),{target:{value:'Veículo necessário no setor'}})
    fireEvent.click(screen.getByRole('button',{name:'Confirmar recusa'}))
    await waitFor(()=>expect(r.transitionLoan).toHaveBeenCalledWith('99','reject','Veículo necessário no setor'))
    expect(await screen.findByText('Recusado')).toBeVisible()
  })
})
