-- Requires 008_server_sync_cursor.sql.
-- Postgres grants EXECUTE on new functions to PUBLIC, so the grant in 008 alone
-- still let signed-out (anon) callers use the sync cursor RPC. Only signed-in
-- users sync, so restrict it to authenticated. No table, data or RLS changes.

revoke execute on function public.sync_server_time() from public;
revoke execute on function public.sync_server_time() from anon;
grant execute on function public.sync_server_time() to authenticated;

notify pgrst, 'reload schema';
