-- Correção urgente: o limite de "4 veículos" estava contando TODA a frota do tenant
-- (ordens_servico aberta/em_andamento/oficina_externa de qualquer origem), e essa oficina
-- roda ~30 OS abertas ao mesmo tempo no dia a dia normal — então todo agendamento pelo
-- link estava sendo recusado automaticamente (bug encontrado em teste real: "Oficina
-- lotada: 30 de 4 vagas ocupadas").
-- Correto: contar só os veículos que chegaram à oficina POR ESTE LINK de agendamento
-- (origem = 'agendamento_externo') e que já estão fisicamente em atendimento.

create or replace function public._oficina_vagas_fisicas_ocupadas(p_tenant text)
returns int
language sql
security definer
set search_path = public
stable
as $$
  select count(distinct equipamento_id)::int
  from public.ordens_servico
  where tenant = p_tenant
    and origem = 'agendamento_externo'
    and lower(coalesce(status, '')) in ('aberta', 'em_andamento', 'oficina_externa');
$$;

grant execute on function public._oficina_vagas_fisicas_ocupadas(text) to anon, authenticated;
