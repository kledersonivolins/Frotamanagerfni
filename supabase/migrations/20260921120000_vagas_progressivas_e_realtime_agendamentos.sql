-- Vagas progressivas do agendamento externo + aviso em tempo real + fim da duplicidade.
--
-- 1) Realtime: agendamentos_externos nunca esteve na publicação supabase_realtime, então o app
--    não recebia o evento de "novo agendamento" (toast) nem atualizava a tela sozinho.
--
-- 2) Vagas progressivas: todo veículo agendado (Pré-OS) ou em atendimento (aberta / em_andamento /
--    oficina_externa) que ainda NÃO recebeu baixa (concluída/cancelada) continua ocupando 1 vaga da
--    oficina daquela data em diante. Ou seja, quanto mais agendamentos sem baixa, menos vagas nos
--    dias seguintes; quando chega ao limite, nenhum dia novo abre até alguém dar baixa.
--      ocupadas(dia) = nº de veículos distintos com OS de agendamento sem baixa e data <= dia
--      vagas(dia)    = max(limite - ocupadas(dia), 0)
--    Conta só OS de origem agendamento_externo / agendamento_operador (a frota inteira roda ~30 OS
--    abertas e não pode entrar na conta — ver 20260921000000_fix_limite_escopo_agendamento_externo).
--
-- 3) agendamento_disponibilidade não olhava status 'autorizado' (o que o gatilho grava), então o
--    mesmo veículo conseguia 2 agendamentos no mesmo horário. Agora olha.
--
-- Aditivo: create or replace com as mesmas assinaturas; nada é apagado.

-- ── 1) Realtime ─────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'agendamentos_externos'
  ) then
    alter publication supabase_realtime add table public.agendamentos_externos;
  end if;
end $$;

-- ── 2) Vagas progressivas ───────────────────────────────────────────────────

-- Limite de veículos da oficina. Para mudar (ex.: 5), altere só este número.
create or replace function public._oficina_limite_veiculos(p_tenant text)
returns int
language sql
immutable
as $$ select 4 $$;

-- Data de uma OS a partir das colunas de texto (previsão, senão abertura). Nunca lança erro.
create or replace function public._oficina_data_os(p_previsao text, p_abertura text)
returns date
language plpgsql
immutable
as $$
begin
  begin
    if coalesce(p_previsao, '') ~ '^\d{4}-\d{2}-\d{2}' then return left(p_previsao, 10)::date; end if;
  exception when others then null;
  end;
  begin
    if coalesce(p_abertura, '') ~ '^\d{4}-\d{2}-\d{2}' then return left(p_abertura, 10)::date; end if;
  exception when others then null;
  end;
  return null;
end;
$$;

-- Veículos distintos com OS de agendamento ainda sem baixa, com data até p_dia (inclusive).
create or replace function public._oficina_ocupacao_no_dia(p_tenant text, p_dia date)
returns int
language sql
security definer
set search_path = public
stable
as $$
  select count(distinct o.equipamento_id)::int
  from public.ordens_servico o
  where o.tenant = p_tenant
    and coalesce(o.excluido, false) = false
    and o.origem in ('agendamento_externo', 'agendamento_operador')
    and lower(coalesce(o.status, '')) in ('pre_os', 'aberta', 'em_andamento', 'oficina_externa')
    and public._oficina_data_os(o.data_previsao, o.data_abertura) <= p_dia;
$$;

-- Gatilho: recusa automaticamente quando a data pedida já está sem vaga (mesma conta do calendário).
-- Um agendamento na data D reduz as vagas de D em diante; datas anteriores a D não são afetadas.
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
  v_limite int;
  v_ocupadas int;
  v_ja_na_fila boolean;
