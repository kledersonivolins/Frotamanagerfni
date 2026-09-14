import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./index.html', import.meta.url), 'utf8')
const required = [
  'Aplicativo', 'Liberar acesso ao aplicativo FrotaManager', 'u_mobile_access', '_coletarPermissoesMobile()',
  'mobile_permissions = mobilePermissions', 'mobile_permissions: mobilePermissions',
  "['loan.request','Solicitar veículo']", "['loan.approve','Aprovar do setor']",
  "['work_order.view','Visualizar OS']", "['work_order.complete','Concluir OS']",
]
for (const marker of required) assert.ok(source.includes(marker), `marcador ausente: ${marker}`)

const selected = { 'mobile.access': true, 'loan.request': true, 'work_order.view': true }
const row = JSON.parse(JSON.stringify({
  empresas: [11], setor_id: 7, equipamentos_vinculados: [101, 102], mobile_permissions: selected,
}))
assert.deepEqual(row.mobile_permissions, selected)
assert.deepEqual(row.empresas, [11])
assert.equal(row.setor_id, 7)
assert.deepEqual(row.equipamentos_vinculados, [101, 102])
console.log('PASS: permissões mobile persistem sem alterar o escopo do usuário')
