import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import {describe, expect, it} from 'vitest'
import {App} from './App'
import type {MobileRuntime, MobileSnapshot} from './runtime'

const snapshot: MobileSnapshot = {
  scope: {tenant:'oficinafni',userId:'u1',companyIds:['1'],sectorIds:['2'],vehicleIds:['10'],driverIds:['20'],permissions:['mobile.access','loan.view','loan.request','work_order.view'],validatedAt:'2026-09-14T10:00:00Z',expiresAt:'2026-09-21T10:00:00Z'},
  vehicles:[{id:'10',label:'ABC1D23 — Strada'}], drivers:[{id:'20',label:'Maria'}],
  loans:[], orders:[{id:'30',equipmentId:'10',status:'open',description:'Trocar óleo',steps:[]}],
}

function runtime(): MobileRuntime {
  return {restore:async()=>null,login:async()=>snapshot,logout:async()=>undefined,refresh:async()=>snapshot,requestLoan:async()=>undefined}
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
})
