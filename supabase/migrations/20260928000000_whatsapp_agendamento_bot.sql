-- Sessões de conversa do bot de agendamento via WhatsApp.
-- Guarda em que pergunta cada telefone está e os dados já coletados, entre
-- uma mensagem e outra. Só a Edge Function (service role) acessa — sem
-- policy para anon/authenticated.

create table if not exists public.whatsapp_conversas (
  id bigint generated always as identity primary key,
  tenant text not null,
  telefone text not null,
  etapa text not null default 'inicio',
  dados jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (tenant, telefone)
);

alter table public.whatsapp_conversas enable row level security;

grant select, insert, update, delete on public.whatsapp_conversas to service_role;
grant usage, select on sequence public.whatsapp_conversas_id_seq to service_role;
