-- Fila de mecânicos para o agendamento externo (calendário de vagas por horário).
-- Não altera as funções/tabelas já existentes (agendamento_solicitar, agendamento_disponibilidade,
-- agendamento_listar_empresas, agendamento_listar_veiculos) — é 100% aditivo.

alter table public.agendamentos_externos
  add column if not exists mecanico_id bigint,
  add column if not exists mecanico_nome text;

-- Retorna, para um dia, quantas vagas restam em cada horário de expediente.
-- Capacidade = nº de mecânicos técnicos ativos cadastrados (exclui função "AJUDANTE"),
-- então quando você contratar o 4º mecânico a fila aumenta sozinha, sem mexer no código.
create or replace function public.agendamento_ocupacao_dia(
  p_tenant text,
  p_data date,
  p_hora_ini int default 7,
  p_hora_fim int default 16
)
returns table(hora int, ocupados int, vagas int, capacidade int)
language sql
security definer
set search_path = public
stable
as $$
  with cap as (
    select greatest(count(*)::int, 1) as capacidade
    from public.mecanicos
    where tenant = p_tenant
      and coalesce(ativo, true) = true
      and upper(coalesce(funcao, especialidade, '')) <> 'AJUDANTE'
  ),
  horas as (
    select generate_series(p_hora_ini, p_hora_fim) as hora
  ),
  ocup as (
    select extract(hour from horario_inicio at time zone 'America/Fortaleza')::int as hora,
           count(*) as qtd
    from public.agendamentos_externos
    where tenant = p_tenant
      and (horario_inicio at time zone 'America/Fortaleza')::date = p_data
      and status in ('pendente', 'autorizado')
    group by 1
  )
  select h.hora,
         coalesce(o.qtd, 0)::int as ocupados,
         greatest(cap.capacidade - coalesce(o.qtd, 0)::int, 0) as vagas,
         cap.capacidade
  from horas h
  left join ocup o on o.hora = h.hora
  cross join cap
  order by h.hora;
$$;

grant execute on function public.agendamento_ocupacao_dia(text, date, int, int) to anon, authenticated;
