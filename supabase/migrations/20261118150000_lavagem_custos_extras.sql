-- ═══════════════════════════════════════════════════════════════════
--  LAVAGEM (Manutenção → Lavagem)
--  Cada lavagem é gravada em custos_extras (tipo 'Lavagem/Higienização',
--  origem_custo 'lavagem') e o valor padrão fica em equipamentos.parametros.valor_lavagem.
--  Este script só GARANTE as colunas usadas pela tela. Não apaga nem altera dados.
--  Pode rodar mais de uma vez sem problema.
-- ═══════════════════════════════════════════════════════════════════
alter table public.custos_extras
  add column if not exists centro_custo_id bigint,
  add column if not exists origem_custo   text,
  add column if not exists vinculado_ativo boolean default true,
  add column if not exists responsavel    text,
  add column if not exists obs            text,
  add column if not exists ativo          boolean default true,
  add column if not exists excluido       boolean default false,
  add column if not exists excluido_em    timestamptz,
  add column if not exists excluido_por   text;

alter table public.equipamentos
  add column if not exists parametros jsonb default '{}'::jsonb;

-- deixa a tela de lavagens e o relatório rápidos
create index if not exists idx_custos_extras_lavagem
  on public.custos_extras (tenant, equipamento_id, data)
  where origem_custo = 'lavagem';
