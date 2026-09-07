-- First-class investments table matching the RxDB investment schema.
-- Money stays bigint minor units. Soft delete via deleted_at.
-- account_id is optional metadata; composite FK matches 006 so one user
-- cannot attach another user's account. Soft-deleted accounts still exist,
-- so the FK does not break. Hard delete of an account nulls account_id.

create table if not exists public.investments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('mutual_fund', 'stocks', 'fixed_deposit', 'gold', 'sip', 'other')),
  invested_amount bigint not null check (invested_amount > 0),
  current_value bigint not null check (current_value >= 0),
  investment_date date not null,
  account_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

do $$
begin
  alter table public.investments
    drop constraint if exists investments_account_id_fkey;
  alter table public.investments
    drop constraint if exists investments_account_user_fkey;
  alter table public.investments
    add constraint investments_account_user_fkey
    foreign key (account_id, user_id)
      references public.accounts(id, user_id)
      on delete set null;
exception
  when duplicate_object then null;
end $$;

create index if not exists idx_investments_user on public.investments(user_id);
create index if not exists idx_investments_user_updated on public.investments(user_id, updated_at);
create index if not exists idx_investments_user_deleted on public.investments(user_id, deleted_at);
create index if not exists idx_investments_account on public.investments(user_id, account_id);

drop trigger if exists investments_set_updated_at on public.investments;
create trigger investments_set_updated_at
  before update on public.investments
  for each row execute function public.set_updated_at();

alter table public.investments enable row level security;

drop policy if exists "investments_select_own" on public.investments;
drop policy if exists "investments_insert_own" on public.investments;
drop policy if exists "investments_update_own" on public.investments;
drop policy if exists "investments_delete_own" on public.investments;
create policy "investments_select_own" on public.investments
  for select using (auth.uid() = user_id);
create policy "investments_insert_own" on public.investments
  for insert with check (auth.uid() = user_id);
create policy "investments_update_own" on public.investments
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "investments_delete_own" on public.investments
  for delete using (auth.uid() = user_id);

do $$
begin
  alter publication supabase_realtime add table public.investments;
exception
  when duplicate_object then null;
end $$;
