alter table public.profiles enable row level security;
alter table public.system_categories enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.recurring_transactions enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Shared starter catalog: authenticated read only. No insert/update/delete policies.
drop policy if exists "system_categories_select" on public.system_categories;
create policy "system_categories_select" on public.system_categories
  for select to authenticated using (true);

drop policy if exists "categories_select_own" on public.categories;
drop policy if exists "categories_insert_own" on public.categories;
drop policy if exists "categories_update_own" on public.categories;
drop policy if exists "categories_delete_own" on public.categories;
create policy "categories_select_own" on public.categories
  for select using (auth.uid() = user_id);
create policy "categories_insert_own" on public.categories
  for insert with check (auth.uid() = user_id);
create policy "categories_update_own" on public.categories
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "categories_delete_own" on public.categories
  for delete using (auth.uid() = user_id);

drop policy if exists "transactions_select_own" on public.transactions;
drop policy if exists "transactions_insert_own" on public.transactions;
drop policy if exists "transactions_update_own" on public.transactions;
drop policy if exists "transactions_delete_own" on public.transactions;
create policy "transactions_select_own" on public.transactions
  for select using (auth.uid() = user_id);
create policy "transactions_insert_own" on public.transactions
  for insert with check (auth.uid() = user_id);
create policy "transactions_update_own" on public.transactions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "transactions_delete_own" on public.transactions
  for delete using (auth.uid() = user_id);

drop policy if exists "budgets_select_own" on public.budgets;
drop policy if exists "budgets_insert_own" on public.budgets;
drop policy if exists "budgets_update_own" on public.budgets;
drop policy if exists "budgets_delete_own" on public.budgets;
create policy "budgets_select_own" on public.budgets
  for select using (auth.uid() = user_id);
create policy "budgets_insert_own" on public.budgets
  for insert with check (auth.uid() = user_id);
create policy "budgets_update_own" on public.budgets
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "budgets_delete_own" on public.budgets
  for delete using (auth.uid() = user_id);

drop policy if exists "recurring_select_own" on public.recurring_transactions;
drop policy if exists "recurring_insert_own" on public.recurring_transactions;
drop policy if exists "recurring_update_own" on public.recurring_transactions;
drop policy if exists "recurring_delete_own" on public.recurring_transactions;
create policy "recurring_select_own" on public.recurring_transactions
  for select using (auth.uid() = user_id);
create policy "recurring_insert_own" on public.recurring_transactions
  for insert with check (auth.uid() = user_id);
create policy "recurring_update_own" on public.recurring_transactions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "recurring_delete_own" on public.recurring_transactions
  for delete using (auth.uid() = user_id);
