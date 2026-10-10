// Lógica pura (sem Deno/Supabase) para poder ser testada com node.

export type CartItem = {
  name: string;
  variant: string;
  qty: number;
  price: number;
};

/** Telefone BR celular -> "55DDNNNNNNNNN" (13 dígitos) ou null se inválido. */
export function normalizePhoneBR(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("0")) d = d.replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;
  if (d.length !== 13 || !d.startsWith("55")) return null;
  const ddd = Number(d.slice(2, 4));
  if (ddd < 11 || ddd > 99) return null;
  if (d[4] !== "9") return null; // só celular (9º dígito)
  return d;
}

/**
 * Chave estável do número: DDD + últimos 8 dígitos.
 * A Evolution/WhatsApp às vezes entrega números antigos sem o 9º dígito;
 * a chave faz os dois formatos casarem (opt-out e limite por telefone).
 */
export function phoneKey(phone: string): string {
  const d = phone.replace(/\D/g, "");
  const national = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  return national.slice(0, 2) + national.slice(-8);
}

export function formatBRL(v: number): string {
  return "R$ " + v.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const clip = (v: unknown, n: number) =>
  String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);

/** Valida e limita os itens vindos do navegador. Retorna null se inválido. */
export function sanitizeItems(input: unknown): CartItem[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > 30) {
    return null;
  }
  const out: CartItem[] = [];
  for (const it of input) {
    if (!it || typeof it !== "object") return null;
    const o = it as Record<string, unknown>;
    const qty = Math.floor(Number(o.qty));
    const price = Number(o.price);
    const name = clip(o.name, 80);
    if (!name || !(qty >= 1 && qty <= 99)) return null;
    if (!(price >= 0 && price <= 100000)) return null;
    out.push({
      name,
      variant: clip(o.variant, 60),
      qty,
      price: Math.round(price * 100) / 100,
    });
  }
  return out;
}

export function cartTotal(items: CartItem[]): number {
  return Math.round(items.reduce((s, i) => s + i.price * i.qty, 0) * 100) / 100;
}

/** true se a hora local (no fuso) cair no intervalo de silêncio [start, end). */
export function isQuietHour(
  date: Date,
  start = 21,
  end = 8,
  tz = "America/Fortaleza",
): boolean {
  const h = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hour12: false,
      timeZone: tz,
    }).format(date),
  ) % 24;
  return start > end ? h >= start || h < end : h >= start && h < end;
}

export function firstName(name: string): string {
  const f = name.trim().split(/\s+/)[0] || "";
  return f.charAt(0).toUpperCase() + f.slice(1).toLowerCase();
}

export function buildMessage(opts: {
  name: string;
  items: CartItem[];
  siteUrl: string;
  store: string;
  coupon?: string;
}): string {
  const { name, items, siteUrl, store, coupon } = opts;
  const lines = items.slice(0, 8).map((i) =>
    `• ${i.qty}× ${i.name}${i.variant ? ` (${i.variant})` : ""} — ${
      formatBRL(i.price * i.qty)
    }`
  );
  if (items.length > 8) lines.push(`• e mais ${items.length - 8} item(ns)`);
  const parts = [
    `Oi, ${firstName(name) || "tudo bem"}! Aqui é da ${store}.`,
    "",
    "Vimos que você deixou itens no carrinho:",
    ...lines,
    "",
    `Total: ${formatBRL(cartTotal(items))}`,
    "",
  ];
  if (coupon) parts.push(`Use o cupom ${coupon} para finalizar com desconto.`);
  parts.push(
    `Finalize aqui: ${siteUrl}`,
    "Se tiver qualquer dúvida, é só responder esta mensagem.",
    "Para não receber mais lembretes, responda SAIR.",
  );
  return parts.join("\n");
}

/** Texto de resposta que significa "pare de me enviar mensagens". */
export function isOptOutText(text: unknown): boolean {
  if (typeof text !== "string") return false;
  return /^\s*(sair|parar|stop|cancelar|descadastrar)\s*[.!]*\s*$/i.test(text);
}

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
