import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('./supabase/migrations/20260915123421_mobile_loan_release_handoff.sql',import.meta.url),'utf8');

assert.match(html,/function _empPodeOperar\(\)\s*{\s*return _empFuncaoUsuario\(\)==='administrador';\s*}/,'somente a Frota administradora registra a saída no site');
assert.match(html,/Aguardando liberação[\s\S]{0,180}?aguardandoLiberacao/,'site deve destacar a fila aprovada aguardando a Frota');
assert.match(html,/e\.status==='aprovado'&&_empPodeOperar\(\)[\s\S]{0,250}?_empIniciarUso/,'site deve oferecer saída para uma solicitação aprovada');
assert.match(migration,/if p\.nivel not in \('super','admin'\)/,'servidor deve reservar a saída para a Frota');
assert.match(migration,/update public\.emprestimos_veiculos set status='em_uso'/,'liberação móvel deve usar o mesmo estado de saída do site');

console.log('PASS: solicitado -> aprovado pelo setor -> saída liberada pela Frota em todas as plataformas.');
