import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const m = html.match(/function validarPlaca\(placa\)\{[\s\S]*?\n\}/);
assert.ok(m, 'validarPlaca não encontrada no index.html');
const validarPlaca = new Function(m[0] + ';return validarPlaca;')();

// Nomenclatura de equipamento (sem placa real) não pode ser barrada
for (const ok of ['S3', 'EMP-01', 'GER001', 'A1', 'ABC1234', 'OVW3E65', 'OVW3465', '', null]) {
  assert.equal(validarPlaca(ok), true, `deveria aceitar ${JSON.stringify(ok)}`);
}
// Caracteres estranhos continuam inválidos
for (const bad of ['X@1', 'S3!', 'A'.repeat(21)]) {
  assert.equal(validarPlaca(bad), false, `deveria recusar ${JSON.stringify(bad)}`);
}
console.log('placa-equipamento OK');
