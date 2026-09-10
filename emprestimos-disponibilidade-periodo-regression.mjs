import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
function fonte(nome){
  const inicio=html.indexOf(`function ${nome}(`);assert.notEqual(inicio,-1);const abre=html.indexOf('{',inicio);let n=0,q=null,e=false;
  for(let i=abre;i<html.length;i++){const c=html[i];if(e){e=false;continue;}if(q){if(c==='\\'){e=true;continue;}if(c===q)q=null;continue;}if(c==='"'||c==="'"||c==='`'){q=c;continue;}if(c==='{')n++;if(c==='}'&&--n===0)return html.slice(inicio,i+1);}
}
const registros=[{id:1,veiculo_id:7,status:'aprovado',data_saida:'2026-09-10',hora_saida:'08:00',data_prevista_retorno:'2026-09-10',hora_prevista_retorno:'12:00'}];
const ctx=vm.createContext({_empTodosRegistrosAtivos:()=>registros,Number,String});
vm.runInContext(fonte('_empIntervalo')+'\n'+fonte('_empConflitoDisponibilidade'),ctx);

assert.equal(ctx._empConflitoDisponibilidade(7,'2026-09-11','08:00','2026-09-11','12:00'),null,'veículo usado hoje deve poder ser reservado amanhã');
assert.equal(ctx._empConflitoDisponibilidade(7,'2026-09-10','12:00','2026-09-10','14:00'),null,'reserva pode começar quando a anterior termina');
assert.equal(ctx._empConflitoDisponibilidade(7,'2026-09-10','11:00','2026-09-10','13:00')?.id,1,'horários sobrepostos devem continuar bloqueados');

const ini=html.indexOf('function renderEmprestimosNovo('),fim=html.indexOf('function _empAtualizarDisponibilidade',ini),render=html.slice(ini,fim);
assert.doesNotMatch(render,/emUso\?'disabled'/,'veículo em uso agora não deve ficar indisponível para datas futuras');

console.log('PASS: disponibilidade libera outro dia ou horário sem permitir sobreposição.');
