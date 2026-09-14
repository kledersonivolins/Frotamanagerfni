begin;
select plan(8);

select has_table('public', 'mobile_devices', 'mobile_devices existe');
select has_table('public', 'mobile_operations', 'mobile_operations existe');
select has_table('public', 'mobile_audit_events', 'mobile_audit_events existe');
select has_table('public', 'mobile_attachments', 'mobile_attachments existe');
select has_column('public', 'usuarios', 'mobile_permissions', 'permissoes mobile ficam no perfil');
select has_function('public', 'get_mobile_scope', array[]::text[], 'RPC de escopo existe');
select has_function('public', 'process_mobile_operation', array['uuid','jsonb'], 'RPC idempotente existe');

set local role anon;
select throws_ok(
  $$ select public.process_mobile_operation(gen_random_uuid(), '{"operationId":"x"}'::jsonb) $$,
  '42501',
  'permission denied for function process_mobile_operation',
  'anonimo não executa sincronização'
);
reset role;

select * from finish();
rollback;
