import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
assert.match(html,/page:'emprestimos_agenda'/,'menu deve oferecer Agenda de Veículos');
assert.match(html,/emprestimos_agenda:\s*renderEmprestimosAgenda/,'agenda deve estar registrada como página');

function fonteFuncao(nome){
  const inicio=html.indexOf(`function ${nome}(`); assert.notEqual(inicio,-1,`função ${nome} deve existir`);
  const abre=html.indexOf('{',inicio); let nivel=0,aspas=null,escape=false;
  for(let i=abre;i<html.length;i++){
    const c=html[i]; if(escape){escape=false;continue;} if(aspas){if(c==='\\'){escape=true;continue;}if(c===aspas)aspas=null;continue;} if(c==='"'||c==="'"||c==='`'){aspas=c;continue;} if(c==='{')nivel++; if(c==='}'&&--nivel===0)return html.slice(inicio,i+1);
  }
}
const ctx=vm.createContext({_empRegistrosAtivos:()=>[
  {id:1,status:'aprovado',data_saida:'2026-09-10',data_prevista_retorno:'2026-09-12'},
  {id:2,status:'solicitado',data_saida:'2026-09-15',data_prevista_retorno:'2026-09-15'}
]});
vm.runInContext(fonteFuncao('_empAgendaRegistrosDia'),ctx);
assert.deepEqual(ctx._empAgendaRegistrosDia('2026-09-11').map(x=>x.id),[1],'reserva de vários dias deve aparecer nos dias intermediários');
assert.deepEqual(ctx._empAgendaRegistrosDia('2026-09-14').map(x=>x.id),[],'dia livre não deve mostrar reserva');

console.log('PASS: agenda de empréstimos existe e distribui reservas pelos dias corretos.');

const ctxPerm=vm.createContext({currentUser:{nivel:'operador',funcao_emprestimo:'coordenador',modulos_liberados:{emprestimos_lista:'editar',emprestimos_novo:'editar'}}});
vm.runInContext([
  fonteFuncao('_empFuncaoUsuario'),fonteFuncao('_empPaginaPermitida'),fonteFuncao('_getModulosLiberados'),
  fonteFuncao('_moduloLiberado'),fonteFuncao('_moduloPermissao')
].join('\n'),ctxPerm);
assert.equal(ctxPerm._moduloLiberado('emprestimos_agenda'),true,'usuários antigos com acesso às solicitações devem enxergar a agenda');
assert.equal(ctxPerm._moduloPermissao('emprestimos_agenda'),'editar','agenda deve herdar a permissão das solicitações');
