-- Novo campo: execução diária da OS (serviço que atravessa vários dias).
-- Cada OS/Pré-OS passa a poder ter uma lista de dias, cada um com data,
-- horário que chegou na oficina, horário que iniciou e horário que
-- terminou/parou o serviço naquele dia. Quantos dias forem precisos.
-- Aditivo: coluna nova, nada existente é alterado.

alter table public.ordens_servico
  add column if not exists diario_execucao jsonb default '[]'::jsonb;
