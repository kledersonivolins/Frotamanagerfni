-- Pedido do usuario: remover a trava especifica da FERRO LESTE que limitava
-- a 1 OS de agendamento aberta por vez (introduzida na migration
-- 20260924100000_ferro_leste_limite_uma_os_aberta.sql). Ela passa a seguir
-- a mesma regra geral das outras empresas do tenant (limite de vagas da
-- oficina em _oficina_limite_veiculos / _oficina_ocupacao_no_dia), sem o
-- bloqueio adicional de "so 1 por vez".

create or replace function public._trg_agendamento_operador_limite_vagas()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limite int;
  v_ocupadas int;
  v_dia date;
  v_ja_na_fila boolean;
begin
  if NEW.origem not in ('agendamento_operador', 'agendamento_externo') or lower(coalesce(NEW.status, '')) <> 'pre_os' then
    return NEW;
  end if;

  v_dia := public._oficina_data_os(NEW.data_previsao::text, NEW.data_abertura::text);
  if v_dia is null then
    return NEW; -- sem data não dá pra checar vaga; mesma tolerância do agendamento externo
  end if;

  -- veículo que já está na fila (Pré-OS/OS sem baixa) não ocupa uma vaga nova
  select exists (
    select 1 from public.ordens_servico o
    where o.tenant = NEW.tenant
      and o.equipamento_id = NEW.equipamento_id
      and coalesce(o.excluido, false) = false
      and o.origem in ('agendamento_externo', 'agendamento_operador')
      and lower(coalesce(o.status, '')) in ('pre_os', 'aberta', 'em_andamento', 'oficina_externa')
  ) into v_ja_na_fila;

  if v_ja_na_fila then
    return NEW;
  end if;

  v_limite := public._oficina_limite_veiculos(NEW.tenant);
  v_ocupadas := public._oficina_ocupacao_no_dia(NEW.tenant, v_dia);

  if v_ocupadas >= v_limite then
    raise exception 'Oficina sem vagas: % de % veículos já agendados ou em atendimento, aguardando baixa. Assim que um deles for concluído, uma vaga se abre.', v_ocupadas, v_limite
      using errcode = 'P0001';
  end if;

  return NEW;
end;
$$;
