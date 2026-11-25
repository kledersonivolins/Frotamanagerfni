import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
function extrair(nome) {
  const ini = html.search(new RegExp(`(^|\\n)(async )?function ${nome}\\(`));
  assert.ok(ini >= 0, `função ${nome} não encontrada`);
  const abre = html.indexOf('{', html.indexOf(')', ini));
  let n = 0;
  for (let i = abre; i < html.length; i++) { if (html[i] === '{') n++; else if (html[i] === '}' && --n === 0) return html.slice(ini, i + 1).trim(); }
}

const lista = html.match(/const FM_LINKS_PUBLICOS = (\[[\s\S]*?\]);/);
assert.ok(lista, 'lista de links públicos');
const solicitado = new Function(`const FM_LINKS_PUBLICOS = ${lista[1]};\n${extrair('_fmLinkPublicoSolicitado')}\nreturn _fmLinkPublicoSolicitado;`)();

// todos os links sem login ficam desativados
for (const q of ['?tvos=1&t=oficinafni', '?tv=1', '?motorista=1', '?frentista=1&tenant=x', '?painel_geral=1', '?rastreio=1',
  '?agendamento=1', '?ck=5&token=a', '?checklist_emp=1&placa=X', '?painel=1&token=a', '?os_mecanico=1&token=a',
  '?portaria=1', '?os=1', '?chamado=TOKEN']) {
  assert.ok(solicitado(q), `deveria bloquear ${q}`);
}
// o sistema normal continua
for (const q of ['', '?reset=1', '?empresa=1775904419008']) assert.equal(solicitado(q), null, `não pode bloquear ${JSON.stringify(q)}`);

// o bloqueio vem antes de qualquer conexão do modo TV / login, e o roteador de links respeita
const auto = html.slice(html.indexOf('(function sbAutoInit(){'), html.indexOf('(function sbAutoInit(){') + 600);
assert.ok(auto.indexOf('_fmLinkPublicoSolicitado') < auto.indexOf("get('tvos')"), 'bloqueio antes do modo TV');
assert.match(extrair('chamadoInicializar'), /^async function chamadoInicializar\(\)\{\s*if\(window\._fmLinkBloqueado\) return;/);

// SQL que fecha o acesso anon
const sql = fs.readFileSync(new URL('./supabase/migrations/20261125160000_fechar_acesso_anon.sql', import.meta.url), 'utf8');
assert.match(sql, /roles && array\['anon','public'\]::name\[\]/);
assert.match(sql, /r\.policyname = 'fm_usuarios_app_insert' then\s+continue;/, 'cadastro "Solicitar acesso" continua');
assert.match(sql, /revoke execute on function %s from public, anon/);
console.log('links-publicos OK');
