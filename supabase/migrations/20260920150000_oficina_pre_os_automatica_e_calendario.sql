-- Parte 2 da fila de mecânicos:
--  a) pedido feito pelo link externo já nasce como Pré-OS (fila decidida na hora),
--     sem precisar de aprovação manual em "Agendamentos Externos";
--  b) calendário do mês (agendamento_ocupacao_mes) para pintar os dias com/sem vaga.
-- Aditivo: não altera agendamento_solicitar, agendamento_disponibilidade nem a migration anterior.

create or replace function public._trg_agendamento_externo_auto_pre_os()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mecanico record;
  v_numero text;
  v_os_id bigint;
begin
  begin
    select m.id, m.nome into v_mecanico
    from public.mecanicos m
    where m.tenant = NEW.tenant
      and coalesce(m.ativo, true) = true
      and upper(coalesce(m.funcao, m.especialidade, '')) <> 'AJUDANTE'
    order by (
      select count(*) from public.agendamentos_externos a
      where a.mecanico_id = m.id
        and a.status = 'autorizado'
        and a.data = NEW.data
    ) asc, m.nome asc
    limit 1;

    select lpad((coalesce(max(numero::int), 0) + 1)::text, 4, '0') into v_numero
    from public.ordens_servico
    where tenant = NEW.tenant and numero ~ '^[0-9]+$';

    v_os_id := (extract(epoch from clock_timestamp()) * 1000)::bigint;

    insert into public.ordens_servico (
      id, numero, equipamento_id, empresa_id, tipo, tipo_abertura, status, origem,
      data_abertura, data_previsao, solicitante, oficina, descricao, custo,
      responsavel, obs, tenant
    ) values (
      v_os_id, coalesce(v_numero, '0001'), NEW.veiculo_id, NEW.empresa_id,
      coalesce(NEW.tipo_servico, 'Manutenção'), 'Pre-OS', 'pre_os', 'agendamento_externo',
      (now() at time zone 'America/Fortaleza')::date, NEW.data, NEW.nome_solicitante,
      'Agendamento externo', NEW.descricao, 0,
      v_mecanico.nome,
      'Protocolo externo: ' || coalesce(NEW.protocolo, '') ||
        case when v_mecanico.nome is not null then ' | Mecânico da fila: ' || v_mecanico.nome else '' end,
      NEW.tenant
    );

    NEW.status := 'autorizado';
    NEW.pre_os_id := v_os_id;
    NEW.mecanico_id := v_mecanico.id;
    NEW.mecanico_nome := v_mecanico.nome;
    NEW.autorizado_por := 'Automático (fila)';
    NEW.autorizado_em := now();
  exception when others then
    -- se algo aqui falhar, o pedido não se perde: fica pendente pra aprovação manual, como antes
    raise warning 'Falha ao auto-gerar Pre-OS do agendamento %: %', NEW.protocolo, SQLERRM;
  end;
  return NEW;
end;
$$;

drop trigger if exists trg_agendamento_externo_auto_pre_os on public.agendamentos_externos;
create trigger trg_agendamento_externo_auto_pre_os
  before insert on public.agendamentos_externos
  for each row
  execute function public._trg_agendamento_externo_auto_pre_os();

-- Ocupação do mês inteiro, dia a dia, para pintar o calendário do link público.
create or replace function public.agendamento_ocupacao_mes(
  p_tenant text,
  p_ano int,
  p_mes int,
  p_hora_ini int default 7,
  p_hora_fim int default 16
)
returns table(dia date, vagas_dia int, tem_vaga boolean)
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
  dias as (
    select generate_series(
      make_date(p_ano, p_mes, 1),
      (make_date(p_ano, p_mes, 1) + interval '1 month - 1 day')::date,
      interval '1 day'
    )::date as dia
  ),
  horas as (
    select generate_series(p_hora_ini, p_hora_fim) as hora
  ),
  grade as (
    select d.dia, h.hora from dias d cross join horas h
  ),
  ocup as (
    select (horario_inicio at time zone 'America/Fortaleza')::date as dia,
           extract(hour from horario_inicio at time zone 'America/Fortaleza')::int as hora,
           count(*) as qtd
    from public.agendamentos_externos
    where tenant = p_tenant
      and (horario_inicio at time zone 'America/Fortaleza')::date
          between make_date(p_ano, p_mes, 1) and (make_date(p_ano, p_mes, 1) + interval '1 month - 1 day')::date
      and status in ('pendente', 'autorizado')
    group by 1, 2
  )
  select g.dia,
         sum(greatest(cap.capacidade - coalesce(o.qtd, 0)::int, 0))::int as vagas_dia,
         bool_or(greatest(cap.capacidade - coalesce(o.qtd, 0)::int, 0) > 0) as tem_vaga
  from grade g
  left join ocup o on o.dia = g.dia and o.hora = g.hora
  cross join cap
  group by g.dia
  order by g.dia;
$$;

grant execute on function public.agendamento_ocupacao_mes(text, int, int, int, int) to anon, authenticated;
