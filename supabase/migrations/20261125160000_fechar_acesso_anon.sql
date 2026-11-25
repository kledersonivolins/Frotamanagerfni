-- Fecha TODO acesso sem login (role anon) às tabelas, depois de desligar os links
-- públicos no site (painel TV, frentista, motorista, portaria, chamado, agendamento
-- externo, checklists, links de OS).
--
-- Regras:
--   * policy só para anon            -> removida;
--   * policy para anon + authenticated, ou para "public" (todos):
--       - se a tabela já tem as policies por empresa (fm_tenant_*), é removida
--         (senão qualquer conta recém-cadastrada, ainda pendente, leria/alteraria tudo);
--       - se não tem, passa a valer só para authenticated (logado continua como antes);
--   * exceção: usuarios.fm_usuarios_app_insert continua para anon (cadastro
--     "Solicitar acesso", protegido pelo trigger trg_usuarios_cadastro_publico).
--   * funções do agendamento externo deixam de ser chamáveis sem login.
-- Nada é apagado de dados. Pode rodar mais de uma vez.

do $$
declare
  r record;
  novos name[];
begin
  for r in
    select tablename, policyname, roles
      from pg_policies
     where schemaname = 'public'
       and roles && array['anon','public']::name[]
  loop
    if r.tablename = 'usuarios' and r.policyname = 'fm_usuarios_app_insert' then
      continue;
    end if;
    novos := array(select x from unnest(r.roles) x where x not in ('anon','public'));
    if 'public' = any(r.roles) and not ('authenticated' = any(novos)) then
      novos := novos || 'authenticated'::name;
    end if;
    if coalesce(array_length(novos, 1), 0) = 0
       or exists (select 1 from pg_policies t
                   where t.schemaname = 'public' and t.tablename = r.tablename
                     and t.policyname like 'fm\_tenant\_%') then
      execute format('drop policy %I on public.%I', r.policyname, r.tablename);
    else
      execute format('alter policy %I on public.%I to %s', r.policyname, r.tablename,
                     (select string_agg(quote_ident(x), ', ') from unnest(novos) x));
    end if;
  end loop;
end $$;

-- funções do agendamento externo: só para quem está logado
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as assinatura
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'agendamento\_%'
  loop
    execute format('revoke execute on function %s from public, anon', f.assinatura);
    execute format('grant execute on function %s to authenticated, service_role', f.assinatura);
  end loop;
end $$;
