// Executa o bloco "Recuperação de carrinho abandonado" do site num sandbox,
// com fetch/localStorage simulados.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../site/index.html", import.meta.url), "utf8");

// 1) todos os <script> inline compilam
const re = /<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g;
let m, scripts = [];
while ((m = re.exec(html))) scripts.push(m[1]);
for (const s of scripts) new Function(s);

// 2) extrai o bloco de recuperação
const start = html.indexOf("const RECOVERY=");
const end = html.indexOf("function recoveryMark");
assert.ok(start > 0 && end > start, "bloco de recuperação não encontrado");
const block = html.slice(start, html.indexOf("\n", end));

function sandbox(endpoint) {
  const calls = [];
  const mem = {};
  const ctx = {
    calls, setTimeout, clearTimeout, crypto: { randomUUID: () => "11111111-2222-4333-8444-555555555555" },
    store: { get: (k, d) => (k in mem ? mem[k] : d), set: (k, v) => { mem[k] = v; } },
    fetch: (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return Promise.resolve(); },
    getP: () => ({ name: "Whey", price: 100, flavors: [{ n: "Choc" }], weights: [{ n: "1 kg", m: 1 }] }),
    cart: [], user: null,
  };
  vm.createContext(ctx);
  vm.runInContext(block.replace("endpoint:''", `endpoint:'${endpoint}'`), ctx);
  return ctx;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// telefone
const c0 = sandbox("");
assert.equal(c0.recoveryPhone("(86) 99802-6241"), "5586998026241");
assert.equal(c0.recoveryPhone("8633221100"), null);

// sem endpoint: nada é enviado
c0.user = { name: "Ana", email: "a@a.com", phone: "5586998026241", wa: true };
c0.cart = [{ id: "x", f: 0, w: 0, q: 1 }];
c0.recoverySync(); await wait(1700);
assert.equal(c0.calls.length, 0);

// com endpoint: usuário sem consentimento -> nada
const c1 = sandbox("https://x/functions/v1/cart-sync");
c1.user = { name: "Ana", email: "a@a.com", phone: "5586998026241", wa: false };
c1.cart = [{ id: "x", f: 0, w: 0, q: 1 }];
c1.recoverySync(); await wait(1700);
assert.equal(c1.calls.length, 0, "sem consentimento não envia");

// com consentimento: upsert com itens (debounce junta várias mudanças)
c1.user.wa = true;
c1.recoverySync();
c1.cart = [{ id: "x", f: 0, w: 0, q: 2 }];
c1.recoverySync(); await wait(1700);
assert.equal(c1.calls.length, 1, "debounce");
const b = c1.calls[0].body;
assert.equal(b.action, "upsert");
assert.equal(b.consent, true);
assert.equal(b.phone, "5586998026241");
assert.deepEqual(b.items, [{ name: "Whey", variant: "Choc · 1 kg", qty: 2, price: 100 }]);
assert.equal(b.session_id, "11111111-2222-4333-8444-555555555555");

// sem mudança: não reenvia
c1.recoverySync(); await wait(1700);
assert.equal(c1.calls.length, 1);

// carrinho vazio -> clear
c1.cart = []; c1.recoverySync(); await wait(1700);
assert.equal(c1.calls.at(-1).body.action, "clear");

// pedido finalizado / exclusão
c1.recoveryMark("ordered");
assert.equal(c1.calls.at(-1).body.action, "ordered");
c1.recoveryMark("erase");
assert.equal(c1.calls.at(-1).body.action, "erase");

console.log("site OK");
