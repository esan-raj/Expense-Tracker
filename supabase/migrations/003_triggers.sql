create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists categories_set_updated_at on public.categories;
create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

drop trigger if exists transactions_set_updated_at on public.transactions;
create trigger transactions_set_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();

drop trigger if exists budgets_set_updated_at on public.budgets;
create trigger budgets_set_updated_at
  before update on public.budgets
  for each row execute function public.set_updated_at();

drop trigger if exists recurring_set_updated_at on public.recurring_transactions;
create trigger recurring_set_updated_at
  before update on public.recurring_transactions
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Realtime complements the sync queue; the app still works if these are unavailable.
do $$
begin
  alter publication supabase_realtime add table public.transactions;
exception
  when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.budgets;
exception
  when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.categories;
exception
  when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.recurring_transactions;
exception
  when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.profiles;
exception
  when duplicate_object then null;
end $$;
