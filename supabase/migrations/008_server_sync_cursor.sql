-- Server-assigned change stamp used as the incremental pull cursor.
-- updated_at stays client-controlled for last-write-wins conflict resolution.
-- server_updated_at is always the server clock at insert/update, so a row created
-- offline and uploaded hours later is still newer than every device's cursor.
-- Adding the column stamps existing rows with the migration time, so every
-- device re-downloads everything once on its next sync.

create or replace function public.set_server_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.server_updated_at = clock_timestamp();
  return new;
end;
$$;

-- Devices read the server clock before pulling and store it as their cursor.
create or replace function public.sync_server_time()
returns timestamptz
language sql
volatile
as $$
  select clock_timestamp();
$$;

grant execute on function public.sync_server_time() to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'transactions',
    'categories',
    'budgets',
    'recurring_transactions',
    'accounts',
    'investments'
  ]
  loop
    execute format(
      'alter table public.%I add column if not exists server_updated_at timestamptz not null default now()',
      t
    );
    execute format(
      'create index if not exists %I on public.%I (user_id, server_updated_at)',
      'idx_' || t || '_user_server_updated',
      t
    );
    execute format('drop trigger if exists %I on public.%I', t || '_set_server_updated_at', t);
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.set_server_updated_at()',
      t || '_set_server_updated_at',
      t
    );
  end loop;
end $$;

notify pgrst, 'reload schema';
