-- Remove as policies que davam acesso total SEM LOGIN (anon) aos dados do tenant
-- 'construtorabs' (vazio) em ~37 tabelas, e o update sem login de empréstimos.
-- As policies fm_tenant_* (usuários logados) continuam. Já executado em 2026-11-25.
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
            where schemaname = 'public'
              and roles = '{anon}'
              and qual = '(tenant = ''construtorabs''::text)'
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
  drop policy if exists usu_all on public.usuarios;
  drop policy if exists os_all  on public.ordens_servico;
  drop policy if exists eq_all  on public.equipamentos;
  drop policy if exists emp_all on public.empresas;
  drop policy if exists fm_emprestimos_app_update on public.emprestimos_veiculos;
end $$;
