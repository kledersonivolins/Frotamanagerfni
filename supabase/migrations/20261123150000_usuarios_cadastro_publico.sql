-- ═══════════════════════════════════════════════════════════════════
--  MULTIUSUÁRIO — proteção do cadastro público ("Solicitar acesso")
--  Quem se cadastra sem estar logado como administrador SEMPRE entra como
--  operador, inativo e pendente de aprovação, sem senha na tabela e sem módulos.
--  Assim ninguém consegue se cadastrar já como admin/super alterando o navegador.
--  Administradores logados (Supabase Auth) continuam criando usuários normalmente.
--  Pode rodar mais de uma vez.
-- ═══════════════════════════════════════════════════════════════════
create or replace function public.fm_usuarios_cadastro_publico()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.usuarios u
     where u.auth_user_id = auth.uid()
       and u.tenant = new.tenant
       and u.ativo is true
       and coalesce(u.excluido, false) = false
       and u.nivel in ('admin', 'super')
  ) then
    new.nivel := 'operador';
    new.ativo := false;
    new.pendente_aprovacao := true;
    new.password := null;
    new.modulos_liberados := '[]';
    new.empresas := '[]';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_usuarios_cadastro_publico on public.usuarios;
create trigger trg_usuarios_cadastro_publico
  before insert on public.usuarios
  for each row execute function public.fm_usuarios_cadastro_publico();
