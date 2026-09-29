import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizarPlaca, placasCorrespondem } from './placa.ts'

test('normaliza placa com hífen para maiúsculo sem separador', () => {
  assert.equal(normalizarPlaca('aaa-0000'), 'AAA0000')
})

test('normaliza placa já junta e maiúscula sem alterar', () => {
  assert.equal(normalizarPlaca('AAA0000'), 'AAA0000')
})

test('remove espaços internos e nas pontas', () => {
  assert.equal(normalizarPlaca('  aaa 0000  '), 'AAA0000')
})

test('placa Mercosul também normaliza', () => {
  assert.equal(normalizarPlaca('abc-1d23'), 'ABC1D23')
})

test('string vazia normaliza para string vazia', () => {
  assert.equal(normalizarPlaca(''), '')
})

test('placasCorrespondem ignora formatação diferente', () => {
  assert.equal(placasCorrespondem('AAA-0000', 'aaa0000'), true)
})

test('placasCorrespondem detecta placas diferentes', () => {
  assert.equal(placasCorrespondem('AAA-0000', 'AAA0001'), false)
})

test('placasCorrespondem nunca casa placas vazias', () => {
  assert.equal(placasCorrespondem('', ''), false)
  assert.equal(placasCorrespondem('', 'AAA0000'), false)
})
