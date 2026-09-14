import { render,screen } from '@testing-library/react'
import { expect,it } from 'vitest'
import { WorkOrderDetail } from './WorkOrderDetail'
it('mostra progresso real e apenas ações permitidas',()=>{render(<WorkOrderDetail order={{id:'1',equipmentId:'e1',status:'open',description:'Trocar óleo',steps:[{id:'1',title:'A',required:true,completed:true},{id:'2',title:'B',required:true,completed:false}]}} permissions={['work_order.execute']}/>);expect(screen.getByText('50%')).toBeVisible();expect(screen.getByRole('button',{name:'Iniciar'})).toBeVisible();expect(screen.queryByRole('button',{name:'Cancelar'})).not.toBeInTheDocument()})
