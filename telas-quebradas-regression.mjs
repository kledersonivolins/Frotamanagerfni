import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');

// loadPage não pode apagar telas que escrevem direto no #pageBody (Apontamento, Custo por Placa)
assert.match(html, /if\(result !== undefined\) body\.innerHTML = result\|\|'';/, 'loadPage voltou a apagar telas que não devolvem HTML');
for (const f of ['renderApontamento', 'renderCustoPorPlaca']) {
  const ini = html.indexOf(`function ${f}(`);
  assert.ok(ini > 0 && html.slice(ini, ini + 6000).includes("getElementById('pageBody').innerHTML"), `${f} mudou de formato; revise o loadPage`);
}

// Relatório da Frota: a linha da tabela precisa receber dispFrota e litrosFrota
assert.match(html, /rows\.map\(\(\{eq,osAbertas,osPreOS,diasParado,custoOS,custoComb,custoManu,custoTotal,kmAtual,pneusAlerta,litrosFrota,dispFrota\}\)=>/);

// Mecânico sem telefone e motorista sem nome/CPF não podem derrubar a tela
assert.ok(!/m\.telefone\.replace\(/.test(html), 'mecânico sem telefone quebra a tela');
assert.ok(!/!m\.cpf\.includes\(fNome\)/.test(html), 'motorista sem CPF quebra a busca');
assert.ok(!/db\.compartimentos\.find\(c=>c\.nome\.toLowerCase/.test(html));
assert.ok(!/db\.categorias_media\.find\(cat=>cat\.nome\.toLowerCase/.test(html));

console.log('telas-quebradas OK');
