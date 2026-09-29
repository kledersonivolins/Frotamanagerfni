-- Pedido do usuario: o agendamento (WhatsApp ou link publico) nao deve sair
-- ja "autorizado" sozinho. Fica 'pendente' ate alguem aprovar manualmente no
-- painel (fluxo ja existente de _autorizarAgendamento em index.html, que cria
-- a Pre-OS e muda o status pra 'autorizado' -- isso dispara o trigger de
-- notificacao criado na migration seguinte).
-- Mantem igual: recusa automatica quando a oficina esta sem vaga.
create or replace function public._trg_agendamento_externo_auto_pre_os()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
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

    -- Vaga existe, mas nao aprova sozinho: fica pendente pra aprovacao manual.
    NEW.status := 'pendente';
  exception when others then
    raise warning 'Falha ao processar agendamento %: %', NEW.protocolo, SQLERRM;
  end;
  return NEW;
end;
$function$;
