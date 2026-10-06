-- Hard-deleting an account must keep the financial rows that pointed at it and only clear
-- their account link. 005 did that with single-column keys (account_id -> accounts.id,
-- on delete set null). 006 and 007 replaced them with composite ownership keys
-- (account_id, user_id) -> accounts(id, user_id) but kept a bare "on delete set null",
-- which nulls every key column. user_id is NOT NULL, so deleting an account that still
-- had transactions, recurring transactions or investments failed instead of unlinking them.
--
-- Recreate the three keys with the same names, columns and referenced columns, the same
-- on update / match behaviour, and "on delete set null (account_id)": only account_id is
-- cleared and user_id is never touched, so the ownership check is unchanged. No rows are
-- modified; PostgreSQL revalidates each key against the existing rows.
-- The column list needs PostgreSQL 15 or newer.

-- Fail instead of queueing app traffic behind a long-running transaction on these tables.
set local lock_timeout = '5s';

alter table public.transactions
  drop constraint transactions_account_user_fkey,
  add constraint transactions_account_user_fkey
    foreign key (account_id, user_id)
    references public.accounts (id, user_id)
    on delete set null (account_id);

alter table public.recurring_transactions
  drop constraint recurring_account_user_fkey,
  add constraint recurring_account_user_fkey
    foreign key (account_id, user_id)
    references public.accounts (id, user_id)
    on delete set null (account_id);

alter table public.investments
  drop constraint investments_account_user_fkey,
  add constraint investments_account_user_fkey
    foreign key (account_id, user_id)
    references public.accounts (id, user_id)
    on delete set null (account_id);
