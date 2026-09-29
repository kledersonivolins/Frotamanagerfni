-- Quando um agendamento externo (WhatsApp ou link publico) passa de
-- 'pendente' para 'autorizado' -- ou seja, alguem converteu/aprovou --
-- avisa a Evolution API (grupo e, se o contato for telefone, o cliente)
-- via a function whatsapp-notificar-aprovacao. A service role key vem do
-- Vault (secret 'service_role_key'), nunca em texto puro na função.
create or replace function public._trg_agendamento_externo_notificar_aprovacao()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_key text;
  v_numero_os text;
begin
  if NEW.status = 'autorizado' and coalesce(OLD.status, '') <> 'autorizado' then
    begin
      select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
      if v_key is null then
        raise warning 'service_role_key nao encontrada no vault; notificacao de aprovacao pulada para %', NEW.protocolo;
        return NEW;
      end if;

      if NEW.pre_os_id is not null then
        select numero into v_numero_os from public.ordens_servico where id = NEW.pre_os_id::bigint;
      end if;

      perform net.http_post(
        url := 'https://gocdyfhzqezpqyebixid.supabase.co/functions/v1/whatsapp-notificar-aprovacao',
        headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'protocolo', NEW.protocolo,
          'contato', NEW.contato,
          'nomeSolicitante', NEW.nome_solicitante,
          'empresaNome', NEW.empresa_nome,
          'placa', NEW.placa,
          'numeroOS', v_numero_os
        )
      );
    exception when others then
      raise warning 'Falha ao notificar aprovacao do agendamento %: %', NEW.protocolo, SQLERRM;
    end;
  end if;
  return NEW;
end;
$function$;

drop trigger if exists trg_agendamento_externo_notificar_aprovacao on public.agendamentos_externos;
create trigger trg_agendamento_externo_notificar_aprovacao
  after update on public.agendamentos_externos
  for each row
  execute function public._trg_agendamento_externo_notificar_aprovacao();
