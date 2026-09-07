-- Prevent attaching another user's account via transaction/recurring FK.
-- Postgres FK checks bypass RLS, so account_id must be scoped to the same user_id.
-- Existing mismatched rows (including live-check leftovers) are unassigned first.

do $$
begin
  alter table public.accounts
    add constraint accounts_id_user_unique unique (id, user_id);
exception
  when duplicate_object then null;
end $$;

update public.transactions t
set account_id = null
where t.account_id is not null
  and not exists (
    select 1
    from public.accounts a
    where a.id = t.account_id
      and a.user_id = t.user_id
  );

update public.recurring_transactions r
set account_id = null
where r.account_id is not null
  and not exists (
    select 1
    from public.accounts a
    where a.id = r.account_id
      and a.user_id = r.user_id
  );

alter table public.transactions
  drop constraint if exists transactions_account_id_fkey;
alter table public.transactions
  drop constraint if exists transactions_account_user_fkey;
alter table public.transactions
  add constraint transactions_account_user_fkey
  foreign key (account_id, user_id)
  references public.accounts(id, user_id)
  on delete set null;

alter table public.recurring_transactions
  drop constraint if exists recurring_transactions_account_id_fkey;
alter table public.recurring_transactions
  drop constraint if exists recurring_account_user_fkey;
alter table public.recurring_transactions
  add constraint recurring_account_user_fkey
  foreign key (account_id, user_id)
  references public.accounts(id, user_id)
  on delete set null;
