import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');

function functionSource(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `função ${name} deve existir`);
  const brace = html.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let templateDepth = 0;
  let escaped = false;
  for (let i = brace; i < html.length; i += 1) {
    const ch = html[i];
    const next = html[i + 1];
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
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error(`fim da função ${name} não encontrado`);
}

const context = vm.createContext({ currentUser: null, db: { emprestimos_veiculos: [] } });
for (const name of ['_empFuncaoUsuario', '_empPodeAprovar', '_empPodeOperar', '_empPodeEditar', '_empStatusNovaSolicitacao', '_empPaginaPermitida', '_empRegistroAtivo', '_empTodosRegistrosAtivos', '_empVeiculoEmUso']) {
  vm.runInContext(functionSource(name), context);
}

function asUser(user, callback) {
  context.currentUser = user;
  return callback();
}

asUser({ id: 10, nivel: 'operador', funcao_emprestimo: 'solicitante' }, () => {
  assert.equal(context._empFuncaoUsuario(), 'solicitante');
  assert.equal(context._empPodeAprovar(), false, 'solicitante não aprova');
  assert.equal(context._empPodeOperar(), false, 'solicitante não registra saída/devolução');
  assert.equal(context._empPodeEditar({ solicitante_usuario_id: 10 }), false, 'solicitante não altera solicitação enviada');
  assert.equal(context._empStatusNovaSolicitacao('aprovado'), 'solicitado', 'solicitante sempre cria como solicitado');
  assert.equal(context._empPaginaPermitida('emprestimos_novo'), true);
  assert.equal(context._empPaginaPermitida('emprestimos_lista'), true);
  assert.equal(context._empPaginaPermitida('emprestimos_checklist'), false, 'solicitante não recebe a operação de checklist interno');
  context.db.emprestimos_veiculos = [{ id: 99, veiculo_id: 7, status: 'em_uso', ativo: true, solicitante_usuario_id: 999 }];
  assert.equal(context._empVeiculoEmUso(7), true, 'disponibilidade considera empréstimos de outros solicitantes');
});

asUser({ id: 20, nivel: 'operador', funcao_emprestimo: 'coordenador' }, () => {
  assert.equal(context._empPodeAprovar(), true, 'coordenador pode aprovar');
  assert.equal(context._empPodeOperar(), true, 'coordenador pode registrar o fluxo do veículo');
  assert.equal(context._empStatusNovaSolicitacao('aprovado'), 'aprovado');
});

asUser({ id: 30, nivel: 'super', funcao_emprestimo: null }, () => {
  assert.equal(context._empPodeAprovar(), true, 'superusuário mantém a gestão do módulo');
});

asUser({ id: 40, nivel: 'operador', funcao_emprestimo: null }, () => {
  assert.equal(context._empPodeAprovar(), false, 'operador sem função de empréstimo não recebe aprovação implícita');
});

console.log('OK: subníveis do Empréstimo limitam o Solicitante e liberam os aprovadores.');
