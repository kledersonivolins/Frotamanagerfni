-- Corrige a fila de mecânicos do agendamento externo.
--
-- Bug: o "próximo mecânico" era escolhido contando só os agendamentos_externos
-- AUTORIZADOS NAQUELE MESMO DIA (a.data = NEW.data). Como cada dia normalmente
-- só recebe 1 pedido pelo link antes de lotar, a contagem empatava em 0 para
-- todo mundo quase sempre, e o desempate (m.nome asc) sempre jogava pro mesmo
-- mecânico (o primeiro em ordem alfabética) — e nunca olhava a carga real de
-- quem já está com OS/Pré-OS aberta por outros caminhos (abertura manual,
-- chamado, preventiva). Resultado: a distribuição parecia aleatória/injusta
-- pra quem acompanha a oficina no dia a dia.
--
-- Fix: escolhe pela carga REAL e atual do mecânico (nº de OS/Pré-OS dele que
-- ainda não foram concluídas/canceladas, em qualquer origem) e, empatando,
-- por quem faz mais tempo não recebe um agendamento externo (fila justa de
-- verdade, não só "o primeiro nome do dia").
-- Aditivo: create or replace, mesma assinatura; nada é apagado.

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

    -- Próximo mecânico: menor carga real atual (OS/Pré-OS dele ainda em aberto,
    -- de qualquer origem) e, empatando, quem está há mais tempo sem receber um
    -- agendamento externo (nunca recebeu = vai primeiro).
    select m.id, m.nome into v_mecanico
    from public.mecanicos m
    where m.tenant = NEW.tenant
      and coalesce(m.ativo, true) = true
      and upper(coalesce(m.funcao, m.especialidade, '')) <> 'AJUDANTE'
    order by (
        select count(*) from public.ordens_servico o
        where o.tenant = NEW.tenant
          and o.responsavel = m.nome
          and coalesce(o.excluido, false) = false
          and lower(coalesce(o.status, '')) in ('pre_os', 'aberta', 'em_andamento', 'oficina_externa')
      ) asc,
      coalesce((
        select max(a.autorizado_em) from public.agendamentos_externos a
        where a.mecanico_id = m.id and a.status = 'autorizado'
      ), 'epoch'::timestamptz) asc,
      m.nome asc
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

-- Garante que ordens_servico manda evento em tempo real. Sem isso, quem está
-- com a tela de OS/Pré-OS aberta só vê o agendamento feito pelo link externo
-- (ele é gerado pelo gatilho no banco, não pelo navegador de ninguém) depois
-- de recarregar a página manualmente — mesmo bug que o agendamentos_externos
-- tinha antes da migration 20260921120000.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ordens_servico'
  ) then
    alter publication supabase_realtime add table public.ordens_servico;
  end if;
end $$;
