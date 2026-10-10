-- Carrinho abandonado: tabelas, RLS fechada e agendador (a cada minuto).
-- Tudo prefixado com ca_ para não colidir com outras tabelas do projeto.

create table if not exists public.ca_carts (
  id               uuid primary key default gen_random_uuid(),
  tenant           text not null default 'forja',
  session_id       uuid not null,
  name             text not null,
  email            text,
  phone            text not null,          -- 55DDNNNNNNNNN
  phone_key        text not null,          -- DDD + últimos 8 dígitos
  items            jsonb not null default '[]'::jsonb,
  total            numeric(12,2) not null default 0,
  status           text not null default 'active'
    check (status in ('active','sending','reminded','ordered','cleared','optout','skipped','failed')),
  attempts         int not null default 0,
  retry_after      timestamptz,
  last_activity_at timestamptz not null default now(),
  reminded_at      timestamptz,
  created_at       timestamptz not null default now(),
  unique (tenant, session_id)
);

create index if not exists ca_carts_due_idx
  on public.ca_carts (last_activity_at) where status = 'active';
create index if not exists ca_carts_phone_idx
  on public.ca_carts (tenant, phone_key, reminded_at);

create table if not exists public.ca_optout (
  tenant     text not null default 'forja',
  phone_key  text not null,
  created_at timestamptz not null default now(),
  primary key (tenant, phone_key)
);

-- RLS ligada e SEM policies: o navegador (anon/authenticated) não lê nem
-- escreve nada. Só as edge functions, com a service role, acessam.
alter table public.ca_carts  enable row level security;
alter table public.ca_optout enable row level security;
revoke all on public.ca_carts  from anon, authenticated;
revoke all on public.ca_optout from anon, authenticated;

-- Agendador: chama a edge function cart-recover a cada minuto.
-- Os dois segredos ficam no Vault (veja o README), nunca neste arquivo:
--   ca_project_url  -> https://<ref>.supabase.co
--   ca_cron_secret  -> mesmo valor do secret CRON_SECRET da função
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'ca-recover-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'ca_project_url')
           || '/functions/v1/cart-recover',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ca_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);