begin
  begin
    v_limite := public._oficina_limite_veiculos(NEW.tenant);

    -- veículo que já está na fila (Pré-OS/OS sem baixa) não ocupa uma vaga nova
    select exists (
      select 1 from public.ordens_servico o
      where o.tenant = NEW.tenant
        and o.equipamento_id = NEW.veiculo_id
        and coalesce(o.excluido, false) = false
        and o.origem in ('agendamento_externo', 'agendamento_operador')
        and lower(coalesce(o.status, '')) in ('pre_os', 'aberta', 'em_andamento', 'oficina_externa')
    ) into v_ja_na_fila;

    v_ocupadas := public._oficina_ocupacao_no_dia(NEW.tenant, NEW.data);

    if not v_ja_na_fila and v_ocupadas >= v_limite then
      NEW.status := 'recusado';
      NEW.motivo_recusa := 'Oficina sem vagas: ' || v_ocupadas || ' de ' || v_limite ||
        ' veículos já agendados ou em atendimento, aguardando baixa. Assim que um deles for concluído, uma vaga se abre.';
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
    -- se algo aqui falhar, o pedido não se perde: fica pendente pra aprovação manual, como antes
    raise warning 'Falha ao auto-gerar Pre-OS do agendamento %: %', NEW.protocolo, SQLERRM;
  end;
  return NEW;
end;
$$;

-- Calendário do dia: as vagas de cada horário nunca passam das vagas restantes da oficina no dia.
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
    select greatest(public._oficina_limite_veiculos(p_tenant) - public._oficina_ocupacao_no_dia(p_tenant, p_data), 0) as restantes
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
         least(greatest(cap.capacidade - coalesce(o.qtd, 0)::int, 0), oficina.restantes) as vagas,
         cap.capacidade
  from horas h
  left join ocup o on o.hora = h.hora
  cross join cap
  cross join oficina
  order by h.hora;
$$;

grant execute on function public.agendamento_ocupacao_dia(text, date, int, int) to anon, authenticated;

-- Calendário do mês: cada dia usa as vagas restantes dele; dia sem vaga fica esbranquiçado.
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
  restantes as (
    select d.dia,
           greatest(public._oficina_limite_veiculos(p_tenant) - public._oficina_ocupacao_no_dia(p_tenant, d.dia), 0) as vagas
    from dias d
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
  ),
  livres as (
    select g.dia,
           sum(greatest(cap.capacidade - coalesce(o.qtd, 0)::int, 0))::int as vagas_horarios
    from grade g
    left join ocup o on o.dia = g.dia and o.hora = g.hora
    cross join cap
    group by g.dia
  )
  select l.dia,
         least(l.vagas_horarios, r.vagas)::int as vagas_dia,
         least(l.vagas_horarios, r.vagas) > 0 as tem_vaga
  from livres l
  join restantes r on r.dia = l.dia
  order by l.dia;
$$;

grant execute on function public.agendamento_ocupacao_mes(text, int, int, int, int) to anon, authenticated;

-- ── 3) Fim da duplicidade ───────────────────────────────────────────────────
-- Mesma função de antes, só que o conflito de horário agora também enxerga 'autorizado'.
create or replace function public.agendamento_disponibilidade(
  p_tenant text,
  p_veiculo_id bigint,
  p_inicio timestamptz,
  p_fim timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_status text; v_ocupado boolean;
begin
  if p_tenant <> 'oficinafni' or p_inicio >= p_fim then
    return jsonb_build_object('disponivel', false, 'motivo', 'Dados de consulta inválidos.');
  end if;
  select status into v_status from equipamentos where id=p_veiculo_id and tenant=p_tenant;
  if not found then return jsonb_build_object('disponivel', false, 'motivo', 'Veículo não encontrado.'); end if;
  if lower(coalesce(v_status,'')) in ('manutencao','em_manutencao','oficina','oficina_externa','inativo') then
    return jsonb_build_object('disponivel', false, 'motivo', 'Veículo já está indisponível para manutenção.');
  end if;
  if exists (select 1 from ordens_servico o where o.tenant=p_tenant and o.equipamento_id=p_veiculo_id
      and coalesce(o.excluido,false)=false and lower(coalesce(o.status,'')) in ('aberta','em_andamento','oficina_externa')) then
    return jsonb_build_object('disponivel', false, 'motivo', 'Há uma ordem de serviço aberta para este veículo.');
  end if;
  select exists(select 1 from agendamentos_externos a where a.tenant=p_tenant and a.veiculo_id=p_veiculo_id
    and a.status in ('pendente','confirmado','autorizado') and a.horario_inicio < p_fim and a.horario_fim > p_inicio) into v_ocupado;
  return jsonb_build_object('disponivel', not v_ocupado,
    'motivo', case when v_ocupado then 'Já existe agendamento para esta placa neste horário.' else 'Veículo disponível para este horário.' end);
end;
$$;
