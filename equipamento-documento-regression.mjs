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
const campos = html.match(/const EQ_CAMPOS_DOC = (\[[\s\S]*?\n\]);/)[1];
function montar(equipamentos, els = {}) {
  const document = { getElementById: (id) => els[id] || null };
  return new Function('db', 'document', `const EQ_CAMPOS_DOC = ${campos};\n${extrair('esc')}\n${extrair('_eqTemColunasDoc')}\n${extrair('_eqHtmlConsultaDoc')}\n${extrair('_eqLerConsultaDoc')}\nreturn { _eqTemColunasDoc, _eqHtmlConsultaDoc, _eqLerConsultaDoc };`)({ equipamentos }, document);
}

// antes do SQL (banco sem as colunas): o formulário não mostra nem envia os campos novos
let t = montar([{ id: 1, placa: 'AQT6391' }]);
assert.equal(t._eqTemColunasDoc(), false);
assert.equal(t._eqHtmlConsultaDoc({ id: 1 }), '');

// depois do SQL: mostra a seção, com alerta de restrição e os dados extras
const eq = { id: 1, placa: 'JRG2652', situacao_doc: 'Em circulação', restricoes: 'Chassi alongado; Renainf', multa_renainf: true,
  roubo_furto: false, data_crlv: '2026-01-07', pbt_t: 23, dados_documento: { procedencia: 'Nacional', pbt: '23 t' } };
t = montar([eq]);
const out = t._eqHtmlConsultaDoc(eq);
assert.match(out, /Consulta do documento/);
assert.match(out, /Chassi alongado; Renainf/, 'alerta de restrição');
assert.match(out, /id="eqd_data_crlv" value="2026-01-07"/);
assert.match(out, /<option value="1" selected>Sim<\/option>/, 'multa renainf = Sim');
assert.match(out, /procedencia:<\/b> Nacional/);
assert.ok(!/pbt:<\/b>/.test(out), 'pbt já tem campo próprio, não repete nos extras');
assert.ok(!/undefined|null/.test(out.replace(/v==null/g, '')));
// sem restrição não mostra alerta
assert.ok(!/triangle-exclamation/.test(t._eqHtmlConsultaDoc({ ...eq, restricoes: 'Sem restrição', multa_renainf: true })));

// leitura do formulário: Sim/Não viram booleano, número vira número, vazio vira null
t = montar([eq], { eqd_renajud: { value: '0' }, eqd_leilao: { value: '' }, eqd_pbt_t: { value: '57.5' }, eqd_situacao_doc: { value: ' Em circulação ' }, eqd_data_crv: { value: '' } });
const lido = t._eqLerConsultaDoc();
assert.equal(lido.renajud, false);
assert.equal(lido.leilao, null);
assert.equal(lido.pbt_t, 57.5);
assert.equal(lido.situacao_doc, 'Em circulação');
assert.equal(lido.data_crv, null);
assert.ok(!('restricoes' in lido), 'campo ausente na tela não é enviado');

// salvarEq usa os campos só quando o banco já tem as colunas, e preserva dados_documento
const salvar = extrair('salvarEq');
assert.match(salvar, /if\(_eqTemColunasDoc\(\)\)\{\s*Object\.assign\(eq, _eqLerConsultaDoc\(\)\);/);
assert.match(salvar, /eq\.dados_documento = db\.equipamentos\[idx\]\.dados_documento/);
// colunas criadas pelo SQL batem com os campos da tela
const sql = fs.readFileSync(new URL('./supabase/migrations/20261126120000_equipamentos_dados_documento.sql', import.meta.url), 'utf8');
for (const [col] of eval(campos)) assert.match(sql, new RegExp(`add column if not exists ${col} `), `coluna ${col} no SQL`);
console.log('equipamento-documento OK');
