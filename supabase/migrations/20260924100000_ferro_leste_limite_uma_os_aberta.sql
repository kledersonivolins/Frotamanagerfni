-- Regra específica da FERRO LESTE (empresa_id 1778591635572, código FL): enquanto
-- ela tiver 1 OS de agendamento aberta (Pré-OS, aberta, em andamento ou na
-- oficina externa) sem baixa, nenhum novo agendamento dela é aceito — nem pelo
-- operador, nem pelo link externo. Isso é ADICIONAL ao limite geral de vagas da
-- oficina (_oficina_limite_veiculos): mesmo sobrando vaga no total, a FERRO
-- LESTE fica travada em no máximo 1 por vez. As outras empresas do tenant
-- (FERRO NORTE INDUSTRIAL, TELA NORTE) não são afetadas.
--
-- Também amplia o gatilho de vaga (que hoje só olhava origem
-- 'agendamento_operador') para cobrir 'agendamento_externo' também — o pedido
-- pelo link insere a Pré-OS diretamente em ordens_servico dentro do próprio
-- gatilho dele, então esta trava precisa valer pros dois canais igual.
--
-- Aditivo: create or replace, mesma assinatura/trigger; nada é apagado.

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
  v_ferro_leste constant bigint := 1778591635572;
  v_ferro_leste_tem_aberta boolean;
begin
  if NEW.origem not in ('agendamento_operador', 'agendamento_externo') or lower(coalesce(NEW.status, '')) <> 'pre_os' then
    return NEW;
  end if;

  -- FERRO LESTE: no máximo 1 OS de agendamento aberta por vez, além do limite geral.
  if NEW.empresa_id = v_ferro_leste then
    select exists (
      select 1 from public.ordens_servico o
      where o.tenant = NEW.tenant
        and o.empresa_id = v_ferro_leste
        and coalesce(o.excluido, false) = false
        and o.origem in ('agendamento_externo', 'agendamento_operador')
        and lower(coalesce(o.status, '')) in ('pre_os', 'aberta', 'em_andamento', 'oficina_externa')
    ) into v_ferro_leste_tem_aberta;

    if v_ferro_leste_tem_aberta then
      raise exception 'FERRO LESTE já tem uma OS aberta na oficina. Só é possível agendar outro veículo depois que essa OS for concluída.'
        using errcode = 'P0001';
    end if;
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
