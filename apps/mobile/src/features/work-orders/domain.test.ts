import { describe, expect, it } from 'vitest'
import { calculateProgress, canTransitionWorkOrder, validateCompletion } from './domain'

describe('work order domain',()=>{
  it('calcula progresso apenas pelas etapas obrigatórias persistidas',()=>{
    expect(calculateProgress([{id:'1',title:'A',required:true,completed:true},{id:'2',title:'B',required:true,completed:false},{id:'3',title:'C',required:false,completed:false}])).toBe(50)
  })
  it('bloqueia conclusão sem equipamento e etapas obrigatórias',()=>{
    expect(validateCompletion({equipmentId:null,steps:[{id:'1',title:'A',required:true,completed:false}]})).toEqual(['EQUIPMENT_REQUIRED','REQUIRED_STEPS_INCOMPLETE'])
  })
  it('exige permissão para executar',()=>{
    expect(canTransitionWorkOrder('open','in_progress',['work_order.view'])).toBe(false)
    expect(canTransitionWorkOrder('open','in_progress',['work_order.execute'])).toBe(true)
  })
})
