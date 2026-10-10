// Recebe o estado do carrinho enviado pelo site (cliente cadastrado e com
// consentimento de WhatsApp). Não envia mensagem nenhuma: só registra.
//
// Secrets: ALLOWED_ORIGINS (lista separada por vírgula, ex.: https://forja.netlify.app)
//          SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (já existem na função)
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  cartTotal,
  normalizePhoneBR,
  phoneKey,
  sanitizeItems,
  UUID_RE,
} from "../_shared/logic.ts";

const TENANT = "forja";
const MAX_BODY = 20_000;

const allowed = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);

function cors(origin: string | null) {
  const ok = origin && allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin! : "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Vary": "Origin",
  };
}

const json = (body: unknown, status: number, h: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...h, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const h = cors(origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  if (req.method !== "POST") return json({ error: "method" }, 405, h);
  if (!origin || !allowed.includes(origin)) return json({ error: "origin" }, 403, h);

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: "too_large" }, 413, h);
  let b: Record<string, unknown>;
  try {
    b = JSON.parse(raw);
  } catch {
    return json({ error: "json" }, 400, h);
  }

  const sid = String(b.session_id ?? "");
  if (!UUID_RE.test(sid)) return json({ error: "session_id" }, 400, h);

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  switch (b.action) {
    case "clear": // carrinho esvaziado / usuário saiu
      await db.from("ca_carts").update({ status: "cleared" })
        .eq("tenant", TENANT).eq("session_id", sid)
        .in("status", ["active", "skipped"]);
      return json({ ok: true }, 200, h);

    case "ordered": // pedido finalizado: nunca lembrar
      await db.from("ca_carts").update({ status: "ordered" })
        .eq("tenant", TENANT).eq("session_id", sid);
      return json({ ok: true }, 200, h);

    case "erase": // exclusão de dados (LGPD)
      await db.from("ca_carts").delete()
        .eq("tenant", TENANT).eq("session_id", sid);
      return json({ ok: true }, 200, h);

    case "upsert": {
      if (b.consent !== true) return json({ error: "consent" }, 400, h);
      const phone = normalizePhoneBR(b.phone);
      if (!phone) return json({ error: "phone" }, 400, h);
      const items = sanitizeItems(b.items);
      if (!items) return json({ error: "items" }, 400, h);
      const name = String(b.name ?? "").trim().slice(0, 80);
      if (!name) return json({ error: "name" }, 400, h);
      const key = phoneKey(phone);

      const { data: out } = await db.from("ca_optout").select("phone_key")
        .eq("tenant", TENANT).eq("phone_key", key).maybeSingle();
      if (out) return json({ ok: true, optout: true }, 200, h);

      const { error } = await db.from("ca_carts").upsert({
        tenant: TENANT,
        session_id: sid,
        name,
        email: b.email ? String(b.email).slice(0, 120) : null,
        phone,
        phone_key: key,
        items,
        total: cartTotal(items),
        status: "active",
        attempts: 0,
        retry_after: null,
        last_activity_at: new Date().toISOString(),
      }, { onConflict: "tenant,session_id" });
      if (error) return json({ error: "db" }, 500, h);
      return json({ ok: true }, 200, h);
    }

    default:
      return json({ error: "action" }, 400, h);
  }
});
