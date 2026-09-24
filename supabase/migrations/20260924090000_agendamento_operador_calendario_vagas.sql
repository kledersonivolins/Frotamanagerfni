-- Leva pro "Agendar Manutenção" (operador, tela interna) o mesmo calendário de
-- vagas do link externo: limite sobe de 4 para 5 veículos simultâneos (mesma
-- pool das duas telas — _oficina_ocupacao_no_dia já conta 'agendamento_operador'
-- junto com 'agendamento_externo' desde a migration de vagas progressivas) e
-- ganha proteção no banco contra estourar o limite, que hoje só existia pro
-- link externo (o formulário interno inseria a Pré-OS direto em ordens_servico,
-- sem checar vaga nenhuma).
--
-- Também adiciona duas colunas usadas pelo novo formulário: motorista
-- responsável (texto livre) e km/horímetro atual informado no agendamento.
--
-- Aditivo: create or replace nas funções existentes (mesma assinatura); só
-- cria trigger e colunas novas, nada é apagado.

-- Limite físico da oficina: 4 -> 5 vagas simultâneas.
create or replace function public._oficina_limite_veiculos(p_tenant text)
returns int
language sql
immutable
as $$ select 5 $$;

-- Motorista/km informados ao agendar pelo operador (tela interna).
alter table public.ordens_servico
  add column if not exists motorista_responsavel text,
  add column if not exists km_atual_agendamento numeric;

-- Trava de vaga pro formulário interno: mesma regra do link externo (recusa
-- automática quando a oficina já está no limite pra aquela data), só que via
-- exceção — ordens_servico não tem um status "recusado" como
-- agendamentos_externos, então a Pré-OS simplesmente não chega a ser criada
-- e o app mostra o erro pro operador tentar outro dia/horário. A checagem no
-- client (_salvarAgendamentoOperador) já revalida antes de enviar; este
-- trigger é o backstop caso o client esteja desatualizado ou seja
-- contornado.
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
  if NEW.origem is distinct from 'agendamento_operador' or lower(coalesce(NEW.status, '')) <> 'pre_os' then
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

drop trigger if exists trg_agendamento_operador_limite_vagas on public.ordens_servico;
create trigger trg_agendamento_operador_limite_vagas
  before insert on public.ordens_servico
  for each row
  execute function public._trg_agendamento_operador_limite_vagas();
