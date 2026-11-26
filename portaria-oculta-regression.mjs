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
assert.match(html, /const FM_PORTARIA_OCULTA = true;/);
// menu: a seção Portaria está comentada
const menu = html.slice(html.indexOf('const MENU = ['), html.indexOf('const MENU = [') + 3000);
assert.match(menu, /\/\* \{ section:'Portaria'/);
assert.ok(!/^\s*\{ section:'Portaria'/m.test(menu));
// permissões e grupos de módulos não listam mais a portaria
assert.ok(!/\["portaria_op",/.test(html), 'lista de permissões');
assert.ok(!/^\s*\{ titulo: 'Portaria'/m.test(html), 'grupo de módulos');

// bloqueio vale até para super e para quem tem a portaria liberada
const fn = (u) => new Function('currentUser', `const FM_PORTARIA_OCULTA = true;
  const _empPaginaPermitida = () => true; const _getModulosLiberados = () => null;
  ${extrair('_fmPaginaOculta')}\n${extrair('_moduloLiberado')}\n${extrair('_moduloPermissao')}
  return { _moduloLiberado, _moduloPermissao };`)(u);
for (const nivel of ['super', 'admin', 'portaria']) {
  const t = fn({ nivel });
  for (const pg of ['portaria_op', 'portaria_relatorios', 'portaria_qrcodes']) {
    assert.equal(t._moduloLiberado(pg), false, `${nivel} não abre ${pg}`);
    assert.equal(t._moduloPermissao(pg), null);
  }
  if (nivel !== 'portaria') assert.equal(t._moduloLiberado('os'), true, 'outros módulos seguem normais');
}
// sem laço infinito: usuário portaria barrado não é redirecionado para a própria portaria oculta
assert.match(extrair('loadPage'), /currentUser\?\.nivel === 'portaria' && pg !== 'portaria_op' && !_fmPaginaOculta\('portaria_op'\)/);
console.log('portaria-oculta OK');
