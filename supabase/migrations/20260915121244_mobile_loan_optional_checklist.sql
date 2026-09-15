-- O checklist continua disponível como registro opcional, mas não bloqueia a
-- liberação do veículo após a aprovação.
create or replace function public.transition_mobile_loan(p_loan_id bigint,p_action text)
returns jsonb language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare
  p public.usuarios%rowtype;
  l public.emprestimos_veiculos%rowtype;
  action_name text := lower(btrim(coalesce(p_action,'')));
  current_status text;
  allowed_role boolean;
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
  if not found then raise invalid_parameter_value using message='Solicitação não encontrada no seu setor'; end if;
  allowed_role := p.nivel in ('super','admin') or p.funcao_emprestimo='diretor'
    or (p.funcao_emprestimo in ('encarregado','coordenador','gerente')
      and p.setor_id is not null and l.setor_id=p.setor_id);
  if not allowed_role then raise insufficient_privilege using message='Solicitação fora do seu setor'; end if;

  current_status := lower(coalesce(l.status,''));
  if action_name='approve' then
    if not coalesce((p.mobile_permissions->>'loan.approve')::boolean,false) then
      raise insufficient_privilege using message='Permissão para aprovar não liberada';
    end if;
    if current_status<>'solicitado' then
      raise invalid_parameter_value using message='Somente solicitações pendentes podem ser aprovadas';
    end if;
    update public.emprestimos_veiculos
      set status='aprovado',autorizacao_tipo='sistema',autorizador_usuario_id=p.id,
          autorizador_nome=coalesce(nullif(p.nome,''),nullif(p.username,''),p.email),
          autorizador_cargo=p.funcao_emprestimo,autorizacao_registrada_por_id=p.id,
          autorizacao_em=clock_timestamp()
      where id=l.id;
  elsif action_name='release' then
    if not coalesce((p.mobile_permissions->>'loan.release')::boolean,false) then
      raise insufficient_privilege using message='Permissão para liberar não liberada';
    end if;
    if current_status<>'aprovado' then
      raise invalid_parameter_value using message='Somente solicitações aprovadas podem ser liberadas';
    end if;
    update public.emprestimos_veiculos set status='liberado' where id=l.id;
  else
    raise invalid_parameter_value using message='Ação de empréstimo inválida';
  end if;

  select * into l from public.emprestimos_veiculos where id=l.id;
  return jsonb_build_object('id',l.id::text,'status',lower(l.status),'action',action_name);
end;
$$;

revoke all on function public.transition_mobile_loan(bigint,text) from public,anon;
grant execute on function public.transition_mobile_loan(bigint,text) to authenticated;
