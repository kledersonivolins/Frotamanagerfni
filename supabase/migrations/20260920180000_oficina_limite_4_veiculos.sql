-- Limite físico da oficina: no máximo 4 veículos com OS aberta (aberta / em_andamento /
-- oficina_externa) ao mesmo tempo. Enquanto estiver no limite, todo novo pedido do link
-- externo é recusado automaticamente — só volta a aceitar quando uma dessas OS for
-- fechada (concluída/encerrada/cancelada), liberando vaga.
-- Pré-OS agendada (ainda não iniciada) não conta pro limite, só quando o carro
-- efetivamente entra na oficina (status muda pra 'aberta'/'em_andamento').
-- Aditivo: substitui (create or replace, mesma assinatura) as 3 funções das migrations
-- anteriores, sem quebrar nada que já chama agendamento_ocupacao_dia/mes ou o trigger.

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
    and lower(coalesce(status, '')) in ('aberta', 'em_andamento', 'oficina_externa');
$$;

grant execute on function public._oficina_vagas_fisicas_ocupadas(text) to anon, authenticated;

-- Trigger: agora também recusa automaticamente quando a oficina está no limite físico.
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
  v_max_veiculos constant int := 4;
  v_ocupadas int;
begin
  begin
    v_ocupadas := public._oficina_vagas_fisicas_ocupadas(NEW.tenant);

    if v_ocupadas >= v_max_veiculos then
      NEW.status := 'recusado';
      NEW.motivo_recusa := 'Oficina lotada: ' || v_ocupadas || ' de ' || v_max_veiculos ||
        ' vagas ocupadas. Assim que um veículo for liberado, um novo horário se abre.';
      NEW.autorizado_por := 'Automático (fila)';
      NEW.autorizado_em := now();
      return NEW;
    end if;

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
    raise warning 'Falha ao auto-gerar Pre-OS do agendamento %: %', NEW.protocolo, SQLERRM;
  end;
  return NEW;
end;
$$;

-- Calendário do dia: some as vagas por hora se a oficina estiver no limite físico.
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
  oficina as (
    select (public._oficina_vagas_fisicas_ocupadas(p_tenant) >= 4) as cheia
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
         case when oficina.cheia then 0 else greatest(cap.capacidade - coalesce(o.qtd, 0)::int, 0) end as vagas,
         cap.capacidade
  from horas h
  left join ocup o on o.hora = h.hora
  cross join cap
  cross join oficina
  order by h.hora;
$$;

grant execute on function public.agendamento_ocupacao_dia(text, date, int, int) to anon, authenticated;

-- Calendário do mês: mesma regra, dias ficam sem vaga (esbranquecidos) se a oficina lotar.
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
  oficina as (
    select (public._oficina_vagas_fisicas_ocupadas(p_tenant) >= 4) as cheia
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
         case when oficina.cheia then 0
              else sum(greatest(cap.capacidade - coalesce(o.qtd, 0)::int, 0))::int end as vagas_dia,
         case when oficina.cheia then false
              else bool_or(greatest(cap.capacidade - coalesce(o.qtd, 0)::int, 0) > 0) end as tem_vaga
  from grade g
  left join ocup o on o.dia = g.dia and o.hora = g.hora
  cross join cap
  cross join oficina
  group by g.dia, oficina.cheia
  order by g.dia;
$$;

grant execute on function public.agendamento_ocupacao_mes(text, int, int, int, int) to anon, authenticated;
