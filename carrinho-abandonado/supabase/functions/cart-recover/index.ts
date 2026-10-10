// Chamada a cada minuto pelo pg_cron. Pega carrinhos parados há >= MINUTES,
// e manda UM lembrete por WhatsApp (Evolution API).
//
// Secrets: CRON_SECRET, EVOLUTION_URL, EVOLUTION_INSTANCE, EVOLUTION_APIKEY,
//          SITE_URL, STORE_NAME (opcional), RECOVERY_COUPON (opcional),
//          MINUTES (padrão 20), QUIET_START (21), QUIET_END (8)
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildMessage, isQuietHour } from "../_shared/logic.ts";

const TENANT = "forja";
const BATCH = 20;
const MAX_ATTEMPTS = 3;
const PER_PHONE_COOLDOWN_H = 24;

const env = (k: string, d = "") => Deno.env.get(k) ?? d;

function safeEqual(a: string, b: string) {
  if (a.length !== b.length || a.length === 0) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

Deno.serve(async (req) => {
  if (!safeEqual(req.headers.get("x-cron-secret") ?? "", env("CRON_SECRET"))) {
    return new Response("forbidden", { status: 403 });
  }

  const now = new Date();
  const quiet = isQuietHour(
    now,
    Number(env("QUIET_START", "21")),
    Number(env("QUIET_END", "8")),
  );
  if (quiet) return Response.json({ skipped: "quiet_hours" });

  const minutes = Number(env("MINUTES", "20"));
  const cutoff = new Date(now.getTime() - minutes * 60_000).toISOString();

  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });

  const { data: due, error } = await db.from("ca_carts")
    .select("id")
    .eq("tenant", TENANT).eq("status", "active")
    .lte("last_activity_at", cutoff)
    .or(`retry_after.is.null,retry_after.lte.${now.toISOString()}`)
    .order("last_activity_at").limit(BATCH);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let sent = 0, skipped = 0, failed = 0;

  for (const { id } of due ?? []) {
    // "claim" atômico: só um worker consegue passar de active -> sending
    const { data: claimed } = await db.from("ca_carts")
      .update({ status: "sending" })
      .eq("id", id).eq("status", "active").select().maybeSingle();
    if (!claimed) continue;

    // opt-out ou lembrete recente para o mesmo telefone
    const { data: out } = await db.from("ca_optout").select("phone_key")
      .eq("tenant", TENANT).eq("phone_key", claimed.phone_key).maybeSingle();
    const since = new Date(now.getTime() - PER_PHONE_COOLDOWN_H * 3_600_000).toISOString();
    const { count: recent } = await db.from("ca_carts")
      .select("id", { count: "exact", head: true })
      .eq("tenant", TENANT).eq("phone_key", claimed.phone_key)
      .gte("reminded_at", since);
    if (out || (recent ?? 0) > 0) {
      await db.from("ca_carts")
        .update({ status: out ? "optout" : "skipped" }).eq("id", id);
      skipped++;
      continue;
    }

    const text = buildMessage({
      name: claimed.name,
      items: claimed.items,
      siteUrl: env("SITE_URL"),
      store: env("STORE_NAME", "FORJA"),
      coupon: env("RECOVERY_COUPON") || undefined,
    });

    try {
      const res = await fetch(
        `${env("EVOLUTION_URL").replace(/\/$/, "")}/message/sendText/${
          encodeURIComponent(env("EVOLUTION_INSTANCE"))
        }`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: env("EVOLUTION_APIKEY") },
          body: JSON.stringify({ number: claimed.phone, text }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!res.ok) throw new Error(`evolution ${res.status}`);
      await db.from("ca_carts")
        .update({ status: "reminded", reminded_at: new Date().toISOString() })
        .eq("id", id);
      sent++;
    } catch (_e) {
      const attempts = claimed.attempts + 1;
      await db.from("ca_carts").update({
        status: attempts >= MAX_ATTEMPTS ? "failed" : "active",
        attempts,
        retry_after: new Date(Date.now() + 5 * 60_000 * attempts).toISOString(),
      }).eq("id", id);
      failed++;
    }
  }

  return Response.json({ sent, skipped, failed });
});
