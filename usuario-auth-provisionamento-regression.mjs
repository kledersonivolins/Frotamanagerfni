import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');

function functionSource(name) {
  const marker = `function ${name}(`;
  const functionStart = html.indexOf(marker);
  assert.notEqual(functionStart, -1, `função ${name} deve existir`);
  const start = html.slice(Math.max(0, functionStart - 6), functionStart) === 'async '
    ? functionStart - 6 : functionStart;
  const brace = html.indexOf('{', start);
  let depth = 0, quote = null, escaped = false, templateDepth = 0;
  for (let i = brace; i < html.length; i += 1) {
    const ch = html[i], next = html[i + 1];
    if (escaped) { escaped = false; continue; }
    if (quote) {
      if (ch === '\\') { escaped = true; continue; }
      if (quote === '`' && ch === '$' && next === '{') { templateDepth += 1; i += 1; continue; }
      if (quote === '`' && templateDepth > 0) {
        if (ch === '{') templateDepth += 1;
        if (ch === '}') templateDepth -= 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '/' && next === '/') { i = html.indexOf('\n', i); continue; }
    if (ch === '/' && next === '*') { i = html.indexOf('*/', i + 2) + 1; continue; }
    if (ch === '{') depth += 1;
    if (ch === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`fim da função ${name} não encontrado`);
}

const chamadas = [];
const atualizacoes = [];
const context = vm.createContext({
  _sbTenant: 'oficinafni',
  _sb: {
    functions: {
      async invoke(name, options) {
        chamadas.push({ name, options });
        return { data: { auth_user_id: 'auth-josiel' }, error: null };
      }
    },
    from(table) {
      assert.equal(table, 'usuarios');
      return {
        update(values) {
          return {
            async eq(column, value) {
              atualizacoes.push({ values, column, value });
              return { error: null };
            }
          };
        }
      };
    }
  }
});

vm.runInContext(functionSource('_provisionarUsuarioAuth'), context);

const usuario = { id: 12, email: 'josiel@ferronorte.com.br', auth_user_id: null };
let resultado = await context._provisionarUsuarioAuth(usuario, 'senha-segura');
assert.equal(resultado.ok, true);
assert.equal(resultado.authUserId, 'auth-josiel');
assert.equal(usuario.auth_user_id, 'auth-josiel', 'perfil em memória deve ficar vinculado imediatamente');
assert.deepEqual(JSON.parse(JSON.stringify(chamadas)), [{
  name: 'fm-user-admin',
  options: { body: { action: 'provision', profile_id: 12, email: 'josiel@ferronorte.com.br', password: 'senha-segura' } }
}]);
assert.deepEqual(JSON.parse(JSON.stringify(atualizacoes)), [{ values: { auth_user_id: 'auth-josiel' }, column: 'id', value: 12 }]);

resultado = await context._provisionarUsuarioAuth(usuario, '');
assert.equal(resultado.ok, true);
assert.equal(chamadas.length, 1, 'conta já vinculada não pode ser criada novamente');

const semEmail = await context._provisionarUsuarioAuth({ id: 13, email: '', auth_user_id: null }, 'abcdef');
assert.equal(semEmail.ok, false);
assert.match(semEmail.error, /e-mail/i, 'novo padrão deve impedir usuário sem e-mail de ficar sem Auth');

console.log('PASS: cadastro de usuário sempre provisiona e vincula uma conta Supabase Auth.');
