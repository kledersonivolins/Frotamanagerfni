-- O mesmo responsável que aprova pode recusar uma solicitação do seu setor.
-- O motivo e os dados da decisão usam os campos de autorização já existentes.
drop function if exists public.transition_mobile_loan(bigint,text);

create function public.transition_mobile_loan(
  p_loan_id bigint,
  p_action text,
  p_reason text default null
)
returns jsonb language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare
  p public.usuarios%rowtype;
  l public.emprestimos_veiculos%rowtype;
  action_name text := lower(btrim(coalesce(p_action,'')));
  reason_text text := btrim(coalesce(p_reason,''));
  current_status text;
  allowed_approver boolean;
begin
  if auth.uid() is null then raise insufficient_privilege using message='Autenticação obrigatória'; end if;
  select * into p from public.usuarios
    where auth_user_id=auth.uid() and coalesce(ativo,true) and not coalesce(excluido,false)
      and not coalesce(pendente_aprovacao,false)
    order by id limit 1;
  if not found then raise insufficient_privilege using message='Usuário inativo ou sem perfil'; end if;
  if not coalesce((p.mobile_permissions->>'mobile.access')::boolean,false) then
    raise insufficient_privilege using message='Acesso ao aplicativo não liberado';
  end if;

  select * into l from public.emprestimos_veiculos
    where id=p_loan_id and tenant=p.tenant and coalesce(ativo,true) for update;
  if not found then raise invalid_parameter_value using message='Solicitação não encontrada no seu escopo'; end if;

  current_status := lower(coalesce(l.status,''));
  allowed_approver := p.nivel in ('super','admin') or p.funcao_emprestimo='diretor'
    or (p.funcao_emprestimo in ('encarregado','coordenador','gerente')
      and p.setor_id is not null and l.setor_id=p.setor_id);

  if action_name in ('approve','reject') then
    if not allowed_approver then raise insufficient_privilege using message='Solicitação fora do seu setor'; end if;
    if not coalesce((p.mobile_permissions->>'loan.approve')::boolean,false) then
      raise insufficient_privilege using message='Permissão para decidir solicitações não liberada';
    end if;
    if current_status<>'solicitado' then
      raise invalid_parameter_value using message='Somente solicitações pendentes podem ser decididas';
    end if;
    if action_name='reject' and reason_text='' then
      raise invalid_parameter_value using message='Informe o motivo da recusa';
    end if;
    update public.emprestimos_veiculos
      set status=case when action_name='approve' then 'aprovado' else 'recusado' end,
          autorizacao_tipo='sistema',autorizador_usuario_id=p.id,
          autorizador_nome=coalesce(nullif(p.nome,''),nullif(p.username,''),p.email),
          autorizador_cargo=p.funcao_emprestimo,autorizacao_registrada_por_id=p.id,
          autorizacao_em=clock_timestamp(),
          autorizacao_observacao=case when action_name='reject' then reason_text else null end
      where id=l.id;
  elsif action_name='release' then
    if p.nivel not in ('super','admin') then
      raise insufficient_privilege using message='Somente a Frota pode registrar a saída do veículo';
    end if;
    if not coalesce((p.mobile_permissions->>'loan.release')::boolean,false) then
      raise insufficient_privilege using message='Permissão para liberar não liberada';
    end if;
    if current_status<>'aprovado' then
      raise invalid_parameter_value using message='Somente solicitações aprovadas podem ser liberadas';
    end if;
    update public.emprestimos_veiculos set status='em_uso' where id=l.id;
  else
    raise invalid_parameter_value using message='Ação de empréstimo inválida';
  end if;

  select * into l from public.emprestimos_veiculos where id=l.id;
  return jsonb_build_object('id',l.id::text,'status',lower(l.status),'action',action_name,
    'reason',l.autorizacao_observacao);
end;
$$;

revoke all on function public.transition_mobile_loan(bigint,text,text) from public,anon;
grant execute on function public.transition_mobile_loan(bigint,text,text) to authenticated;

create or replace function public.get_mobile_loans()
returns jsonb language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare
  p public.usuarios%rowtype;
  s jsonb;
  result jsonb;
