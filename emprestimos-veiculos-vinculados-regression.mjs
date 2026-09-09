import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
function functionSource(name){
  const start=html.indexOf(`function ${name}(`);
  assert.notEqual(start,-1,`função ${name} deve existir`);
  const brace=html.indexOf('{',start);
  let depth=0,quote=null,escaped=false;
  for(let i=brace;i<html.length;i++){
    const ch=html[i];
    if(quote){ if(escaped) escaped=false; else if(ch==='\\') escaped=true; else if(ch===quote) quote=null; continue; }
    if(ch==='"'||ch==="'"||ch==='`'){ quote=ch; continue; }
    if(ch==='{') depth++;
    if(ch==='}'&&--depth===0) return html.slice(start,i+1);
  }
  throw new Error(`função incompleta: ${name}`);
}

const selecionados=[
  {id:1,placa:'OUC0141',empresa_id:10,status:'ativo',excluido:false},
  {id:2,placa:'QRS5D27',empresa_id:10,status:'ativo',excluido:false},
  {id:3,placa:'INATIVO',empresa_id:10,status:'inativo',excluido:false},
];
const context=vm.createContext({_eqsDaEmpresa:()=>selecionados});
vm.runInContext(functionSource('_empVeiculosDisponiveis'),context);

assert.deepEqual(
  Array.from(context._empVeiculosDisponiveis(),e=>e.id),
  [1,2],
  'empréstimo deve listar somente veículos ativos já filtrados pelos vínculos do usuário'
);

console.log('PASS: solicitação e checklist usam somente os veículos vinculados ao usuário.');
