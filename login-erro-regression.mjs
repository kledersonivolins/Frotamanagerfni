import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
const inicio=html.indexOf('async function fmLoginSupabase(');
const fim=html.indexOf('// ── SOLICITAR ACESSO',inicio);
assert.ok(inicio>=0&&fim>inicio,'fluxo de login deve existir');
const fonte=html.slice(inicio,fim);

assert.doesNotMatch(fonte,/\bmostrarErro\s*\(/,'login não pode chamar função local inexistente');
assert.match(fonte,/showToast\s*\(/,'login deve usar o aviso global');

console.log('PASS: falhas do login usam o aviso global sem ReferenceError.');
