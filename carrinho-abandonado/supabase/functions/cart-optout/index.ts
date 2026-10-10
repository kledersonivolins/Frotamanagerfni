// Webhook da Evolution (evento MESSAGES_UPSERT). Quando o cliente responde
// SAIR / PARAR / STOP, grava o opt-out e cancela carrinhos pendentes.
//
// Webhook na Evolution: https://<ref>.supabase.co/functions/v1/cart-optout?token=<OPTOUT_TOKEN>
// Secrets: OPTOUT_TOKEN
import { createClient } from "npm:@supabase/supabase-js@2";
import { isOptOutText, phoneKey } from "../_shared/logic.ts";

const TENANT = "forja";

function safeEqual(a: string, b: string) {
  if (a.length !== b.length || a.length === 0) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!safeEqual(token, Deno.env.get("OPTOUT_TOKEN") ?? "")) {
    return new Response("forbidden", { status: 403 });
  }
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: true });
  }

  // a Evolution manda data como objeto ou como lista
  const data = Array.isArray(body?.data) ? body.data[0] : body?.data;
  if (!data || data.key?.fromMe) return Response.json({ ok: true });

  const text = data.message?.conversation ??
    data.message?.extendedTextMessage?.text;
  if (!isOptOutText(text)) return Response.json({ ok: true });

  const jid = String(data.key?.remoteJid ?? "");
  const digits = jid.split("@")[0].replace(/\D/g, "");
  if (digits.length < 10) return Response.json({ ok: true });
  const key = phoneKey(digits);

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  await db.from("ca_optout").upsert(
    { tenant: TENANT, phone_key: key },
    { onConflict: "tenant,phone_key", ignoreDuplicates: true },
  );
  await db.from("ca_carts").update({ status: "optout" })
    .eq("tenant", TENANT).eq("phone_key", key)
    .in("status", ["active", "sending"]);

  return Response.json({ ok: true, optout: true });
});
