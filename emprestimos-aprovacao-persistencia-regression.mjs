import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
const inicio=html.indexOf('async function _empAprovar(');
const fim=html.indexOf('// ── CANCELAR',inicio);
assert.ok(inicio>=0&&fim>inicio,'função de aprovação deve existir');
const fonte=html.slice(inicio,fim);

assert.match(fonte,/const salvou\s*=\s*await sbSalvar/,'aprovação deve verificar o resultado do banco');
assert.match(fonte,/if\s*\(!salvou\)/,'aprovação deve interromper e restaurar o estado quando não persistir');
assert.match(fonte,/e\.status\s*=\s*statusAnterior/,'status local deve voltar ao anterior após falha');
assert.match(fonte,/e\.autorizacao_tipo\s*=\s*'sistema'/,'aprovação deve informar sua origem ao gatilho do banco');
assert.match(fonte,/e\.autorizador_usuario_id\s*=\s*currentUser/,'aprovação deve registrar o usuário autenticado');
assert.match(fonte,/e\.autorizacao_em\s*=\s*new Date\(\)\.toISOString\(\)/,'aprovação deve registrar data e hora');

console.log('PASS: aprovação só é confirmada depois de persistir no Supabase.');
