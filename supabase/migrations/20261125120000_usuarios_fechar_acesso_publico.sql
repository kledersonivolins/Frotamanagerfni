-- Fecha o acesso sem login à tabela usuarios (tenant oficinafni e demais).
--
-- Antes: as policies "login_direto" e "usr_select_pub" deixavam QUALQUER pessoa
-- (sem login, só com a chave pública do site) ler todos os usuários, inclusive a
-- coluna password; e "fm_usuarios_app_update" deixava qualquer pessoa sem login
-- ALTERAR usuários (nível, ativo, auth_user_id...). Além disso, "usuarios_update_proprio"
-- permitia que um usuário logado mudasse o próprio nível para admin/super.
--
-- Depois:
--   * a tela de login e o cadastro usam duas funções que devolvem só o necessário;
--   * leitura: o próprio usuário e os administradores da empresa (policies fm_* já existentes);
--   * alteração: o próprio usuário (sem poder mudar nível/acesso) e administradores;
--   * o cadastro público continua (insert anon), protegido pelo trigger
--     trg_usuarios_cadastro_publico.
-- Pode rodar mais de uma vez.

-- 1) Tela de login: descobre e-mail e situação do usuário, sem expor a linha inteira.
create or replace function public.fm_login_info(p_tenant text, p_login text)
returns table(id bigint, email text, pendente_aprovacao boolean, ativo boolean, excluido boolean)
language sql stable security definer set search_path = public as $$
  select u.id, u.email, coalesce(u.pendente_aprovacao,false), coalesce(u.ativo,false), coalesce(u.excluido,false)
    from public.usuarios u
   where u.tenant = p_tenant
     and length(coalesce(p_login,'')) > 0
     and (u.username = p_login or lower(u.email) = lower(p_login))
   order by coalesce(u.excluido,false), u.id
   limit 1;
$$;

-- 2) Cadastro "Solicitar acesso": diz só se o e-mail ou o usuário já estão em uso.
create or replace function public.fm_cadastro_conflito(p_tenant text, p_username text, p_email text)
returns text
language sql stable security definer set search_path = public as $$
  select case
           when exists (select 1 from public.usuarios u where u.tenant = p_tenant and lower(u.email) = lower(p_email)) then 'email'
           when exists (select 1 from public.usuarios u where u.tenant = p_tenant and u.username = p_username) then 'username'
         end;
$$;

revoke all on function public.fm_login_info(text, text) from public;
revoke all on function public.fm_cadastro_conflito(text, text, text) from public;
grant execute on function public.fm_login_info(text, text) to anon, authenticated;
grant execute on function public.fm_cadastro_conflito(text, text, text) to anon, authenticated;

-- 3) Remove as policies abertas.
drop policy if exists login_direto on public.usuarios;
drop policy if exists usr_select_pub on public.usuarios;
drop policy if exists fm_usuarios_app_update on public.usuarios;

-- 4) Administradores (admin ou super) da empresa podem alterar usuários dela
--    (aprovar pedidos, editar módulos, desativar).
drop policy if exists fm_usuarios_update_admin on public.usuarios;
create policy fm_usuarios_update_admin on public.usuarios
  for update to authenticated
  using (fm_is_real_auth_user() and tenant = fm_user_tenant() and (fm_is_admin() or fm_is_super()))
  with check (tenant = fm_user_tenant());

-- 5) Quem não é administrador não muda nível, acesso, empresa nem vínculo de login
--    (nem o próprio). Só super promove alguém a super.
create or replace function public.fm_usuarios_protege_campos()
-- (sem security definer: current_user precisa ser o papel de quem chamou)
returns trigger language plpgsql set search_path = public as $$
declare
  v_admin boolean;
  v_super boolean;
begin
  -- edge functions (service role) e o próprio banco não passam por aqui
  if coalesce(auth.role(), '') = 'service_role' or current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;
  v_super := coalesce(fm_is_super(), false);
  v_admin := v_super or coalesce(fm_is_admin(), false);
  if not v_admin then
    new.nivel              := old.nivel;
    new.ativo              := old.ativo;
    new.pendente_aprovacao := old.pendente_aprovacao;
    new.excluido           := old.excluido;
    new.modulos_liberados  := old.modulos_liberados;
    new.empresas           := old.empresas;
    new.mobile_permissions := old.mobile_permissions;
    new.tenant             := old.tenant;
    new.auth_user_id       := old.auth_user_id;
  elsif not v_super and new.nivel = 'super' and old.nivel is distinct from 'super' then
    new.nivel := old.nivel;
  end if;
  return new;
end; $$;

drop trigger if exists trg_usuarios_protege_campos on public.usuarios;
create trigger trg_usuarios_protege_campos before update on public.usuarios
  for each row execute function public.fm_usuarios_protege_campos();
