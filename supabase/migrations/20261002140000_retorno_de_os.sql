-- Vínculo de "retorno": quando um veículo volta à oficina pelo mesmo problema de uma
-- OS já concluída, a nova OS guarda o id da OS anterior em retorno_de_os_id.
-- Isso permite: (a) mostrar na OS antiga que ela gerou um retorno; (b) mostrar na OS
-- nova de qual OS ela é retorno; (c) futuramente medir taxa de retorno por mecânico/serviço.

alter table public.ordens_servico
  add column if not exists retorno_de_os_id bigint;

create index if not exists idx_ordens_servico_retorno_de_os_id
  on public.ordens_servico (tenant, retorno_de_os_id)
  where retorno_de_os_id is not null;
