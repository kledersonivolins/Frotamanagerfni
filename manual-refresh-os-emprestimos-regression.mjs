import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');

function functionSource(name) {
  const start=html.indexOf(`function ${name}(`);
  assert.notEqual(start,-1,`função ${name} deve existir`);
  const brace=html.indexOf('{',start);
  let depth=0,quote=null,escaped=false;
  for(let i=brace;i<html.length;i++){
    const ch=html[i];
    if(quote){ if(escaped) escaped=false; else if(ch==='\\') escaped=true; else if(ch===quote) quote=null; continue; }
    if(ch==='"'||ch==="'"||ch==='`'){quote=ch;continue;}
    if(ch==='{') depth++;
    if(ch==='}'&&--depth===0) return html.slice(start,i+1);
  }
  throw new Error(`função incompleta: ${name}`);
}

let intervalos=0;
const contexto=vm.createContext({
  _autoRefreshTimer:123,
  clearInterval:()=>{},
  setInterval:()=>{intervalos++;return 456;},
  document:{addEventListener:()=>{}},
  window:{},
  _autoRefreshChamados:async()=>{}
  ,_pararAutoRefresh:()=>{}
});
vm.runInContext(functionSource('_iniciarAutoRefresh'),contexto);
contexto._iniciarAutoRefresh();
assert.equal(intervalos,0,'o sistema não pode iniciar nenhum temporizador de atualização automática');

assert.match(
  html,
  /const _TABELAS_ATUALIZACAO_MANUAL\s*=\s*new Set\(\['ordens_servico','emprestimos_veiculos'\]\)/,
  'OS e empréstimos devem ser marcados como módulos de atualização somente manual'
);

assert.match(
  html,
  /function _realtimeProcessar\(payload\)\s*{[\s\S]*?if\(_TABELAS_ATUALIZACAO_MANUAL\.has\(table\)\) return;/,
  'eventos Realtime não podem alterar OS ou empréstimos automaticamente'
);

const paginasLive = html.match(/const _PAGINAS_LIVE\s*=\s*\[([^\]]*)\]/)?.[1] ?? '';
assert.ok(!paginasLive.includes("'os'"), 'a tela de OS não pode ser renderizada pelo temporizador automático');

const tabelasRefresh = html.match(/const tabelasRefresh\s*=\s*\[([^\]]*)\]/)?.[1] ?? '';
assert.ok(!tabelasRefresh.includes("'ordens_servico'"), 'o temporizador não pode buscar ordens_servico');
assert.ok(!tabelasRefresh.includes("'emprestimos_veiculos'"), 'o temporizador não pode buscar emprestimos_veiculos');

assert.doesNotMatch(
  html,
  /if\(enviados\)\{[\s\S]{0,300}?await sbCarregarTudo\(\)/,
  'a sincronização automática de pendências não pode recarregar toda a memória do sistema'
);

assert.doesNotMatch(
  html,
  /async function _reconectarSupabase\(\)[\s\S]{0,1200}?await sbCarregarTudo\(\)/,
  'a reconexão automática não pode recarregar OS e empréstimos silenciosamente'
);

console.log('OK: OS e empréstimos permanecem fixos até atualização manual.');
