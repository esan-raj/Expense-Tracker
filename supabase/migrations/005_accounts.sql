create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('bank', 'credit_card', 'cash', 'wallet', 'investment', 'loan', 'other')),
  institution_name text,
  currency text not null default 'INR',
  opening_balance bigint not null default 0,
  credit_limit bigint check (credit_limit is null or credit_limit >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.transactions
  add column if not exists account_id uuid references public.accounts(id) on delete set null;
alter table public.transactions
  add column if not exists is_transfer boolean not null default false;
alter table public.transactions
  add column if not exists transfer_group_id uuid;
alter table public.transactions
  add column if not exists transfer_role text check (transfer_role in ('source', 'destination') or transfer_role is null);

alter table public.recurring_transactions
  add column if not exists account_id uuid references public.accounts(id) on delete set null;

create index if not exists idx_accounts_user on public.accounts(user_id);
create index if not exists idx_accounts_user_updated on public.accounts(user_id, updated_at);
create index if not exists idx_accounts_user_deleted on public.accounts(user_id, deleted_at);
create index if not exists idx_transactions_account on public.transactions(user_id, account_id);
create index if not exists idx_transactions_transfer_group on public.transactions(transfer_group_id);

drop trigger if exists accounts_set_updated_at on public.accounts;
create trigger accounts_set_updated_at
  before update on public.accounts
  for each row execute function public.set_updated_at();

alter table public.accounts enable row level security;

drop policy if exists "accounts_select_own" on public.accounts;
drop policy if exists "accounts_insert_own" on public.accounts;
drop policy if exists "accounts_update_own" on public.accounts;
drop policy if exists "accounts_delete_own" on public.accounts;
create policy "accounts_select_own" on public.accounts
  for select using (auth.uid() = user_id);
create policy "accounts_insert_own" on public.accounts
  for insert with check (auth.uid() = user_id);
create policy "accounts_update_own" on public.accounts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "accounts_delete_own" on public.accounts
  for delete using (auth.uid() = user_id);

do $$
begin
  alter publication supabase_realtime add table public.accounts;
exception
  when duplicate_object then null;
end $$;
