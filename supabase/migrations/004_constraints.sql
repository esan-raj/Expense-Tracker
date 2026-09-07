-- Extra uniqueness and lookup indexes for sync and common queries.

create unique index if not exists idx_budgets_unique_active_period
  on public.budgets (
    user_id,
    year,
    month,
    coalesce(category_id, '00000000-0000-0000-0000-000000000000')
  )
  where deleted_at is null;

create index if not exists idx_transactions_user_deleted
  on public.transactions(user_id, deleted_at);

create index if not exists idx_categories_user_deleted
  on public.categories(user_id, deleted_at);
