import {describe,expect,it} from 'vitest'
import {resolveScopedIds} from './runtime'

describe('escopo móvel',()=>{
  it('trata lista de veículos vazia como acesso a todos, conforme o cadastro do site',()=>{
    expect(resolveScopedIds([])).toBeNull()
    expect(resolveScopedIds(['1777032444116'])).toEqual([1777032444116])
  })
})
