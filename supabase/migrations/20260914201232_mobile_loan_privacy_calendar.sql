-- Read-only mobile contract. Identity comes from Auth, never from client parameters.
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
  with vehicles as (
    select e.id from public.equipamentos e
    where e.tenant=p.tenant and not coalesce(e.excluido,false)
      and (p.nivel in ('super','admin') or exists (
        select 1 from jsonb_array_elements_text(s->'companyIds') c where c.value=e.empresa_id::text))
      and (jsonb_array_length(s->'vehicleIds')=0 or exists (
        select 1 from jsonb_array_elements_text(s->'vehicleIds') v where v.value=e.id::text))
  ), allowed as (
    select l.* from public.emprestimos_veiculos l
    join vehicles v on v.id=l.veiculo_id
    where l.tenant=p.tenant and coalesce(l.ativo,true)
  ), visible as (
    select l.* from allowed l
    where l.solicitante_usuario_id=p.id
      or ((s->'permissions') ?| array['loan.view','loan.approve','loan.release']
        and (p.nivel in ('super','admin') or p.funcao_emprestimo='diretor'
          or (p.funcao_emprestimo in ('encarregado','coordenador','gerente')
            and p.setor_id is not null and l.setor_id=p.setor_id)))
  )
  select jsonb_build_object(
    'profileId',p.id::text,
    'loans',coalesce((select jsonb_agg(jsonb_build_object(
      'id',l.id::text,'veiculo_id',l.veiculo_id::text,'motorista_id',l.motorista_id::text,
      'solicitante_usuario_id',l.solicitante_usuario_id::text,'setor_id',l.setor_id::text,
      'status',lower(l.status),'data_saida',l.data_saida,'hora_saida',l.hora_saida,
      'data_prevista_retorno',l.data_prevista_retorno,'hora_prevista_retorno',l.hora_prevista_retorno,
      'destino',l.destino,'finalidade',l.finalidade) order by l.data_saida desc,l.id desc)
      from visible l),'[]'::jsonb),
    'reservations',coalesce((select jsonb_agg(jsonb_build_object(
      'vehicleId',l.veiculo_id::text,
      'start',l.data_saida::text||'T'||coalesce(l.hora_saida::text,'00:00:00'),
      'end',coalesce(l.data_prevista_retorno,l.data_saida)::text||'T'||coalesce(l.hora_prevista_retorno::text,'23:59:59')))
      from allowed l where lower(l.status) in ('solicitado','aprovado','liberado','em_uso','devolucao_pendente')
      and l.data_saida is not null),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.get_mobile_loans() from public,anon;
grant execute on function public.get_mobile_loans() to authenticated;
