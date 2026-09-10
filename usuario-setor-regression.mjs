import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');

assert.match(html,/id="u_setor"/, 'cadastro de usuário deve exibir o campo Setor');
assert.match(html,/db\.usuarios\[idx\]\.setor_id\s*=\s*parseInt\(document\.getElementById\('u_setor'\)/, 'edição deve salvar setor_id');
assert.match(html,/setor_id:\s*parseInt\(document\.getElementById\('u_setor'\)/, 'novo usuário deve salvar setor_id');

console.log('PASS: cadastro de usuário exibe e persiste o setor selecionado.');
