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

// logo não volta a ser colado em base64 (eram ~280 KB a cada abertura)
assert.ok(!/data:image\/png;base64,\/9j/.test(html), 'logo em base64 voltou para o HTML');
assert.ok(html.includes('assets/logo-fni.webp') && fs.existsSync(new URL('./assets/logo-fni.webp', import.meta.url)));
// Excel não bloqueia a abertura
assert.match(html, /<script defer src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/xlsx\//);
// buscas digitadas esperam a pessoa parar de digitar
assert.ok(!/oninput="[^"]*[^A-Za-z]loadPage\(/.test(html), 'campo de busca redesenhando a cada tecla');
// cache dos estáticos
assert.match(fs.readFileSync(new URL('./_headers', import.meta.url), 'utf8'), /\/assets\/\*\n\s+Cache-Control: public, max-age=/);

// paginação: tabela com 2.500 linhas chega inteira; log traz só os 1.000 mais recentes, em ordem
const { buscar } = new Function(`const _SB_PAGINA = 1000, _SB_MAX_PAGINAS = 50; ${extrair('_sbBuscarPaginado')}; return { buscar: _sbBuscarPaginado };`)();
const linhas = Array.from({ length: 2500 }, (_, i) => ({ id: i + 1 }));
const consultas = [];
const fake = (dados) => () => {
  const q = { _ini: 0, _fim: dados.length - 1, _asc: true, _lim: null,
    order(_c, o) { q._asc = o?.ascending !== false; return q; },
    range(a, b) { q._ini = a; q._fim = b; consultas.push([a, b]); return q; },
    limit(n) { q._lim = n; return q; },
    then(res) { let d = q._asc ? dados : dados.slice().reverse(); d = q._lim ? d.slice(0, q._lim) : d.slice(q._ini, q._fim + 1); return Promise.resolve({ data: d, error: null }).then(res); } };
  return q;
};
const r = await buscar('ordens_servico', fake(linhas));
assert.equal(r.data.length, 2500, 'paginação perdeu linhas');
assert.deepEqual(consultas, [[0, 999], [1000, 1999], [2000, 2999]]);
const logs = Array.from({ length: 3000 }, (_, i) => ({ id: i + 1 }));
const rl = await buscar('logs_auditoria', fake(logs));
assert.equal(rl.data.length, 1000);
assert.equal(rl.data[0].id, 2001); assert.equal(rl.data[999].id, 3000);

// sem tabela repetida e sem carga dupla simultânea
assert.match(extrair('_sbCarregarTudoAgora'), /\[\.\.\.new Set\(SB_TABLES\)\]/);
assert.match(extrair('sbCarregarTudo'), /_sbCargaEmAndamento/);
console.log('desempenho OK');
