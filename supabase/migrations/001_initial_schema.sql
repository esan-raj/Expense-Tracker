-- SpendWise cloud schema
-- Apply with: supabase db push   or   the SQL editor in a new project

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  currency text not null default 'INR',
  currency_symbol text not null default '₹',
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  first_day_of_week integer not null default 1 check (first_day_of_week between 0 and 6),
  monthly_budget bigint,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Read-only catalog of starter categories. Copied into each user's categories by the app.
create table if not exists public.system_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  icon text not null,
  color text not null,
  type text not null check (type in ('expense', 'income', 'both')),
  sort_order integer not null default 0
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  icon text,
  color text,
  type text not null check (type in ('expense', 'income', 'both')),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.recurring_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  amount bigint not null check (amount > 0),
  type text not null check (type in ('expense', 'income')),
  category_id uuid references public.categories(id) on delete set null,
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly', 'yearly')),
  start_date date not null,
  next_date date not null,
  payment_method text check (payment_method in ('cash', 'upi', 'credit_card', 'debit_card', 'bank_transfer', 'wallet', 'other')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('expense', 'income')),
  amount bigint not null check (amount > 0),
  category_id uuid references public.categories(id) on delete set null,
  title text not null,
  description text,
  date timestamptz not null,
  payment_method text check (payment_method in ('cash', 'upi', 'credit_card', 'debit_card', 'bank_transfer', 'wallet', 'other')),
  notes text,
  is_recurring boolean not null default false,
  recurring_id uuid references public.recurring_transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  amount bigint not null check (amount > 0),
  month integer not null check (month between 1 and 12),
  year integer not null check (year between 2000 and 2100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_categories_user on public.categories(user_id);
create index if not exists idx_categories_user_updated on public.categories(user_id, updated_at);

create index if not exists idx_transactions_user on public.transactions(user_id);
create index if not exists idx_transactions_user_date on public.transactions(user_id, date);
create index if not exists idx_transactions_user_category on public.transactions(user_id, category_id);
create index if not exists idx_transactions_user_updated on public.transactions(user_id, updated_at);

create index if not exists idx_budgets_user_period on public.budgets(user_id, year, month);
create index if not exists idx_budgets_user_updated on public.budgets(user_id, updated_at);

create index if not exists idx_recurring_user_next on public.recurring_transactions(user_id, next_date);
create index if not exists idx_recurring_user_updated on public.recurring_transactions(user_id, updated_at);

insert into public.system_categories (name, icon, color, type, sort_order) values
  ('Food', 'restaurant', '#F97316', 'expense', 1),
  ('Groceries', 'cart', '#84CC16', 'expense', 2),
  ('Transport', 'car', '#3B82F6', 'expense', 3),
  ('Shopping', 'bag-handle', '#EC4899', 'expense', 4),
  ('Bills', 'receipt', '#8B5CF6', 'expense', 5),
  ('Rent', 'home', '#0EA5E9', 'expense', 6),
  ('Entertainment', 'film', '#F59E0B', 'expense', 7),
  ('Health', 'medkit', '#EF4444', 'expense', 8),
  ('Education', 'school', '#6366F1', 'expense', 9),
  ('Travel', 'airplane', '#14B8A6', 'expense', 10),
  ('Subscriptions', 'card', '#A855F7', 'expense', 11),
  ('Personal Care', 'sparkles', '#F43F5E', 'expense', 12),
  ('Gifts', 'gift', '#E11D48', 'expense', 13),
  ('Other', 'ellipse', '#64748B', 'expense', 14),
  ('Salary', 'cash', '#059669', 'income', 15),
  ('Freelance', 'laptop', '#10B981', 'income', 16),
  ('Business', 'briefcase', '#0D9488', 'income', 17),
  ('Investment', 'trending-up', '#2563EB', 'income', 18),
  ('Gift', 'gift', '#DB2777', 'income', 19),
  ('Other Income', 'ellipse', '#64748B', 'income', 20)
on conflict do nothing;
