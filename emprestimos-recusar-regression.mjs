import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');

function functionSource(name){
  const start=html.indexOf(`async function ${name}(`);
  assert.notEqual(start,-1,`função ${name} deve existir`);
  const brace=html.indexOf('{',start);let depth=0,quote=null,escaped=false;
  for(let i=brace;i<html.length;i++){
    const ch=html[i];
    if(quote){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch===quote)quote=null;continue;}
    if(ch==='"'||ch==="'"||ch==='`'){quote=ch;continue;}
    if(ch==='{')depth++;
    if(ch==='}'&&--depth===0)return html.slice(start,i+1);
  }
  throw new Error(`função incompleta: ${name}`);
}

const loan={id:55,status:'solicitado',veiculo_placa:'ABC1D23'};
let saved=null;
const context=vm.createContext({
  db:{emprestimos_veiculos:[loan]},currentUser:{id:7,nome:'Coordenador Teste'},
  _empPodeAprovar:()=>true,_empFuncaoUsuario:()=> 'coordenador',
  sbSalvar:async(table,row)=>{saved={table,row:{...row}};return true;},
  loadPage:()=>{},showToast:()=>{},closeModal:()=>{}
});
vm.runInContext(functionSource('_empConfirmarRecusa'),context);
await context._empConfirmarRecusa(0,'Veículo necessário no setor');
assert.equal(saved.table,'emprestimos_veiculos');
assert.equal(saved.row.status,'recusado');
assert.equal(saved.row.autorizacao_observacao,'Veículo necessário no setor');
assert.equal(saved.row.autorizador_nome,'Coordenador Teste');
assert.equal(saved.row.autorizador_cargo,'coordenador');
assert.ok(saved.row.autorizacao_em,'a decisão deve registrar data e hora');

saved=null;loan.status='solicitado';
await context._empConfirmarRecusa(0,'   ');
assert.equal(saved,null,'motivo vazio não pode ser salvo');

console.log('PASS: coordenador recusa com motivo obrigatório e decisão auditável.');
