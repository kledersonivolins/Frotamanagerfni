import assert from 'node:assert/strict'
import test from 'node:test'
import { processarPasso, type ContextoPasso, type Empresa } from './conversa.ts'

const empresas: Empresa[] = [
  { id: 10, nome: 'Construtora Poty' },
  { id: 20, nome: 'Construtora BS' },
]

test('inicio sempre manda boas-vindas e pergunta o nome, ignorando a entrada', () => {
  const r = processarPasso('inicio', {}, 'oi', {})
  assert.equal(r.etapa, 'aguardando_nome')
  assert.deepEqual(r.dados, {})
  assert.match(r.respostas[0], /nome/i)
})

test('aguardando_nome com nome vazio repete a pergunta', () => {
  const r = processarPasso('aguardando_nome', {}, '   ', { empresas })
  assert.equal(r.etapa, 'aguardando_nome')
  assert.match(r.respostas[0], /não entendi/i)
})

test('aguardando_nome com nome válido guarda o nome e lista empresas', () => {
  const r = processarPasso('aguardando_nome', {}, 'Maria Silva', { empresas })
  assert.equal(r.etapa, 'aguardando_empresa')
  assert.equal(r.dados.nome, 'Maria Silva')
  assert.match(r.respostas[0], /1.*Construtora Poty/s)
  assert.match(r.respostas[0], /2.*Construtora BS/s)
})

test('aguardando_empresa com número válido avança para placa', () => {
  const r = processarPasso('aguardando_empresa', { nome: 'Maria' }, '2', { empresas })
  assert.equal(r.etapa, 'aguardando_placa')
  assert.equal(r.dados.empresaId, 20)
  assert.equal(r.dados.empresaNome, 'Construtora BS')
  assert.match(r.respostas[0], /placa/i)
})

test('aguardando_empresa aceita o nome da empresa por texto', () => {
  const r = processarPasso('aguardando_empresa', { nome: 'Maria' }, 'construtora poty', { empresas })
  assert.equal(r.dados.empresaId, 10)
})

test('aguardando_empresa com opção inválida repete a lista', () => {
  const r = processarPasso('aguardando_empresa', { nome: 'Maria' }, '9', { empresas })
  assert.equal(r.etapa, 'aguardando_empresa')
  assert.match(r.respostas[0], /não encontrei essa opção/i)
})
