import assert from "node:assert/strict";
import {
  buildMessage, cartTotal, isOptOutText, isQuietHour, normalizePhoneBR,
  phoneKey, sanitizeItems,
} from "../supabase/functions/_shared/logic.ts";

// telefone
assert.equal(normalizePhoneBR("5586998026241"), "5586998026241");
assert.equal(normalizePhoneBR("(86) 99802-6241"), "5586998026241");
assert.equal(normalizePhoneBR("086998026241"), "5586998026241");
assert.equal(normalizePhoneBR("+55 86 99802-6241"), "5586998026241");
assert.equal(normalizePhoneBR("8633221100"), null, "fixo não vale");
assert.equal(normalizePhoneBR("5586898026241"), null, "sem 9º dígito");
assert.equal(normalizePhoneBR("123"), null);
assert.equal(normalizePhoneBR(null), null);
assert.equal(normalizePhoneBR("5500998026241"), null, "DDD inválido");

// chave: formato com e sem o 9º dígito casam
assert.equal(phoneKey("5586998026241"), phoneKey("558698026241"));
assert.notEqual(phoneKey("5586998026241"), phoneKey("5585998026241"));

// itens
const ok = sanitizeItems([{ name: " Whey ", variant: "Choc · 1 kg", qty: 2, price: 129.9 }]);
assert.deepEqual(ok, [{ name: "Whey", variant: "Choc · 1 kg", qty: 2, price: 129.9 }]);
assert.equal(sanitizeItems([]), null);
assert.equal(sanitizeItems("x"), null);
assert.equal(sanitizeItems([{ name: "a", qty: 0, price: 1 }]), null);
assert.equal(sanitizeItems([{ name: "a", qty: 1, price: -1 }]), null);
assert.equal(sanitizeItems(Array(31).fill({ name: "a", qty: 1, price: 1 })), null);
assert.equal(cartTotal(ok), 259.8);

// horário de silêncio (Fortaleza = UTC-3)
assert.equal(isQuietHour(new Date("2026-10-10T12:00:00Z")), false); // 09h local
assert.equal(isQuietHour(new Date("2026-10-10T00:30:00Z")), true); // 21h30 local
assert.equal(isQuietHour(new Date("2026-10-10T09:00:00Z")), true); // 06h local
assert.equal(isQuietHour(new Date("2026-10-10T11:00:00Z")), false); // 08h local

// opt-out
for (const t of ["SAIR", " sair.", "Parar!", "stop"]) assert.equal(isOptOutText(t), true, t);
for (const t of ["não quero sair", "quero comprar", "", null]) assert.equal(isOptOutText(t), false, String(t));

// mensagem
const msg = buildMessage({
  name: "marina costa", items: ok, siteUrl: "https://loja.example", store: "FORJA", coupon: "VOLTA5",
});
assert.match(msg, /^Oi, Marina!/);
assert.match(msg, /2× Whey \(Choc · 1 kg\) — R\$ 259,80/);
assert.match(msg, /Total: R\$ 259,80/);
assert.match(msg, /cupom VOLTA5/);
assert.match(msg, /https:\/\/loja\.example/);
assert.match(msg, /responda SAIR/);
assert.doesNotMatch(buildMessage({ name: "A", items: ok, siteUrl: "u", store: "S" }), /cupom/);

console.log("logic OK");