begin
  s := public.get_mobile_scope();
  select * into strict p from public.usuarios
    where auth_user_id=auth.uid() and tenant=s->>'tenant'
      and coalesce(ativo,true) and not coalesce(excluido,false)
    order by id limit 1;
  if not ((s->'permissions') ?| array['loan.request','loan.view','loan.approve','loan.release','loan.checklist']) then
    raise insufficient_privilege using message='Empréstimos não liberados';
  end if;

  with authorized_vehicles as (
    select e.id,e.placa,e.modelo from public.equipamentos e
    where e.tenant=p.tenant and not coalesce(e.excluido,false)
      and (p.nivel in ('super','admin') or exists (
        select 1 from jsonb_array_elements_text(s->'companyIds') c where c.value=e.empresa_id::text))
      and (jsonb_array_length(s->'vehicleIds')=0 or exists (
        select 1 from jsonb_array_elements_text(s->'vehicleIds') v where v.value=e.id::text))
  ), tenant_loans as (
    select l.* from public.emprestimos_veiculos l
    where l.tenant=p.tenant and coalesce(l.ativo,true)
  ), visible as (
    select l.* from tenant_loans l
    where l.solicitante_usuario_id=p.id
      or ((s->'permissions') ?| array['loan.view','loan.approve','loan.release']
        and (p.nivel in ('super','admin') or p.funcao_emprestimo='diretor'
          or (p.funcao_emprestimo in ('encarregado','coordenador','gerente')
            and p.setor_id is not null and l.setor_id=p.setor_id)))
  ), reservation_loans as (
    select l.* from tenant_loans l
    where lower(l.status) in ('solicitado','aprovado','liberado','em_uso','devolucao_pendente')
      and l.data_saida is not null
      and (exists (select 1 from authorized_vehicles av where av.id=l.veiculo_id)
        or exists (select 1 from visible vl where vl.id=l.id))
  ), calendar_vehicle_ids as (
    select id from authorized_vehicles union select veiculo_id from visible
  ), calendar_vehicles as (
    select e.id,e.placa,e.modelo from public.equipamentos e
    join calendar_vehicle_ids cv on cv.id=e.id
    where e.tenant=p.tenant and not coalesce(e.excluido,false)
  )
  select jsonb_build_object(
    'profileId',p.id::text,
    'loans',coalesce((select jsonb_agg(jsonb_build_object(
      'id',l.id::text,'veiculo_id',l.veiculo_id::text,'motorista_id',l.motorista_id::text,
      'solicitante_usuario_id',l.solicitante_usuario_id::text,'setor_id',l.setor_id::text,
      'status',lower(l.status),'data_saida',l.data_saida,'hora_saida',l.hora_saida,
      'data_prevista_retorno',l.data_prevista_retorno,'hora_prevista_retorno',l.hora_prevista_retorno,
      'destino',l.destino,'finalidade',l.finalidade,
      'checklist_saida_obrigatorio',coalesce(l.checklist_saida_obrigatorio,false),
      'checklist_saida_status',l.checklist_saida_status,
      'motivo_recusa',case when lower(l.status)='recusado' then l.autorizacao_observacao end,
      'decidido_por',l.autorizador_nome,'decidido_em',l.autorizacao_em) order by l.data_saida desc,l.id desc)
      from visible l),'[]'::jsonb),
    'reservations',coalesce((select jsonb_agg(jsonb_build_object(
      'vehicleId',l.veiculo_id::text,
      'start',l.data_saida::text||'T'||coalesce(l.hora_saida::text,'00:00:00'),
      'end',coalesce(l.data_prevista_retorno,l.data_saida)::text||'T'||coalesce(l.hora_prevista_retorno::text,'23:59:59')))
      from reservation_loans l),'[]'::jsonb),
    'calendarVehicles',coalesce((select jsonb_agg(jsonb_build_object(
      'id',v.id::text,'placa',v.placa,'modelo',v.modelo) order by v.placa,v.id)
      from calendar_vehicles v),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.get_mobile_loans() from public,anon;
grant execute on function public.get_mobile_loans() to authenticated;
