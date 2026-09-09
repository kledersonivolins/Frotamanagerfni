import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');

function functionSource(name) {
  const functionStart = html.indexOf(`function ${name}(`);
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

const state = { authPassword: 'senha-antiga', legacyPassword: 'senha-antiga' };
const context = vm.createContext({
  currentUser: { id: 10, username: 'usuario', email: 'usuario@empresa.com', auth_user_id: 'auth-10' },
  _sbTenant: 'oficinafni',
  _sbMode: 'supabase',
  _sb: {
    auth: {
      async signInWithPassword({ email, password }) {
        return email === 'usuario@empresa.com' && password === state.authPassword
          ? { data: { user: { id: 'auth-10' } }, error: null }
          : { data: null, error: { message: 'Invalid login credentials' } };
      },
      async updateUser({ password }) {
        state.authPassword = password;
        return { data: { user: { id: 'auth-10' } }, error: null };
      }
    },
    async rpc(name, params) {
      if (name !== 'fm_alterar_minha_senha') return { data: null, error: { message: 'RPC incorreta' } };
      if (params.p_senha_atual !== state.legacyPassword) return { data: false, error: null };
      state.legacyPassword = params.p_nova_senha;
      return { data: true, error: null };
    }
  }
});

for (const name of ['_validarTrocaSenha', '_trocarSenhaLogado']) {
  vm.runInContext(functionSource(name), context);
}

assert.equal(context._validarTrocaSenha('', 'abcdef', 'abcdef'), 'Informe sua senha atual.');
assert.equal(context._validarTrocaSenha('antiga', '12345', '12345'), 'A nova senha deve ter no mínimo 6 caracteres.');
assert.equal(context._validarTrocaSenha('antiga', 'abcdef', 'abcdeg'), 'A confirmação da nova senha não confere.');
assert.equal(context._validarTrocaSenha('abcdef', 'abcdef', 'abcdef'), 'A nova senha deve ser diferente da senha atual.');
assert.equal(context._validarTrocaSenha('antiga', 'abcdef', 'abcdef'), '');

let result = await context._trocarSenhaLogado('senha-errada', 'senha-nova');
assert.equal(result.ok, false, 'senha atual incorreta deve impedir a alteração');
assert.equal(state.authPassword, 'senha-antiga');
assert.equal(state.legacyPassword, 'senha-antiga');

result = await context._trocarSenhaLogado('senha-antiga', 'senha-nova');
assert.equal(result.ok, true);
assert.equal(state.authPassword, 'senha-nova', 'senha do Supabase Auth deve ser alterada');
assert.equal(state.legacyPassword, 'senha-nova', 'acesso legado deve acompanhar a nova senha');

context.currentUser = { id: 20, username: 'legado', email: null, auth_user_id: null };
state.legacyPassword = 'legado-antiga';
result = await context._trocarSenhaLogado('legado-antiga', 'legado-nova');
assert.equal(result.ok, true, 'usuário legado logado também deve trocar a própria senha');
assert.equal(state.legacyPassword, 'legado-nova');

console.log('PASS: usuário logado altera somente a própria senha com validação e sincronização.');
