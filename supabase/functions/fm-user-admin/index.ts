import "jsr:@supabase/functions-js@2.4.4/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.57.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  try {
    const authorization = req.headers.get("Authorization") ?? "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Sessão não autenticada." }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Sessão inválida." }, 401);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: caller, error: callerError } = await admin
      .from("usuarios")
      .select("id,tenant,nivel,ativo,excluido")
      .eq("auth_user_id", authData.user.id)
      .maybeSingle();
    if (callerError || !caller || caller.nivel !== "super" || !caller.ativo || caller.excluido) {
      return json({ error: "Somente o Super Usuário pode administrar contas." }, 403);
    }

    const body = await req.json();
    if (body?.action !== "provision") return json({ error: "Ação inválida." }, 400);
    const profileId = body.profile_id;
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    if (!profileId || !/^\S+@\S+\.\S+$/.test(email)) return json({ error: "Perfil ou e-mail inválido." }, 400);
    if (password.length < 6) return json({ error: "A senha deve ter no mínimo 6 caracteres." }, 400);

    const { data: target, error: targetError } = await admin
      .from("usuarios")
      .select("id,tenant,email,auth_user_id,ativo,excluido")
      .eq("id", profileId)
      .eq("tenant", caller.tenant)
      .maybeSingle();
    if (targetError || !target || target.excluido) return json({ error: "Perfil não encontrado neste ambiente." }, 404);

    let authUserId = target.auth_user_id as string | null;
    if (!authUserId) {
      const { data: usersData, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (usersError) return json({ error: usersError.message }, 500);
      authUserId = usersData.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
    }

    if (authUserId) {
      const { error: updateAuthError } = await admin.auth.admin.updateUserById(authUserId, {
        email,
        password,
        email_confirm: true,
      });
      if (updateAuthError) return json({ error: updateAuthError.message }, 400);
    } else {
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (createError || !created.user) return json({ error: createError?.message ?? "Falha ao criar conta." }, 400);
      authUserId = created.user.id;
    }

    const { error: linkError } = await admin
      .from("usuarios")
      .update({ auth_user_id: authUserId, email, ativo: true })
      .eq("id", target.id)
      .eq("tenant", caller.tenant);
    if (linkError) return json({ error: linkError.message }, 500);

    return json({ ok: true, auth_user_id: authUserId });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Erro interno." }, 500);
  }
});
