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

// Supabase simulado
function fakeSb({ existentes = [], erroSignUp = null, semRpc = false } = {}) {
  const ev = { inserts: [], signUps: [], signOuts: 0, updates: [], rpcs: [], selectsUsuarios: 0 };
  const sb = {
    rpc: async (nome, args) => {
      ev.rpcs.push([nome, args]);
      if (semRpc) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
      if (nome === 'fm_cadastro_conflito') {
        const e = existentes[0];
        return { data: !e ? null : (String(e.email).toLowerCase() === args.p_email ? 'email' : 'username'), error: null };
      }
      return { data: null, error: null };
    },
    auth: {
      signUp: async (a) => { ev.signUps.push(a); return erroSignUp ? { error: { message: erroSignUp } } : { data: { user: { id: 'uuid-novo' }, session: { x: 1 } }, error: null }; },
      signOut: async () => { ev.signOuts++; },
      signInWithPassword: async () => ({ error: null }),
    },
    from: (tab) => {
      const q = { _filtros: [],
        select() { if (tab === 'usuarios') ev.selectsUsuarios++; return q; }, eq() { return q; }, or() { return q; }, limit() { return Promise.resolve({ data: existentes, error: null }); },
        insert(rows) { ev.inserts.push([tab, rows]); return Promise.resolve({ error: null }); },
        update(v) { ev.updates.push([tab, v]); return q; } };
      return q;
    },
  };
  return { sb, ev };
}
function montar(campos, opts) {
  const { sb, ev } = fakeSb(opts);
  const els = {};
  for (const [k, v] of Object.entries(campos)) els[k] = { value: v };
  els.sol_erro = { textContent: '', style: { display: 'none' } };
  els.ovSolicitarAcesso = { style: { display: 'flex' } };
  const document = { getElementById: (id) => els[id] || null, querySelector: () => null };
  const toasts = [];
  const fn = new Function('_sb', '_sbMode', '_sbTenant', 'document', 'showToastLogin',
    `${extrair('_fmRpcAusente')}\n${extrair('fecharSolicitarAcesso')}\n${extrair('enviarSolicitacaoAcesso')}\nreturn enviarSolicitacaoAcesso;`
  )(sb, 'supabase', 'oficinafni', document, (m) => toasts.push(m));
  return { fn, ev, els, toasts };
}

// cadastro: cria a conta no Supabase Auth e grava o perfil pendente, SEM senha na tabela
let t = montar({ sol_nome: 'João Silva', sol_email: 'Joao@Ferronorte.com.br', sol_username: '', sol_senha: 'segredo1', sol_senha2: 'segredo1' });
await t.fn();
assert.equal(t.ev.signUps.length, 1);
assert.equal(t.ev.signUps[0].email, 'joao@ferronorte.com.br');
assert.equal(t.ev.signOuts, 1, 'perfil deve ser gravado sem a sessão do recém-cadastrado');
const [tab, [perfil]] = t.ev.inserts[0];
assert.equal(tab, 'usuarios');
assert.equal(perfil.password, undefined, 'senha NÃO pode ir para a tabela de usuários');
assert.equal(perfil.auth_user_id, 'uuid-novo');
assert.equal(perfil.username, 'joao', 'usuário vazio usa o início do e-mail');
assert.equal(perfil.tenant, 'oficinafni');
assert.equal(perfil.ativo, false);
assert.equal(perfil.pendente_aprovacao, true);
assert.equal(perfil.nivel, 'operador');
assert.match(t.toasts[0], /administrador liberar/);

