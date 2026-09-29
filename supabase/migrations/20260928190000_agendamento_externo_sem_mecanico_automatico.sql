-- O trigger que cria a Pre-OS automaticamente para qualquer agendamento
-- (WhatsApp ou link publico) tambem escolhia um mecanico pela fila de menor
-- carga. Pedido do usuario: o sistema nao deve mais escolher o mecanico --
-- a Pre-OS nasce sem responsavel, e alguem atribui manualmente no painel.
-- Mantem tudo o resto igual: checagem de limite de vagas, criacao
-- automatica da Pre-OS e status 'autorizado'.
create or replace function public._trg_agendamento_externo_auto_pre_os()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
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

    select lpad((coalesce(max(numero::int), 0) + 1)::text, 4, '0') into v_numero
    from public.ordens_servico
    where tenant = NEW.tenant and numero ~ '^[0-9]+$';

    v_os_id := (extract(epoch from clock_timestamp()) * 1000)::bigint;

    -- Sem mecanico: responsavel fica nulo, alguem atribui depois no painel.
    insert into public.ordens_servico (
      id, numero, equipamento_id, empresa_id, tipo, tipo_abertura, status, origem,
      data_abertura, data_previsao, solicitante, oficina, descricao, custo,
      responsavel, obs, tenant
    ) values (
      v_os_id, coalesce(v_numero, '0001'), NEW.veiculo_id, NEW.empresa_id,
      coalesce(NEW.tipo_servico, 'Manutenção'), 'Pre-OS', 'pre_os', 'agendamento_externo',
      (now() at time zone 'America/Fortaleza')::date, NEW.data, NEW.nome_solicitante,
      'Agendamento externo', NEW.descricao, 0,
      null,
      'Protocolo externo: ' || coalesce(NEW.protocolo, ''),
      NEW.tenant
    );

    NEW.status := 'autorizado';
    NEW.pre_os_id := v_os_id;
    NEW.mecanico_id := null;
    NEW.mecanico_nome := null;
    NEW.autorizado_por := 'Automático (fila)';
    NEW.autorizado_em := now();
  exception when others then
    raise warning 'Falha ao auto-gerar Pre-OS do agendamento %: %', NEW.protocolo, SQLERRM;
  end;
  return NEW;
end;
$function$;
