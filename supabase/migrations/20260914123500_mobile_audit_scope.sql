drop policy if exists mobile_audit_events_tenant on public.mobile_audit_events;
create policy mobile_audit_events_own on public.mobile_audit_events
  for select to authenticated
  using (tenant = public.fm_user_tenant() and user_id = auth.uid());