// validações
for (const [campos, msg] of [
  [{ sol_nome: '', sol_email: 'a@b.com', sol_username: '', sol_senha: '123456', sol_senha2: '123456' }, /nome completo/],
  [{ sol_nome: 'A', sol_email: 'sem-arroba', sol_username: '', sol_senha: '123456', sol_senha2: '123456' }, /e-mail válido/],
  [{ sol_nome: 'A', sol_email: 'a@b.com', sol_username: 'abc', sol_senha: '123', sol_senha2: '123' }, /6 caracteres/],
  [{ sol_nome: 'A', sol_email: 'a@b.com', sol_username: 'abc', sol_senha: '123456', sol_senha2: '654321' }, /não coincidem/],
]) {
  const x = montar(campos); await x.fn();
  assert.match(x.els.sol_erro.textContent, msg); assert.equal(x.ev.signUps.length, 0);
}
// e-mail já usado neste ambiente
t = montar({ sol_nome: 'A', sol_email: 'ana@b.com', sol_username: '', sol_senha: '123456', sol_senha2: '123456' }, { existentes: [{ id: 9, username: 'outro', email: 'ana@b.com' }] });
await t.fn();
assert.match(t.els.sol_erro.textContent, /e-mail/); assert.equal(t.ev.signUps.length, 0);
assert.equal(t.ev.rpcs[0][0], 'fm_cadastro_conflito', 'checagem de duplicidade usa a função segura');
assert.equal(t.ev.selectsUsuarios, 0, 'cadastro não lê a tabela usuarios sem login');
// banco ainda sem a função: cai na consulta antiga e continua funcionando
t = montar({ sol_nome: 'A', sol_email: 'ana@b.com', sol_username: '', sol_senha: '123456', sol_senha2: '123456' }, { existentes: [{ id: 9, username: 'outro', email: 'ana@b.com' }], semRpc: true });
await t.fn();
assert.match(t.els.sol_erro.textContent, /e-mail/); assert.equal(t.ev.selectsUsuarios, 1);

// login: pendente e desativado têm mensagem própria (antes caía em "usuário ou senha inválidos")
const login = extrair('fmLoginSupabase');
assert.ok(!/\.eq\('ativo',true\)\.limit\(1\)/.test(login), 'login não pode filtrar só ativos antes de checar pendente');
assert.match(login, /aguardando a libera[cç][aã]o de um administrador/);
assert.match(login, /Acesso desativado/);
assert.match(login, /_sb\.rpc\('fm_login_info'/, 'login procura o usuário pela função segura');
const rpcAusente = new Function(extrair('_fmRpcAusente') + ';return _fmRpcAusente;')();
assert.equal(rpcAusente({ code: 'PGRST202' }), true);
assert.equal(rpcAusente({ code: '42501', message: 'permission denied' }), false);
// SQL que fecha a tabela usuarios
const sqlFecha = fs.readFileSync(new URL('./supabase/migrations/20261125120000_usuarios_fechar_acesso_publico.sql', import.meta.url), 'utf8');
for (const pol of ['login_direto', 'usr_select_pub', 'fm_usuarios_app_update']) assert.match(sqlFecha, new RegExp(`drop policy if exists ${pol} on public\\.usuarios`));
assert.match(sqlFecha, /function public\.fm_login_info/);
assert.match(sqlFecha, /function public\.fm_cadastro_conflito/);
assert.match(sqlFecha, /new\.nivel\s+:= old\.nivel/);
assert.ok(!/password/.test(sqlFecha.split('create or replace function public.fm_login_info')[1].split('$$;')[0]), 'fm_login_info não devolve senha');

// aprovação por qualquer administrador, abrindo o cadastro; rejeitar/excluir são lógicos
const aprovar = extrair('aprovarUsuario');
assert.match(aprovar, /\['admin','super'\]\.includes/);
assert.match(aprovar, /openModalUsuario\(i\)/);
assert.match(extrair('salvarUsuario'), /_fmAprovandoId[\s\S]*pendente_aprovacao = false/);
assert.ok(!/from\('usuarios'\)\.delete\(\)/.test(extrair('rejeitarUsuario') + extrair('delUsuario')), 'usuários não podem ser apagados (exclusão lógica)');
// SQL de proteção do cadastro público existe
assert.ok(fs.readFileSync(new URL('./supabase/migrations/20261123150000_usuarios_cadastro_publico.sql', import.meta.url), 'utf8').includes("new.nivel := 'operador'"));
console.log('multiusuario OK');
