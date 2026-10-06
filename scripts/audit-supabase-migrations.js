#!/usr/bin/env node
'use strict';
/**
 * Read-only audit of a live database against supabase/migrations 001–009, for a database whose
 * migration history is empty because the SQL was run by hand in the SQL Editor.
 *
 *   node scripts/audit-supabase-migrations.js [--env-file .env] [--ca-file <supabase-ca.crt>]
 *
 * Every query runs in one BEGIN TRANSACTION READ ONLY with short statement and lock timeouts, and
 * that transaction is always rolled back. Audit statements are fixed SELECTs over pg_catalog with
 * bound parameters. Application tables are read only for aggregate seed counts and, when no
 * validated foreign key already proves it, one boolean per table for the 006 backfill.
 * The connection string is read like the migration runner reads it and is never printed.
 */
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  RunnerError,
  createRedactor,
  describeTarget,
  execCommand,
  isInside,
  parseDatabaseUrl,
  projectRefFromApiUrl,
  readEnvFile,
  readLinkedProjectRef,
  resolveDatabaseUrl,
  verifyTarget,
} = require('./apply-supabase-migrations');

const MIGRATIONS_DIR = 'supabase/migrations';
const EXIT = { ok: 0, failed: 1, usage: 2, findings: 3 };
const STATUS = {
  full: 'FULLY_PRESENT',
  partial: 'PARTIALLY_PRESENT',
  none: 'NOT_PRESENT',
  ambiguous: 'AMBIGUOUS',
};
const SESSION_LIMITS = { statementTimeout: '15s', lockTimeout: '2s', idleTimeout: '60s' };
/** The only statements issued outside the validated audit statements. */
const CONTROL = Object.freeze({
  begin: 'BEGIN TRANSACTION READ ONLY',
  statementTimeout: `SET LOCAL statement_timeout = '${SESSION_LIMITS.statementTimeout}'`,
  lockTimeout: `SET LOCAL lock_timeout = '${SESSION_LIMITS.lockTimeout}'`,
  idleTimeout: `SET LOCAL idle_in_transaction_session_timeout = '${SESSION_LIMITS.idleTimeout}'`,
  rollback: 'ROLLBACK',
});
const CONNECT_TIMEOUT_MS = 20 * 1000;
const QUERY_TIMEOUT_MS = 30 * 1000;

const USAGE = `Usage:
  node scripts/audit-supabase-migrations.js [--env-file <path>] [--ca-file <path>]

  --env-file <path>  Load variables from a git-ignored file. Variables already set win.
  --ca-file <path>   PEM CA certificate for TLS verification (Supabase Dashboard → Project Settings →
                     Database → SSL Configuration → Download certificate).

Read-only: one read-only transaction, always rolled back. Never applies migrations, never repairs
the migration history, never changes data. Connection string: SUPABASE_DB_URL, or DATABASE_URL,
or POSTGRES_URL (first one set wins).

Exit codes: 0 every migration FULLY_PRESENT, 3 audit finished with other statuses, 1 no audit
result, 2 usage error.`;

// ---------------------------------------------------------------------------------------------
// Assertion manifest: the material postconditions of each migration file, as PostgreSQL's own
// catalog functions (format_type, pg_get_expr, pg_get_constraintdef, pg_get_indexdef) print them.
// __tests__/migrationAudit.test.ts cross-checks this manifest against the SQL files.
// ---------------------------------------------------------------------------------------------

const TSTZ = 'timestamp with time zone';
const NOW = 'now()';
const NEW_UUID = 'gen_random_uuid()';
const OWN_ROW = '(auth.uid() = user_id)';
const OWN_PROFILE = '(auth.uid() = id)';
const PAYMENT_METHODS = ['cash', 'upi', 'credit_card', 'debit_card', 'bank_transfer', 'wallet', 'other'];
const SYNC_TABLES = ['transactions', 'categories', 'budgets', 'recurring_transactions', 'accounts', 'investments'];
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const PUBLICATION = 'supabase_realtime';

const SYSTEM_CATEGORIES = [
  ['Food', 'restaurant', '#F97316', 'expense', 1],
  ['Groceries', 'cart', '#84CC16', 'expense', 2],
  ['Transport', 'car', '#3B82F6', 'expense', 3],
  ['Shopping', 'bag-handle', '#EC4899', 'expense', 4],
  ['Bills', 'receipt', '#8B5CF6', 'expense', 5],
  ['Rent', 'home', '#0EA5E9', 'expense', 6],
  ['Entertainment', 'film', '#F59E0B', 'expense', 7],
  ['Health', 'medkit', '#EF4444', 'expense', 8],
  ['Education', 'school', '#6366F1', 'expense', 9],
  ['Travel', 'airplane', '#14B8A6', 'expense', 10],
  ['Subscriptions', 'card', '#A855F7', 'expense', 11],
  ['Personal Care', 'sparkles', '#F43F5E', 'expense', 12],
  ['Gifts', 'gift', '#E11D48', 'expense', 13],
  ['Other', 'ellipse', '#64748B', 'expense', 14],
  ['Salary', 'cash', '#059669', 'income', 15],
  ['Freelance', 'laptop', '#10B981', 'income', 16],
  ['Business', 'briefcase', '#0D9488', 'income', 17],
  ['Investment', 'trending-up', '#2563EB', 'income', 18],
  ['Gift', 'gift', '#DB2777', 'income', 19],
  ['Other Income', 'ellipse', '#64748B', 'income', 20],
].map(([name, icon, color, type, sortOrder]) => ({ name, icon, color, type, sortOrder }));

function column(name, type, nullable, defaultValue = null) {
  return { name, type, nullable, default: defaultValue };
}
const idColumn = () => column('id', 'uuid', false, NEW_UUID);
const userIdColumn = () => column('user_id', 'uuid', false);
const auditColumns = () => [column('created_at', TSTZ, false, NOW), column('updated_at', TSTZ, false, NOW), column('deleted_at', TSTZ, true)];
const textLiteral = (value) => `'${value}'::text`;
const inList = (name, values) => `CHECK ((${name} = ANY (ARRAY[${values.map(textLiteral).join(', ')}])))`;
const between = (name, low, high) => `CHECK (((${name} >= ${low}) AND (${name} <= ${high})))`;
const userForeignKey = (table) => ({ table, columns: ['user_id'], ref: 'auth.users', refColumns: ['id'], onDelete: 'c' });
const index = (name, table, columns, extra = {}) => ({ name, table, columns, unique: false, predicate: null, ...extra });
const updatedAtTrigger = (table, name) => ({ table, name, timing: 'BEFORE', events: ['UPDATE'], function: 'public.set_updated_at' });
const ownerPolicies = (table, prefix) => [
  { table, name: `${prefix}_select_own`, command: 'SELECT', roles: ['public'], using: OWN_ROW, check: null },
  { table, name: `${prefix}_insert_own`, command: 'INSERT', roles: ['public'], using: null, check: OWN_ROW },
  { table, name: `${prefix}_update_own`, command: 'UPDATE', roles: ['public'], using: OWN_ROW, check: OWN_ROW },
  { table, name: `${prefix}_delete_own`, command: 'DELETE', roles: ['public'], using: OWN_ROW, check: null },
];
const accountOwnershipKey = (table, name) => ({
  table,
  name,
  columns: ['account_id', 'user_id'],
  ref: 'public.accounts',
  refColumns: ['id', 'user_id'],
  onDelete: 'n',
});
const NOTIFY_NOTE = "notify pgrst, 'reload schema' only refreshes PostgREST's schema cache at that moment and leaves nothing to inspect.";

const MIGRATIONS = [
  {
    version: '001',
    file: '001_initial_schema.sql',
    sha256: '7c1eef7959546c22942ac0a2a669514605b48eec24e9c94ece15079c26435755',
    schemas: ['public', 'auth'],
    extensions: ['pgcrypto'],
    prerequisites: ['auth.users'],
    tables: [
      {
        name: 'public.profiles',
        columns: [
          column('id', 'uuid', false),
          column('display_name', 'text', true),
          column('currency', 'text', false, textLiteral('INR')),
          column('currency_symbol', 'text', false, textLiteral('₹')),
          column('theme', 'text', false, textLiteral('system')),
          column('first_day_of_week', 'integer', false, '1'),
          column('monthly_budget', 'bigint', true),
          column('onboarding_completed', 'boolean', false, 'false'),
          column('created_at', TSTZ, false, NOW),
          column('updated_at', TSTZ, false, NOW),
        ],
      },
      {
        name: 'public.system_categories',
        columns: [
          idColumn(),
          column('name', 'text', false),
          column('icon', 'text', false),
          column('color', 'text', false),
          column('type', 'text', false),
          column('sort_order', 'integer', false, '0'),
        ],
      },
      {
        name: 'public.categories',
        columns: [
          idColumn(),
          userIdColumn(),
          column('name', 'text', false),
          column('icon', 'text', true),
          column('color', 'text', true),
          column('type', 'text', false),
          column('is_default', 'boolean', false, 'false'),
          ...auditColumns(),
        ],
      },
      {
        name: 'public.recurring_transactions',
        columns: [
          idColumn(),
          userIdColumn(),
          column('title', 'text', false),
          column('amount', 'bigint', false),
          column('type', 'text', false),
          column('category_id', 'uuid', true),
          column('frequency', 'text', false),
          column('start_date', 'date', false),
          column('next_date', 'date', false),
          column('payment_method', 'text', true),
          column('is_active', 'boolean', false, 'true'),
          ...auditColumns(),
        ],
      },
      {
        name: 'public.transactions',
        columns: [
          idColumn(),
          userIdColumn(),
          column('type', 'text', false),
          column('amount', 'bigint', false),
          column('category_id', 'uuid', true),
          column('title', 'text', false),
          column('description', 'text', true),
          column('date', TSTZ, false),
          column('payment_method', 'text', true),
          column('notes', 'text', true),
          column('is_recurring', 'boolean', false, 'false'),
          column('recurring_id', 'uuid', true),
          ...auditColumns(),
        ],
      },
      {
        name: 'public.budgets',
        columns: [
          idColumn(),
          userIdColumn(),
          column('category_id', 'uuid', true),
          column('amount', 'bigint', false),
          column('month', 'integer', false),
          column('year', 'integer', false),
          ...auditColumns(),
        ],
      },
    ],
    primaryKeys: ['profiles', 'system_categories', 'categories', 'recurring_transactions', 'transactions', 'budgets'].map((name) => ({
      table: `public.${name}`,
      columns: ['id'],
    })),
    foreignKeys: [
      { table: 'public.profiles', columns: ['id'], ref: 'auth.users', refColumns: ['id'], onDelete: 'c' },
      userForeignKey('public.categories'),
      userForeignKey('public.recurring_transactions'),
      { table: 'public.recurring_transactions', columns: ['category_id'], ref: 'public.categories', refColumns: ['id'], onDelete: 'n' },
      userForeignKey('public.transactions'),
      { table: 'public.transactions', columns: ['category_id'], ref: 'public.categories', refColumns: ['id'], onDelete: 'n' },
      { table: 'public.transactions', columns: ['recurring_id'], ref: 'public.recurring_transactions', refColumns: ['id'], onDelete: 'n' },
      userForeignKey('public.budgets'),
      { table: 'public.budgets', columns: ['category_id'], ref: 'public.categories', refColumns: ['id'], onDelete: 'n' },
    ],
    checks: [
      { table: 'public.profiles', name: 'profiles_theme_check', definition: inList('theme', ['system', 'light', 'dark']) },
      { table: 'public.profiles', name: 'profiles_first_day_of_week_check', definition: between('first_day_of_week', 0, 6) },
      { table: 'public.system_categories', name: 'system_categories_type_check', definition: inList('type', ['expense', 'income', 'both']) },
      { table: 'public.categories', name: 'categories_type_check', definition: inList('type', ['expense', 'income', 'both']) },
      { table: 'public.recurring_transactions', name: 'recurring_transactions_amount_check', definition: 'CHECK ((amount > 0))' },
      { table: 'public.recurring_transactions', name: 'recurring_transactions_type_check', definition: inList('type', ['expense', 'income']) },
      {
        table: 'public.recurring_transactions',
        name: 'recurring_transactions_frequency_check',
        definition: inList('frequency', ['daily', 'weekly', 'monthly', 'yearly']),
      },
      {
        table: 'public.recurring_transactions',
        name: 'recurring_transactions_payment_method_check',
        definition: inList('payment_method', PAYMENT_METHODS),
      },
      { table: 'public.transactions', name: 'transactions_type_check', definition: inList('type', ['expense', 'income']) },
      { table: 'public.transactions', name: 'transactions_amount_check', definition: 'CHECK ((amount > 0))' },
      { table: 'public.transactions', name: 'transactions_payment_method_check', definition: inList('payment_method', PAYMENT_METHODS) },
      { table: 'public.budgets', name: 'budgets_amount_check', definition: 'CHECK ((amount > 0))' },
      { table: 'public.budgets', name: 'budgets_month_check', definition: between('month', 1, 12) },
      { table: 'public.budgets', name: 'budgets_year_check', definition: between('year', 2000, 2100) },
    ],
    indexes: [
      index('idx_categories_user', 'public.categories', ['user_id']),
      index('idx_categories_user_updated', 'public.categories', ['user_id', 'updated_at']),
      index('idx_transactions_user', 'public.transactions', ['user_id']),
      index('idx_transactions_user_date', 'public.transactions', ['user_id', 'date']),
      index('idx_transactions_user_category', 'public.transactions', ['user_id', 'category_id']),
      index('idx_transactions_user_updated', 'public.transactions', ['user_id', 'updated_at']),
      index('idx_budgets_user_period', 'public.budgets', ['user_id', 'year', 'month']),
      index('idx_budgets_user_updated', 'public.budgets', ['user_id', 'updated_at']),
      index('idx_recurring_user_next', 'public.recurring_transactions', ['user_id', 'next_date']),
      index('idx_recurring_user_updated', 'public.recurring_transactions', ['user_id', 'updated_at']),
    ],
    seeds: SYSTEM_CATEGORIES,
    unprovable: [
      'pgcrypto ships preinstalled on Supabase, so its presence does not show that this file ran.',
      'Seed rows are compared by content; whether this file or someone else inserted them cannot be told apart.',
    ],
  },
  {
    version: '002',
    file: '002_rls_policies.sql',
    sha256: '66d53ee95fae10b16e48e4538cf1600c08470d564acd66b4a4ff2d7520822144',
    rls: ['profiles', 'system_categories', 'categories', 'transactions', 'budgets', 'recurring_transactions'].map((name) => `public.${name}`),
    policies: [
      { table: 'public.profiles', name: 'profiles_select_own', command: 'SELECT', roles: ['public'], using: OWN_PROFILE, check: null },
      { table: 'public.profiles', name: 'profiles_insert_own', command: 'INSERT', roles: ['public'], using: null, check: OWN_PROFILE },
      { table: 'public.profiles', name: 'profiles_update_own', command: 'UPDATE', roles: ['public'], using: OWN_PROFILE, check: OWN_PROFILE },
      { table: 'public.system_categories', name: 'system_categories_select', command: 'SELECT', roles: ['authenticated'], using: 'true', check: null },
      ...ownerPolicies('public.categories', 'categories'),
      ...ownerPolicies('public.transactions', 'transactions'),
      ...ownerPolicies('public.budgets', 'budgets'),
      ...ownerPolicies('public.recurring_transactions', 'recurring'),
    ],
  },
  {
    version: '003',
    file: '003_triggers.sql',
    sha256: '35b8d91032580276047f4498e7c9fec9c51b0357c1302975c060fa51e0dfd06a',
    functions: [
      {
        name: 'set_updated_at',
        arguments: '',
        result: 'trigger',
        language: 'plpgsql',
        securityDefiner: false,
        volatility: 'v',
        config: null,
        body: 'begin new.updated_at = now(); return new; end;',
      },
      {
        name: 'handle_new_user',
        arguments: '',
        result: 'trigger',
        language: 'plpgsql',
        securityDefiner: true,
        volatility: 'v',
        config: ['search_path=public'],
        body:
          "begin insert into public.profiles (id, display_name) values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))) on conflict (id) do nothing; return new; end;",
      },
    ],
    triggers: [
      updatedAtTrigger('public.profiles', 'profiles_set_updated_at'),
      updatedAtTrigger('public.categories', 'categories_set_updated_at'),
      updatedAtTrigger('public.transactions', 'transactions_set_updated_at'),
      updatedAtTrigger('public.budgets', 'budgets_set_updated_at'),
      updatedAtTrigger('public.recurring_transactions', 'recurring_set_updated_at'),
      { table: 'auth.users', name: 'on_auth_user_created', timing: 'AFTER', events: ['INSERT'], function: 'public.handle_new_user' },
    ],
    publication: ['transactions', 'budgets', 'categories', 'recurring_transactions', 'profiles'].map((name) => `public.${name}`),
    unprovable: ['Realtime publication membership is checked, but the dashboard can add the same tables, so it does not prove this file ran.'],
  },
  {
    version: '004',
    file: '004_constraints.sql',
    sha256: '15fe84d81ffd49d244792bed21b9e2c7764da49c8e8a9d148f645a670241a0e2',
    indexes: [
      index('idx_budgets_unique_active_period', 'public.budgets', ['user_id', 'year', 'month', `COALESCE(category_id, '${NIL_UUID}'::uuid)`], {
        unique: true,
        predicate: '(deleted_at IS NULL)',
      }),
      index('idx_transactions_user_deleted', 'public.transactions', ['user_id', 'deleted_at']),
      index('idx_categories_user_deleted', 'public.categories', ['user_id', 'deleted_at']),
    ],
  },
  {
    version: '005',
    file: '005_accounts.sql',
    sha256: '981ca1b4445a630e514a46d9ccbf2db38ab30136534a5e5a0eeb9b6bd1435529',
    tables: [
      {
        name: 'public.accounts',
        columns: [
          idColumn(),
          userIdColumn(),
          column('name', 'text', false),
          column('type', 'text', false),
          column('institution_name', 'text', true),
          column('currency', 'text', false, textLiteral('INR')),
          column('opening_balance', 'bigint', false, '0'),
          column('credit_limit', 'bigint', true),
          column('is_active', 'boolean', false, 'true'),
          ...auditColumns(),
        ],
      },
    ],
    columns: [
      { table: 'public.transactions', ...column('account_id', 'uuid', true) },
      { table: 'public.transactions', ...column('is_transfer', 'boolean', false, 'false') },
      { table: 'public.transactions', ...column('transfer_group_id', 'uuid', true) },
      { table: 'public.transactions', ...column('transfer_role', 'text', true) },
      { table: 'public.recurring_transactions', ...column('account_id', 'uuid', true) },
    ],
    primaryKeys: [{ table: 'public.accounts', columns: ['id'] }],
    foreignKeys: [
      userForeignKey('public.accounts'),
      {
        table: 'public.transactions',
        columns: ['account_id'],
        ref: 'public.accounts',
        refColumns: ['id'],
        onDelete: 'n',
        supersededBy: { version: '006', columns: ['account_id', 'user_id'], refColumns: ['id', 'user_id'] },
      },
      {
        table: 'public.recurring_transactions',
        columns: ['account_id'],
        ref: 'public.accounts',
        refColumns: ['id'],
        onDelete: 'n',
        supersededBy: { version: '006', columns: ['account_id', 'user_id'], refColumns: ['id', 'user_id'] },
      },
    ],
    checks: [
      {
        table: 'public.accounts',
        name: 'accounts_type_check',
        definition: inList('type', ['bank', 'credit_card', 'cash', 'wallet', 'investment', 'loan', 'other']),
      },
      { table: 'public.accounts', name: 'accounts_credit_limit_check', definition: 'CHECK (((credit_limit IS NULL) OR (credit_limit >= 0)))' },
      {
        table: 'public.transactions',
        name: 'transactions_transfer_role_check',
        definition: `CHECK (((transfer_role = ANY (ARRAY['source'::text, 'destination'::text])) OR (transfer_role IS NULL)))`,
      },
    ],
    indexes: [
      index('idx_accounts_user', 'public.accounts', ['user_id']),
      index('idx_accounts_user_updated', 'public.accounts', ['user_id', 'updated_at']),
      index('idx_accounts_user_deleted', 'public.accounts', ['user_id', 'deleted_at']),
      index('idx_transactions_account', 'public.transactions', ['user_id', 'account_id']),
      index('idx_transactions_transfer_group', 'public.transactions', ['transfer_group_id']),
    ],
    triggers: [updatedAtTrigger('public.accounts', 'accounts_set_updated_at')],
    rls: ['public.accounts'],
    policies: ownerPolicies('public.accounts', 'accounts'),
    publication: ['public.accounts'],
  },
  {
    version: '006',
    file: '006_account_ownership_fk.sql',
    sha256: 'f2339c46ef3476a470ccf15a1c6c0cd8c9e039106095ea181d47c8c59661dd78',
    uniques: [{ table: 'public.accounts', name: 'accounts_id_user_unique', columns: ['id', 'user_id'] }],
    foreignKeys: [
      accountOwnershipKey('public.transactions', 'transactions_account_user_fkey'),
      accountOwnershipKey('public.recurring_transactions', 'recurring_account_user_fkey'),
    ],
    absentForeignKeys: [
      { table: 'public.transactions', columns: ['account_id'], ref: 'public.accounts' },
      { table: 'public.recurring_transactions', columns: ['account_id'], ref: 'public.accounts' },
    ],
    nullability: [
      { table: 'public.transactions', column: 'account_id', nullable: true },
      { table: 'public.transactions', column: 'user_id', nullable: false },
      { table: 'public.recurring_transactions', column: 'account_id', nullable: true },
      { table: 'public.recurring_transactions', column: 'user_id', nullable: false },
    ],
    backfill: [
      { table: 'public.transactions', foreignKey: 'transactions_account_user_fkey', statement: 'backfillTransactions' },
      { table: 'public.recurring_transactions', foreignKey: 'recurring_account_user_fkey', statement: 'backfillRecurring' },
    ],
    unprovable: ['Rows the backfill set to NULL in the past cannot be detected; only the current state is checked.'],
  },
  {
    version: '007',
    file: '007_create_investments.sql',
    sha256: '0749a81c55968cca643a7bdd6112cf89b6495669812002da536a9c9b88387f60',
    tables: [
      {
        name: 'public.investments',
        columns: [
          idColumn(),
          userIdColumn(),
          column('name', 'text', false),
          column('type', 'text', false),
          column('invested_amount', 'bigint', false),
          column('current_value', 'bigint', false),
          column('investment_date', 'date', false),
          column('account_id', 'uuid', true),
          column('notes', 'text', true),
          ...auditColumns(),
        ],
      },
    ],
    primaryKeys: [{ table: 'public.investments', columns: ['id'] }],
    foreignKeys: [userForeignKey('public.investments'), accountOwnershipKey('public.investments', 'investments_account_user_fkey')],
    checks: [
      {
        table: 'public.investments',
        name: 'investments_type_check',
        definition: inList('type', ['mutual_fund', 'stocks', 'fixed_deposit', 'gold', 'sip', 'other']),
      },
      { table: 'public.investments', name: 'investments_invested_amount_check', definition: 'CHECK ((invested_amount > 0))' },
      { table: 'public.investments', name: 'investments_current_value_check', definition: 'CHECK ((current_value >= 0))' },
    ],
    indexes: [
      index('idx_investments_user', 'public.investments', ['user_id']),
      index('idx_investments_user_updated', 'public.investments', ['user_id', 'updated_at']),
      index('idx_investments_user_deleted', 'public.investments', ['user_id', 'deleted_at']),
      index('idx_investments_account', 'public.investments', ['user_id', 'account_id']),
    ],
    triggers: [updatedAtTrigger('public.investments', 'investments_set_updated_at')],
    rls: ['public.investments'],
    policies: ownerPolicies('public.investments', 'investments'),
    publication: ['public.investments'],
  },
  {
    version: '008',
    file: '008_server_sync_cursor.sql',
    sha256: '0613eaabe33e2f6f310ba328ae669c76ddb0420fc44554c5c86f6cc30c880211',
    functions: [
      {
        name: 'set_server_updated_at',
        arguments: '',
        result: 'trigger',
        language: 'plpgsql',
        securityDefiner: false,
        volatility: 'v',
        config: null,
        body: 'begin new.server_updated_at = clock_timestamp(); return new; end;',
      },
      {
        name: 'sync_server_time',
        arguments: '',
        result: TSTZ,
        language: 'sql',
        securityDefiner: false,
        volatility: 'v',
        config: null,
        body: 'select clock_timestamp();',
      },
    ],
    columns: SYNC_TABLES.map((name) => ({ table: `public.${name}`, ...column('server_updated_at', TSTZ, false, NOW) })),
    indexes: SYNC_TABLES.map((name) => index(`idx_${name}_user_server_updated`, `public.${name}`, ['user_id', 'server_updated_at'])),
    triggers: SYNC_TABLES.map((name) => ({
      table: `public.${name}`,
      name: `${name}_set_server_updated_at`,
      timing: 'BEFORE',
      events: ['INSERT', 'UPDATE'],
      function: 'public.set_server_updated_at',
    })),
    privileges: [{ function: 'sync_server_time', role: 'authenticated', expect: 'explicit' }],
    unprovable: [NOTIFY_NOTE],
  },
  {
    version: '009',
    file: '009_harden_sync_server_time_permissions.sql',
    sha256: '5cdf1b754509d27f23d3e696592c94253e1e4a1196b4b6d55cdb742c44fa66dc',
    privileges: [
      { function: 'sync_server_time', role: 'PUBLIC', expect: 'none' },
      { function: 'sync_server_time', role: 'anon', expect: 'none' },
      { function: 'sync_server_time', role: 'authenticated', expect: 'explicit', distinctive: false },
    ],
    unprovable: [NOTIFY_NOTE],
  },
];

const AUDITED_TABLES = MIGRATIONS.flatMap((migration) => (migration.tables || []).map((table) => table.name));
const RELATIONS = [...AUDITED_TABLES, 'auth.users'];
const TRIGGER_TABLES = RELATIONS;
const INDEX_NAMES = MIGRATIONS.flatMap((migration) => (migration.indexes || []).map((spec) => spec.name));
const FUNCTION_NAMES = MIGRATIONS.flatMap((migration) => (migration.functions || []).map((spec) => spec.name));
const BACKFILL = MIGRATIONS.flatMap((migration) => migration.backfill || []);

// ---------------------------------------------------------------------------------------------
// Audit statements. Fixed text, bound parameters, pg_catalog functions only.
// ---------------------------------------------------------------------------------------------

const qualifiedName = (schemaColumn, nameColumn) => `(${schemaColumn}::text || '.' || ${nameColumn}::text)`;
const seedParameter = () =>
  JSON.stringify(
    SYSTEM_CATEGORIES.map((seed, position) => ({
      ord: position + 1,
      name: seed.name,
      icon: seed.icon,
      color: seed.color,
      type: seed.type,
      sort_order: seed.sortOrder,
    }))
  );

const STATEMENTS = Object.freeze({
  session: {
    sql: `select pg_catalog.current_setting('transaction_read_only') as transaction_read_only,
       pg_catalog.current_setting('statement_timeout') as statement_timeout,
       pg_catalog.current_setting('lock_timeout') as lock_timeout,
       pg_catalog.current_setting('server_version_num')::int as server_version_num,
       r.rolsuper as superuser,
       r.rolbypassrls as bypass_rls
from pg_catalog.pg_roles r
where r.rolname = current_user`,
    params: () => [],
  },
  namespaces: {
    sql: `select n.nspname::text as name from pg_catalog.pg_namespace n where n.nspname = any($1::text[])`,
    params: () => [['public', 'auth']],
  },
  extensions: {
    sql: `select e.extname::text as name, n.nspname::text as schema, e.extversion::text as version
from pg_catalog.pg_extension e
join pg_catalog.pg_namespace n on n.oid = e.extnamespace
where e.extname = any($1::text[])`,
    params: () => [['pgcrypto']],
  },
  relations: {
    sql: `select n.nspname::text as schema, c.relname::text as name, c.relkind::text as kind,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced,
       (c.relrowsecurity and not (r.rolsuper or r.rolbypassrls)
         and (c.relforcerowsecurity or not pg_catalog.pg_has_role(current_user, c.relowner, 'USAGE'))) as rls_filters_current_user
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
cross join (select rolsuper, rolbypassrls from pg_catalog.pg_roles where rolname = current_user) as r
where ${qualifiedName('n.nspname', 'c.relname')} = any($1::text[])
  and c.relkind in ('r', 'p', 'v', 'm', 'f')`,
    params: () => [RELATIONS],
  },
  columns: {
    sql: `select n.nspname::text as schema, c.relname::text as table_name, a.attname::text as name,
       pg_catalog.format_type(a.atttypid, a.atttypmod) as type,
       not a.attnotnull as nullable,
       pg_catalog.pg_get_expr(d.adbin, d.adrelid) as default_value,
       a.attidentity::text as identity,
       a.attgenerated::text as generated
from pg_catalog.pg_attribute a
join pg_catalog.pg_class c on c.oid = a.attrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
where ${qualifiedName('n.nspname', 'c.relname')} = any($1::text[])
  and a.attnum > 0 and not a.attisdropped
order by 1, 2, a.attnum`,
    params: () => [AUDITED_TABLES],
  },
  constraints: {
    sql: `select n.nspname::text as schema, c.relname::text as table_name, co.conname::text as name,
       co.contype::text as type, co.convalidated as validated,
       pg_catalog.pg_get_constraintdef(co.oid) as definition,
       array(select a.attname::text from pg_catalog.unnest(co.conkey) with ordinality as k(attnum, ord)
             join pg_catalog.pg_attribute a on a.attrelid = co.conrelid and a.attnum = k.attnum order by k.ord) as columns,
       rn.nspname::text as ref_schema, rc.relname::text as ref_table,
       array(select a.attname::text from pg_catalog.unnest(co.confkey) with ordinality as k(attnum, ord)
             join pg_catalog.pg_attribute a on a.attrelid = co.confrelid and a.attnum = k.attnum order by k.ord) as ref_columns,
       co.confupdtype::text as on_update, co.confdeltype::text as on_delete, co.confmatchtype::text as match_type,
       co.condeferrable as deferrable
from pg_catalog.pg_constraint co
join pg_catalog.pg_class c on c.oid = co.conrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
left join pg_catalog.pg_class rc on rc.oid = co.confrelid
left join pg_catalog.pg_namespace rn on rn.oid = rc.relnamespace
where ${qualifiedName('n.nspname', 'c.relname')} = any($1::text[])
order by 1, 2, 3`,
    params: () => [AUDITED_TABLES],
  },
  indexes: {
    sql: `select n.nspname::text as schema, c.relname::text as table_name, ic.relname::text as name,
       am.amname::text as method, i.indisunique as is_unique, i.indisprimary as is_primary,
       i.indisvalid as is_valid, i.indisready as is_ready,
       i.indnkeyatts::int as key_count, i.indnatts::int as column_count,
       array(select pg_catalog.pg_get_indexdef(i.indexrelid, k.n, true)
             from pg_catalog.generate_series(1, i.indnkeyatts::int) as k(n) order by k.n) as columns,
       array(select i.indoption[k.n - 1]::int
             from pg_catalog.generate_series(1, i.indnkeyatts::int) as k(n) order by k.n) as options,
       pg_catalog.pg_get_expr(i.indpred, i.indrelid) as predicate,
       pg_catalog.pg_get_indexdef(i.indexrelid) as definition,
       exists (select 1 from pg_catalog.pg_constraint co
               where co.conindid = i.indexrelid and co.conrelid = i.indrelid and co.contype in ('p', 'u', 'x')) as backs_constraint
from pg_catalog.pg_index i
join pg_catalog.pg_class ic on ic.oid = i.indexrelid
join pg_catalog.pg_class c on c.oid = i.indrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
join pg_catalog.pg_am am on am.oid = ic.relam
where ${qualifiedName('n.nspname', 'c.relname')} = any($1::text[])
   or (n.nspname = 'public' and ic.relname = any($2::text[]))
order by 1, 2, 3`,
    params: () => [AUDITED_TABLES, INDEX_NAMES],
  },
  policies: {
    sql: `select n.nspname::text as schema, c.relname::text as table_name, p.polname::text as name,
       p.polcmd::text as command, p.polpermissive as permissive,
       array(select case when r.role_oid = 0 then 'public' else pg_catalog.pg_get_userbyid(r.role_oid)::text end
             from pg_catalog.unnest(p.polroles) as r(role_oid) order by 1) as roles,
       pg_catalog.pg_get_expr(p.polqual, p.polrelid) as using_expression,
       pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) as check_expression
from pg_catalog.pg_policy p
join pg_catalog.pg_class c on c.oid = p.polrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where ${qualifiedName('n.nspname', 'c.relname')} = any($1::text[])
order by 1, 2, 3`,
    params: () => [AUDITED_TABLES],
  },
  triggers: {
    sql: `select n.nspname::text as schema, c.relname::text as table_name, t.tgname::text as name,
       t.tgtype::int as type_bits, t.tgenabled::text as enabled,
       pn.nspname::text as function_schema, p.proname::text as function_name,
       t.tgnargs::int as argument_count, (t.tgqual is not null) as has_when,
       (t.tgattr::text <> '') as has_columns,
       pg_catalog.pg_get_triggerdef(t.oid) as definition
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
join pg_catalog.pg_proc p on p.oid = t.tgfoid
join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
where not t.tgisinternal and ${qualifiedName('n.nspname', 'c.relname')} = any($1::text[])
order by 1, 2, 3`,
    params: () => [TRIGGER_TABLES],
  },
  functions: {
    sql: `select n.nspname::text as schema, p.proname::text as name,
       pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
       pg_catalog.pg_get_function_result(p.oid) as result,
       l.lanname::text as language, p.prosecdef as security_definer,
       p.provolatile::text as volatility, p.proconfig::text[] as config, p.prosrc as source,
       (p.proacl is null) as default_acl,
       array(select case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end
             from pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) as a
             where a.privilege_type = 'EXECUTE' order by 1) as execute_grantees,
       case when pg_catalog.to_regrole('anon') is not null
            then pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') end as anon_can_execute,
       case when pg_catalog.to_regrole('authenticated') is not null
            then pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') end as authenticated_can_execute
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
join pg_catalog.pg_language l on l.oid = p.prolang
where n.nspname = $1 and p.proname = any($2::text[])
order by 1, 2, 3`,
    params: () => ['public', FUNCTION_NAMES],
  },
  publication: {
    sql: `select p.pubname::text as name, p.puballtables as all_tables,
       array(select pt.schemaname::text || '.' || pt.tablename::text
             from pg_catalog.pg_publication_tables pt where pt.pubname = p.pubname order by 1) as tables
from pg_catalog.pg_publication p
where p.pubname = $1`,
    params: () => [PUBLICATION],
  },
  seeds: {
    readsApplicationData: 'public.system_categories: per-seed match counts and a total row count (aggregates only)',
    sql: `select e.ord,
       (select pg_catalog.count(*) from public.system_categories s
         where s.name = e.name and s.icon = e.icon and s.color = e.color and s.type = e.type
           and s.sort_order = e.sort_order)::int as exact_matches,
       (select pg_catalog.count(*) from public.system_categories s
         where s.name = e.name and s.type = e.type)::int as name_matches,
       (select pg_catalog.count(*) from public.system_categories)::int as total_rows
from pg_catalog.jsonb_to_recordset($1::jsonb) as e(ord int, name text, icon text, color text, type text, sort_order int)
order by e.ord`,
    params: () => [seedParameter()],
  },
  backfillTransactions: {
    readsApplicationData: 'public.transactions and public.accounts: one boolean (does any row point at another user’s account)',
    sql: `select exists (select 1 from public.transactions t
       where t.account_id is not null
         and not exists (select 1 from public.accounts a where a.id = t.account_id and a.user_id = t.user_id)) as has_unmatched`,
    params: () => [],
  },
  backfillRecurring: {
    readsApplicationData: 'public.recurring_transactions and public.accounts: one boolean (does any row point at another user’s account)',
    sql: `select exists (select 1 from public.recurring_transactions r
       where r.account_id is not null
         and not exists (select 1 from public.accounts a where a.id = r.account_id and a.user_id = r.user_id)) as has_unmatched`,
    params: () => [],
  },
});

// ---------------------------------------------------------------------------------------------
// Read-only enforcement
// ---------------------------------------------------------------------------------------------

const FORBIDDEN_WORDS = new Set(
  (
    'insert update delete merge upsert create alter drop grant revoke truncate copy call do execute exec notify listen unlisten ' +
    'lock share nowait vacuum analyze analyse refresh cluster reindex comment security set reset begin start commit rollback abort ' +
    'savepoint release prepare deallocate discard import load into checkpoint reassign declare fetch move close returning'
  ).split(' ')
);
/** Unqualified constructs that look like calls but cannot be shadowed by user functions. */
const CONSTRUCTS = new Set(['array', 'coalesce', 'exists', 'any', 'in']);
const KEYWORDS_BEFORE_PAREN = new Set(['select', 'from', 'join', 'where', 'and', 'or', 'not', 'on', 'when', 'then', 'else', 'as', 'using']);
/** Read-only catalog functions, always schema-qualified with pg_catalog. */
const CATALOG_FUNCTIONS = new Set([
  'current_setting',
  'format_type',
  'pg_get_expr',
  'pg_get_constraintdef',
  'pg_get_indexdef',
  'pg_get_triggerdef',
  'pg_get_function_result',
  'pg_get_function_identity_arguments',
  'pg_get_userbyid',
  'aclexplode',
  'acldefault',
  'has_function_privilege',
  'to_regrole',
  'pg_has_role',
  'unnest',
  'generate_series',
  'jsonb_to_recordset',
  'count',
]);

/** Throws unless `sql` is one SELECT, WITH or SHOW statement that calls only allowed read-only functions. */
function assertReadOnlyStatement(sql) {
  if (typeof sql !== 'string' || !sql.trim()) throw new RunnerError('Refusing an empty audit statement.');
  if (/--|\/\*|\$\$|\$[a-z_]/i.test(sql)) throw new RunnerError('Audit statements may not contain comments or dollar quoting.');
  const withoutLiterals = sql.replace(/'(?:[^']|'')*'/g, "''");
  if (/'/.test(withoutLiterals.replace(/''/g, ''))) throw new RunnerError('Audit statement has an unterminated string literal.');
  if (withoutLiterals.includes(';')) throw new RunnerError('Audit statements must be a single statement without semicolons.');
  const lower = withoutLiterals.toLowerCase().replace(/"[^"]*"/g, ' quoted_identifier ');
  if (!/^\s*(select|with|show)\b/.test(lower)) throw new RunnerError('Audit statements must start with SELECT, WITH or SHOW.');
  if (/^\s*show\b/.test(lower) && !/^\s*show\s+[a-z_][a-z0-9_.]*\s*$/.test(lower)) {
    throw new RunnerError('SHOW audit statements may only name one setting.');
  }
  for (const word of lower.match(/[a-z_][a-z0-9_$]*/g) || []) {
    if (FORBIDDEN_WORDS.has(word)) throw new RunnerError(`Audit statements may not contain ${word.toUpperCase()}.`);
  }
  for (const match of lower.matchAll(/([a-z_][a-z0-9_$]*)(?:\s*\.\s*([a-z_][a-z0-9_$]*))?\s*\(/g)) {
    const [, first, second] = match;
    if (/\bas\s*$/.test(lower.slice(0, match.index))) continue;
    if (second !== undefined) {
      if (first !== 'pg_catalog' || !CATALOG_FUNCTIONS.has(second)) {
        throw new RunnerError(`Audit statements may not call ${first}.${second}().`);
      }
      continue;
    }
    if (!CONSTRUCTS.has(first) && !KEYWORDS_BEFORE_PAREN.has(first)) {
      throw new RunnerError(`Audit statements may only call pg_catalog functions, not ${first}().`);
    }
  }
}

function assertAuditStatements() {
  for (const statement of Object.values(STATEMENTS)) assertReadOnlyStatement(statement.sql);
}

async function auditQuery(client, id) {
  const statement = STATEMENTS[id];
  if (!statement) throw new RunnerError(`Unknown audit statement ${id}.`);
  assertReadOnlyStatement(statement.sql);
  const result = await client.query({ text: statement.sql, values: statement.params() });
  return (result && result.rows) || [];
}

function verifySession(row) {
  if (!row || row.transaction_read_only !== 'on') {
    throw new RunnerError('The database session did not confirm a read-only transaction. Nothing was audited.');
  }
  if (row.statement_timeout !== SESSION_LIMITS.statementTimeout || row.lock_timeout !== SESSION_LIMITS.lockTimeout) {
    throw new RunnerError('The database session did not accept the audit statement and lock timeouts. Nothing was audited.');
  }
}

// ---------------------------------------------------------------------------------------------
// Snapshot collection
// ---------------------------------------------------------------------------------------------

const errorCode = (error) => (error && (error.code || error.errno)) || 'error';

/**
 * Catalog facts for the audited objects, collected in one read-only transaction that is always
 * rolled back. The client must behave like a node-postgres Client.
 */
async function collectSnapshot(client) {
  const meta = { connected: false, began: false, rolledBack: false, dataQueries: [] };
  if (typeof client.on === 'function') client.on('error', () => {});
  try {
    await client.connect();
    meta.connected = true;
    await client.query(CONTROL.begin);
    meta.began = true;
    await client.query(CONTROL.statementTimeout);
    await client.query(CONTROL.lockTimeout);
    await client.query(CONTROL.idleTimeout);
    const [session] = await auditQuery(client, 'session');
    verifySession(session);
    const snapshot = { session, meta };
    snapshot.namespaces = (await auditQuery(client, 'namespaces')).map((row) => row.name);
    snapshot.extensions = await auditQuery(client, 'extensions');
    snapshot.relations = await auditQuery(client, 'relations');
    snapshot.columns = await auditQuery(client, 'columns');
    snapshot.constraints = await auditQuery(client, 'constraints');
    snapshot.indexes = await auditQuery(client, 'indexes');
    snapshot.policies = await auditQuery(client, 'policies');
    snapshot.triggers = await auditQuery(client, 'triggers');
    snapshot.functions = await auditQuery(client, 'functions');
    snapshot.publication = (await auditQuery(client, 'publication'))[0] || null;
    await collectDataEvidence(client, snapshot);
    return snapshot;
  } finally {
    if (meta.began) {
      try {
        await client.query(CONTROL.rollback);
        meta.rolledBack = true;
      } catch {
        meta.rolledBack = false;
      }
    }
    try {
      await client.end();
    } catch {
      // Closing the connection also discards the transaction.
    }
  }
}

function hasColumns(snapshot, table, expected) {
  const columns = snapshot.columns.filter((row) => `${row.schema}.${row.table_name}` === table);
  return Object.entries(expected).every(([name, type]) => columns.some((row) => row.name === name && row.type === type));
}

/**
 * Application-table evidence, only where catalog facts cannot answer the question.
 * Runs last: a failure aborts the transaction, so later data checks become unknown.
 */
async function collectDataEvidence(client, snapshot) {
  const relation = (name) => snapshot.relations.find((row) => `${row.schema}.${row.name}` === name);
  let aborted = null;
  const run = async (id) => {
    snapshot.meta.dataQueries.push(STATEMENTS[id].readsApplicationData);
    return auditQuery(client, id);
  };

  const categories = relation('public.system_categories');
  if (!categories || !hasColumns(snapshot, 'public.system_categories', { name: 'text', icon: 'text', color: 'text', type: 'text', sort_order: 'integer' })) {
    snapshot.seeds = { status: 'skipped', reason: 'public.system_categories or its seed columns are missing' };
  } else if (categories.rls_filters_current_user) {
    snapshot.seeds = { status: 'unknown', reason: 'row level security would hide rows from this connection role' };
  } else {
    try {
      snapshot.seeds = { status: 'ok', rows: await run('seeds') };
    } catch (error) {
      aborted = errorCode(error);
      snapshot.seeds = { status: 'unknown', reason: `the seed count query failed (${aborted})` };
    }
  }

  snapshot.backfill = {};
  for (const spec of BACKFILL) {
    const constraint = snapshot.constraints.find(
      (row) => `${row.schema}.${row.table_name}` === spec.table && row.type === 'f' && row.name === spec.foreignKey
    );
    const fkSpec = MIGRATIONS.flatMap((migration) => migration.foreignKeys || []).find((fk) => fk.name === spec.foreignKey);
    if (constraint && !foreignKeyDifferences(constraint, fkSpec).length) {
      snapshot.backfill[spec.table] = { status: 'proven', reason: `the validated foreign key ${spec.foreignKey} guarantees it` };
      continue;
    }
    const table = relation(spec.table);
    const accounts = relation('public.accounts');
    if (!table || !accounts || !hasColumns(snapshot, spec.table, { account_id: 'uuid', user_id: 'uuid' }) || !hasColumns(snapshot, 'public.accounts', { id: 'uuid', user_id: 'uuid' })) {
      snapshot.backfill[spec.table] = { status: 'skipped', reason: `${spec.table}.account_id or public.accounts is missing` };
    } else if (aborted) {
      snapshot.backfill[spec.table] = { status: 'unknown', reason: `an earlier data query failed (${aborted})` };
    } else if (table.rls_filters_current_user || accounts.rls_filters_current_user) {
      snapshot.backfill[spec.table] = { status: 'unknown', reason: 'row level security would hide rows from this connection role' };
    } else {
      try {
        const [row] = await run(spec.statement);
        snapshot.backfill[spec.table] = { status: 'ok', hasUnmatched: Boolean(row && row.has_unmatched) };
      } catch (error) {
        aborted = errorCode(error);
        snapshot.backfill[spec.table] = { status: 'unknown', reason: `the backfill check failed (${aborted})` };
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------------------------

const ACTIONS = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' };
const COMMANDS = { r: 'SELECT', a: 'INSERT', w: 'UPDATE', d: 'DELETE', '*': 'ALL' };
/** Words followed by a parenthesised group rather than a call's argument list. */
const KEYWORD_OPERATORS = new Set(['and', 'or', 'not', 'is', 'in', 'then', 'else', 'when', 'case', 'between', 'like', 'ilike']);

/** Top level of `text` with nested parenthesised groups blanked out. */
function topLevel(text) {
  let depth = 0;
  let out = '';
  for (const char of text) {
    if (char === '(') depth += 1;
    out += depth > 0 ? ' ' : char;
    if (char === ')') depth -= 1;
  }
  return out;
}

function removeRedundantParens(text) {
  for (let changed = true; changed; ) {
    changed = false;
    const stack = [];
    for (let position = 0; position < text.length && !changed; position += 1) {
      if (text[position] === '(') stack.push(position);
      else if (text[position] === ')') {
        const open = stack.pop();
        if (open === undefined) return text;
        const before = open > 0 ? text[open - 1] : '';
        if (/[a-z0-9_$\]\u0001]/.test(before)) continue;
        const inner = text.slice(open + 1, position);
        const level = topLevel(inner).replace(/\bis not\b/g, 'is');
        if (/,/.test(level)) continue;
        const after = text[position + 1] || '';
        const sole = (before === '' || before === '(') && (after === '' || after === ')');
        const simple = !/( and | or |(^| )not )/.test(` ${level} `) && !/[+*/|%^-]/.test(level);
        if (sole || simple) {
          text = text.slice(0, open) + inner + text.slice(position + 1);
          changed = true;
        }
      }
    }
  }
  return text;
}

/**
 * PostgreSQL expression text in a canonical form: case, whitespace, identifier quotes, redundant
 * grouping parentheses and integer-literal casts normalised; string literals kept verbatim.
 */
function normalizeExpression(value) {
  if (value === null || value === undefined) return null;
  const literals = [];
  let text = String(value)
    .replace(/'(-?\d+)'::(bigint|integer|smallint)\b/gi, '$1')
    .replace(/\b(\d+)::(bigint|integer|smallint)\b/gi, '$1')
    .replace(/'(?:[^']|'')*'/g, (literal) => `\u0001${literals.push(literal) - 1}\u0001`);
  text = text
    .toLowerCase()
    .replace(/"([a-z_][a-z0-9_$]*)"/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/\s*([,=<>!:[\]+*/|-])\s*/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/([a-z_][a-z0-9_$]*) \(/g, (match, word) => (KEYWORD_OPERATORS.has(word) ? match : `${word}(`))
    .trim();
  text = removeRedundantParens(text);
  return text.replace(/\u0001(\d+)\u0001/g, (_, position) => literals[Number(position)]);
}

const sameExpression = (actual, expected) => normalizeExpression(actual) === normalizeExpression(expected);
const sameList = (actual, expected) => JSON.stringify(actual || []) === JSON.stringify(expected || []);
const normalizeBody = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const bodyHash = (value) => createHash('sha256').update(normalizeBody(value)).digest('hex').slice(0, 12);
const tableOf = (row) => `${row.schema}.${row.table_name}`;
const refOf = (row) => (row.ref_table ? `${row.ref_schema}.${row.ref_table}` : null);

function decodeTrigger(bits) {
  return {
    timing: bits & 2 ? 'BEFORE' : bits & 64 ? 'INSTEAD OF' : 'AFTER',
    events: [
      [4, 'INSERT'],
      [8, 'DELETE'],
      [16, 'UPDATE'],
      [32, 'TRUNCATE'],
    ]
      .filter(([bit]) => bits & bit)
      .map(([, name]) => name),
    level: bits & 1 ? 'ROW' : 'STATEMENT',
  };
}

function foreignKeyDifferences(row, spec) {
  if (!spec) return ['no expected definition'];
  const diffs = [];
  if (!sameList(row.columns, spec.columns)) diffs.push(`columns (${row.columns.join(', ')}), expected (${spec.columns.join(', ')})`);
  if (refOf(row) !== spec.ref || !sameList(row.ref_columns, spec.refColumns)) {
    diffs.push(`references ${refOf(row)} (${(row.ref_columns || []).join(', ')}), expected ${spec.ref} (${spec.refColumns.join(', ')})`);
  }
  if (row.on_delete !== spec.onDelete) diffs.push(`ON DELETE ${ACTIONS[row.on_delete] || row.on_delete}, expected ${ACTIONS[spec.onDelete]}`);
  if (row.on_update !== 'a') diffs.push(`ON UPDATE ${ACTIONS[row.on_update] || row.on_update}, expected NO ACTION`);
  if (row.match_type !== 's') diffs.push(`MATCH ${row.match_type === 'f' ? 'FULL' : row.match_type}, expected MATCH SIMPLE`);
  if (!row.validated) diffs.push('NOT VALID (existing rows were never checked)');
  if (row.deferrable) diffs.push('DEFERRABLE, expected NOT DEFERRABLE');
  return diffs;
}

const pass = (detail) => ({ result: 'pass', detail });
const missing = (detail) => ({ result: 'missing', detail });
const mismatch = (detail) => ({ result: 'mismatch', detail });
const unknown = (detail) => ({ result: 'unknown', detail });

function indexSnapshot(snapshot) {
  const group = (rows, key) => {
    const map = new Map();
    for (const row of rows || []) map.set(key(row), [...(map.get(key(row)) || []), row]);
    return map;
  };
  const ctx = {
    snapshot,
    namespaces: new Set(snapshot.namespaces || []),
    extensions: new Map((snapshot.extensions || []).map((row) => [row.name, row])),
    relations: new Map((snapshot.relations || []).map((row) => [`${row.schema}.${row.name}`, row])),
    columns: group(snapshot.columns, tableOf),
    constraints: group(snapshot.constraints, tableOf),
    indexes: group((snapshot.indexes || []).filter((row) => row.schema === 'public'), (row) => row.name),
    policies: group(snapshot.policies, tableOf),
    triggers: group(snapshot.triggers, tableOf),
    functions: group(snapshot.functions, (row) => row.name),
    matched: new Set(),
  };
  ctx.column = (table, name) => (ctx.columns.get(table) || []).find((row) => row.name === name);
  ctx.foreignKeys = (table) => (ctx.constraints.get(table) || []).filter((row) => row.type === 'f');
  ctx.match = (kind, table, name) => ctx.matched.add(`${kind}:${table}:${name}`);
  return ctx;
}

function evaluateColumn(ctx, table, spec) {
  const row = ctx.column(table, spec.name);
  if (!row) return missing();
  const diffs = [];
  if (row.type !== spec.type) diffs.push(`type ${row.type}, expected ${spec.type}`);
  if (row.nullable !== spec.nullable) diffs.push(row.nullable ? 'nullable, expected NOT NULL' : 'NOT NULL, expected nullable');
  if (!sameExpression(row.default_value, spec.default)) diffs.push(`default ${row.default_value ?? 'none'}, expected ${spec.default ?? 'none'}`);
  if (row.identity) diffs.push('identity column');
  if (row.generated) diffs.push('generated column');
  return diffs.length ? mismatch(diffs.join('; ')) : pass();
}

function evaluateForeignKey(ctx, spec) {
  const keys = ctx.foreignKeys(spec.table);
  const sameShape = (row) => sameList(row.columns, spec.columns) && refOf(row) === spec.ref;
  const candidates = spec.name ? keys.filter((row) => row.name === spec.name) : keys.filter(sameShape);
  const exact = candidates.find((row) => !foreignKeyDifferences(row, spec).length);
  if (exact) {
    ctx.match('constraint', spec.table, exact.name);
    return pass(exact.name);
  }
  if (candidates.length) {
    ctx.match('constraint', spec.table, candidates[0].name);
    return mismatch(`${candidates[0].name}: ${foreignKeyDifferences(candidates[0], spec).join('; ')}`);
  }
  if (spec.name) {
    const renamed = keys.find((row) => !foreignKeyDifferences(row, spec).length);
    if (renamed) {
      ctx.match('constraint', spec.table, renamed.name);
      return mismatch(`present as ${renamed.name}, expected the name ${spec.name}`);
    }
  }
  if (spec.supersededBy) {
    const successor = keys.find(
      (row) => sameList(row.columns, spec.supersededBy.columns) && refOf(row) === spec.ref && sameList(row.ref_columns, spec.supersededBy.refColumns)
    );
    if (successor) return pass(`replaced by ${successor.name} from ${spec.supersededBy.version}`);
  }
  const elsewhere = keys.find((row) => sameList(row.columns, spec.columns));
  if (elsewhere) {
    ctx.match('constraint', spec.table, elsewhere.name);
    return mismatch(`${elsewhere.name}: ${foreignKeyDifferences(elsewhere, spec).join('; ')}`);
  }
  return missing();
}

function evaluateCheck(ctx, spec) {
  const checks = (ctx.constraints.get(spec.table) || []).filter((row) => row.type === 'c');
  const stripped = (row) => String(row.definition).replace(/\s+NOT VALID\s*$/i, '');
  const found = checks.find((row) => sameExpression(stripped(row), spec.definition));
  if (found) {
    ctx.match('constraint', spec.table, found.name);
    return found.validated ? pass(found.name) : mismatch(`${found.name} is NOT VALID (existing rows were never checked)`);
  }
  const named = checks.find((row) => row.name === spec.name);
  if (named) {
    ctx.match('constraint', spec.table, named.name);
    return mismatch(`${named.name} is ${named.definition}, expected ${spec.definition}`);
  }
  return missing(spec.definition);
}

function evaluateIndex(ctx, spec) {
  const rows = ctx.indexes.get(spec.name) || [];
  if (!rows.length) return missing();
  const row = rows[0];
  ctx.match('index', tableOf(row), row.name);
  const diffs = [];
  if (tableOf(row) !== spec.table) diffs.push(`on ${tableOf(row)}, expected ${spec.table}`);
  if (row.method !== 'btree') diffs.push(`USING ${row.method}, expected btree`);
  if (Boolean(row.is_unique) !== spec.unique) diffs.push(row.is_unique ? 'UNIQUE, expected non-unique' : 'non-unique, expected UNIQUE');
  const columns = (row.columns || []).map(normalizeExpression);
  if (!sameList(columns, spec.columns.map(normalizeExpression))) diffs.push(`columns (${(row.columns || []).join(', ')}), expected (${spec.columns.join(', ')})`);
  if ((row.options || []).some((option) => option !== 0)) diffs.push('non-default ordering (DESC or NULLS FIRST)');
  if (row.column_count !== row.key_count) diffs.push('has INCLUDE columns');
  if (!sameExpression(row.predicate, spec.predicate)) diffs.push(`WHERE ${row.predicate ?? 'none'}, expected ${spec.predicate ?? 'none'}`);
  if (!row.is_valid || !row.is_ready) diffs.push('index is not valid or not ready');
  return diffs.length ? mismatch(diffs.join('; ')) : pass();
}

function evaluatePolicy(ctx, spec) {
  const row = (ctx.policies.get(spec.table) || []).find((policy) => policy.name === spec.name);
  if (!row) return missing();
  ctx.match('policy', spec.table, row.name);
  const diffs = [];
  const command = COMMANDS[row.command] || row.command;
  if (command !== spec.command) diffs.push(`FOR ${command}, expected FOR ${spec.command}`);
  if (!row.permissive) diffs.push('RESTRICTIVE, expected PERMISSIVE');
  if (!sameList([...(row.roles || [])].sort(), [...spec.roles].sort())) diffs.push(`TO ${(row.roles || []).join(', ')}, expected TO ${spec.roles.join(', ')}`);
  if (!sameExpression(row.using_expression, spec.using)) diffs.push(`USING ${row.using_expression ?? 'none'}, expected ${spec.using ?? 'none'}`);
  if (!sameExpression(row.check_expression, spec.check)) diffs.push(`WITH CHECK ${row.check_expression ?? 'none'}, expected ${spec.check ?? 'none'}`);
  return diffs.length ? mismatch(diffs.join('; ')) : pass();
}

function evaluateFunction(ctx, spec) {
  const rows = ctx.functions.get(spec.name) || [];
  const row = rows.find((fn) => fn.arguments === spec.arguments);
  if (!row) return rows.length ? mismatch(`only other signatures exist: ${rows.map((fn) => `${spec.name}(${fn.arguments})`).join(', ')}`) : missing();
  ctx.match('function', 'public', `${row.name}(${row.arguments})`);
  const diffs = [];
  if (row.result !== spec.result) diffs.push(`returns ${row.result}, expected ${spec.result}`);
  if (row.language !== spec.language) diffs.push(`LANGUAGE ${row.language}, expected ${spec.language}`);
  if (Boolean(row.security_definer) !== spec.securityDefiner) diffs.push(row.security_definer ? 'SECURITY DEFINER, expected SECURITY INVOKER' : 'SECURITY INVOKER, expected SECURITY DEFINER');
  if (row.volatility !== spec.volatility) diffs.push(`volatility ${row.volatility}, expected ${spec.volatility}`);
  const config = [...(row.config || [])].sort();
  if (!sameList(config, spec.config ? [...spec.config].sort() : [])) diffs.push(`settings [${config.join(', ') || 'none'}], expected [${(spec.config || []).join(', ') || 'none'}]`);
  if (normalizeBody(row.source) !== normalizeBody(spec.body)) diffs.push(`body differs (sha256 ${bodyHash(row.source)}, expected ${bodyHash(spec.body)})`);
  return diffs.length ? mismatch(diffs.join('; ')) : pass();
}

function evaluateTrigger(ctx, spec) {
  const row = (ctx.triggers.get(spec.table) || []).find((trigger) => trigger.name === spec.name);
  if (!row) return missing();
  ctx.match('trigger', spec.table, row.name);
  const decoded = decodeTrigger(row.type_bits);
  const diffs = [];
  if (decoded.timing !== spec.timing) diffs.push(`${decoded.timing}, expected ${spec.timing}`);
  if (!sameList([...decoded.events].sort(), [...spec.events].sort())) diffs.push(`ON ${decoded.events.join(' OR ')}, expected ON ${spec.events.join(' OR ')}`);
  if (decoded.level !== 'ROW') diffs.push('FOR EACH STATEMENT, expected FOR EACH ROW');
  const fn = `${row.function_schema}.${row.function_name}`;
  if (fn !== spec.function) diffs.push(`executes ${fn}(), expected ${spec.function}()`);
  if (row.enabled !== 'O') diffs.push(row.enabled === 'D' ? 'disabled' : `enabled mode ${row.enabled}, expected the default`);
  if (row.has_when) diffs.push('has a WHEN condition');
  if (row.has_columns) diffs.push('limited to UPDATE OF columns');
  if (row.argument_count) diffs.push('passes trigger arguments');
  return diffs.length ? mismatch(diffs.join('; ')) : pass();
}

function evaluatePrivilege(ctx, spec) {
  const row = (ctx.functions.get(spec.function) || []).find((fn) => fn.arguments === '');
  if (!row) return missing(`public.${spec.function}() does not exist`);
  const grantees = row.execute_grantees || [];
  const viaPublic = grantees.includes('PUBLIC');
  const explicit = grantees.includes(spec.role);
  const source = `EXECUTE grantees: ${grantees.join(', ') || 'none'}${row.default_acl ? ' (default ACL, never granted or revoked)' : ''}`;
  if (spec.role === 'PUBLIC') return viaPublic ? missing(`PUBLIC can execute. ${source}`) : pass(source);
  const effective = spec.role === 'anon' ? row.anon_can_execute : row.authenticated_can_execute;
  if (effective === null || effective === undefined) return unknown(`role ${spec.role} does not exist`);
  const how = [explicit ? 'an explicit grant' : null, viaPublic ? 'PUBLIC' : null].filter(Boolean).join(' and ') || 'role membership';
  if (spec.expect === 'none') return effective ? missing(`${spec.role} can execute through ${how}. ${source}`) : pass(source);
  if (!effective) return missing(`${spec.role} cannot execute. ${source}`);
  if (!explicit) return mismatch(`${spec.role} can execute only through ${how}, not an explicit grant. ${source}`);
  return pass(source);
}

function evaluateSeed(ctx, seed, position) {
  const seeds = ctx.snapshot.seeds || { status: 'skipped', reason: 'not collected' };
  if (seeds.status === 'skipped') return missing(seeds.reason);
  if (seeds.status !== 'ok') return unknown(seeds.reason);
  const row = seeds.rows.find((entry) => entry.ord === position + 1);
  if (!row) return unknown('no count returned');
  if (row.exact_matches > 0) return pass(row.exact_matches > 1 ? `${row.exact_matches} identical rows` : undefined);
  if (row.name_matches > 0) return mismatch('a row with this name and type has a different icon, colour or sort order');
  return missing();
}

function evaluateBackfill(ctx, spec) {
  const evidence = (ctx.snapshot.backfill || {})[spec.table];
  if (!evidence) return unknown('not collected');
  if (evidence.status === 'proven') return pass(evidence.reason);
  if (evidence.status === 'ok') {
    return evidence.hasUnmatched ? missing('rows still point at an account owned by a different user (count not read)') : pass('boolean check found none');
  }
  if (evidence.status === 'skipped') return missing(evidence.reason);
  return unknown(evidence.reason);
}

/** Every check for one migration: { kind, label, distinctive, evaluate(ctx) }. */
function checksFor(migration) {
  const checks = [];
  const add = (kind, label, evaluate, distinctive = true) => checks.push({ kind, label, evaluate, distinctive });
  for (const name of migration.schemas || []) add('schema', `schema ${name} exists`, (ctx) => (ctx.namespaces.has(name) ? pass() : missing()), false);
  for (const name of migration.extensions || []) {
    add('extension', `extension ${name} installed`, (ctx) => (ctx.extensions.has(name) ? pass(`schema ${ctx.extensions.get(name).schema}`) : missing()), false);
  }
  for (const name of migration.prerequisites || []) add('relation', `${name} exists`, (ctx) => (ctx.relations.has(name) ? pass() : missing()), false);
  for (const table of migration.tables || []) {
    add('table', `table ${table.name}`, (ctx) => {
      const row = ctx.relations.get(table.name);
      if (!row) return missing();
      return ['r', 'p'].includes(row.kind) ? pass() : mismatch(`exists as relation kind ${row.kind}, expected a table`);
    });
    for (const spec of table.columns) add('column', `column ${table.name}.${spec.name}`, (ctx) => evaluateColumn(ctx, table.name, spec));
  }
  for (const spec of migration.columns || []) add('column', `column ${spec.table}.${spec.name}`, (ctx) => evaluateColumn(ctx, spec.table, spec));
  for (const spec of migration.primaryKeys || []) {
    add('primaryKey', `primary key ${spec.table} (${spec.columns.join(', ')})`, (ctx) => {
      const row = (ctx.constraints.get(spec.table) || []).find((constraint) => constraint.type === 'p');
      if (!row) return missing();
      ctx.match('constraint', spec.table, row.name);
      return sameList(row.columns, spec.columns) ? pass(row.name) : mismatch(`${row.name} is on (${row.columns.join(', ')})`);
    });
  }
  for (const spec of migration.foreignKeys || []) {
    const label = `foreign key ${spec.name ? `${spec.name} ` : ''}${spec.table} (${spec.columns.join(', ')}) → ${spec.ref} (${spec.refColumns.join(', ')}) ON DELETE ${ACTIONS[spec.onDelete]}`;
    add('foreignKey', label, (ctx) => evaluateForeignKey(ctx, spec));
  }
  for (const spec of migration.checks || []) add('check', `check ${spec.name} on ${spec.table}`, (ctx) => evaluateCheck(ctx, spec));
  for (const spec of migration.uniques || []) {
    add('unique', `unique ${spec.name} on ${spec.table} (${spec.columns.join(', ')})`, (ctx) => {
      const uniques = (ctx.constraints.get(spec.table) || []).filter((row) => row.type === 'u');
      const named = uniques.find((row) => row.name === spec.name);
      if (named) {
        ctx.match('constraint', spec.table, named.name);
        return sameList(named.columns, spec.columns) ? pass() : mismatch(`${named.name} is on (${named.columns.join(', ')})`);
      }
      const renamed = uniques.find((row) => sameList(row.columns, spec.columns));
      if (renamed) {
        ctx.match('constraint', spec.table, renamed.name);
        return mismatch(`present as ${renamed.name}, expected the name ${spec.name}`);
      }
      return missing();
    });
  }
  for (const spec of migration.indexes || []) add('index', `index ${spec.name} on ${spec.table}`, (ctx) => evaluateIndex(ctx, spec));
  for (const table of migration.rls || []) {
    add('rls', `row level security enabled on ${table}`, (ctx) => {
      const row = ctx.relations.get(table);
      if (!row) return missing(`${table} does not exist`);
      return row.rls_enabled ? pass() : missing('row level security is disabled');
    });
  }
  for (const spec of migration.policies || []) add('policy', `policy ${spec.name} on ${spec.table}`, (ctx) => evaluatePolicy(ctx, spec));
  for (const spec of migration.functions || []) add('function', `function public.${spec.name}(${spec.arguments})`, (ctx) => evaluateFunction(ctx, spec));
  for (const spec of migration.triggers || []) add('trigger', `trigger ${spec.name} on ${spec.table}`, (ctx) => evaluateTrigger(ctx, spec));
  for (const table of migration.publication || []) {
    add('publication', `${table} in publication ${PUBLICATION}`, (ctx) => {
      const publication = ctx.snapshot.publication;
      if (!publication) return missing(`publication ${PUBLICATION} does not exist`);
      return publication.all_tables || (publication.tables || []).includes(table) ? pass() : missing();
    });
  }
  (migration.seeds || []).forEach((seed, position) => {
    add('seed', `system category ${seed.name} (${seed.type})`, (ctx) => evaluateSeed(ctx, seed, position));
  });
  for (const spec of migration.absentForeignKeys || []) {
    add(
      'absentForeignKey',
      `no single-column foreign key ${spec.table} (${spec.columns.join(', ')}) → ${spec.ref}`,
      (ctx) => {
        const left = ctx.foreignKeys(spec.table).find((row) => sameList(row.columns, spec.columns) && refOf(row) === spec.ref);
        if (!left) return pass();
        ctx.match('constraint', spec.table, left.name);
        return mismatch(`${left.name} is still present`);
      },
      false
    );
  }
  for (const spec of migration.nullability || []) {
    add(
      'nullability',
      `${spec.table}.${spec.column} is ${spec.nullable ? 'nullable' : 'NOT NULL'}`,
      (ctx) => {
        const row = ctx.column(spec.table, spec.column);
        if (!row) return missing();
        return row.nullable === spec.nullable ? pass() : mismatch(row.nullable ? 'nullable' : 'NOT NULL');
      },
      false
    );
  }
  for (const spec of migration.backfill || []) {
    add('backfill', `no ${spec.table} row points at another user's account`, (ctx) => evaluateBackfill(ctx, spec), false);
  }
  for (const spec of migration.privileges || []) {
    const label =
      spec.role === 'PUBLIC'
        ? `PUBLIC has no EXECUTE on public.${spec.function}()`
        : spec.expect === 'none'
          ? `${spec.role} cannot execute public.${spec.function}()`
          : `${spec.role} has an explicit EXECUTE grant on public.${spec.function}()`;
    add('privilege', label, (ctx) => evaluatePrivilege(ctx, spec), spec.distinctive !== false);
  }
  return checks;
}

function classify(results) {
  if (results.some((check) => check.result === 'unknown')) return STATUS.ambiguous;
  if (results.every((check) => check.result === 'pass')) return STATUS.full;
  const distinctive = results.filter((check) => check.distinctive);
  if (!distinctive.some((check) => check.result === 'pass')) {
    return distinctive.some((check) => check.result === 'mismatch') ? STATUS.ambiguous : STATUS.none;
  }
  return STATUS.partial;
}

const NEXT_ACTION = {
  [STATUS.full]: 'Candidate to record as applied after review. This tool never records it.',
  [STATUS.partial]: 'Do not record. Decide how to complete or correct the missing and mismatched items first.',
  [STATUS.none]: 'Do not record. Leave it pending for the guarded runner once the earlier versions are settled.',
  [STATUS.ambiguous]: 'Do not record. Resolve the unknown or conflicting items by hand first.',
};

const KIND_LABELS = {
  schema: 'schemas',
  extension: 'extensions',
  relation: 'prerequisites',
  table: 'tables',
  column: 'columns',
  primaryKey: 'primary keys',
  foreignKey: 'foreign keys',
  check: 'checks',
  unique: 'unique constraints',
  index: 'indexes',
  rls: 'RLS',
  policy: 'policies',
  function: 'functions',
  trigger: 'triggers',
  publication: 'realtime',
  seed: 'seeds',
  absentForeignKey: 'dropped FKs',
  nullability: 'nullability',
  backfill: 'backfill',
  privilege: 'privileges',
};

function evidenceSummary(results) {
  const kinds = [];
  for (const check of results) if (!kinds.includes(check.kind)) kinds.push(check.kind);
  return kinds
    .map((kind) => {
      const ofKind = results.filter((check) => check.kind === kind);
      return `${KIND_LABELS[kind]} ${ofKind.filter((check) => check.result === 'pass').length}/${ofKind.length}`;
    })
    .join(', ');
}

/** Objects on the audited tables that no migration expects. */
function findUnexpected(ctx) {
  const items = [];
  const expectedColumns = new Map();
  for (const migration of MIGRATIONS) {
    for (const table of migration.tables || []) for (const spec of table.columns) expectedColumns.set(table.name, [...(expectedColumns.get(table.name) || []), spec.name]);
    for (const spec of migration.columns || []) expectedColumns.set(spec.table, [...(expectedColumns.get(spec.table) || []), spec.name]);
  }
  for (const table of AUDITED_TABLES) {
    if (!ctx.relations.has(table)) continue;
    for (const row of ctx.columns.get(table) || []) {
      if ((expectedColumns.get(table) || []).includes(row.name)) continue;
      const blocking = !row.nullable && row.default_value === null;
      items.push({
        severity: blocking ? 'conflict' : 'info',
        text: `column ${table}.${row.name} (${row.type}${row.nullable ? '' : ', NOT NULL'}${blocking ? ', no default: app inserts would fail' : ''})`,
      });
    }
    for (const row of ctx.constraints.get(table) || []) {
      if (row.type === 'n' || ctx.matched.has(`constraint:${table}:${row.name}`)) continue;
      items.push({ severity: 'conflict', text: `constraint ${row.name} on ${table}: ${row.definition}` });
    }
    for (const row of (ctx.snapshot.indexes || []).filter((entry) => tableOf(entry) === table)) {
      if (row.backs_constraint || ctx.matched.has(`index:${table}:${row.name}`)) continue;
      items.push({ severity: 'info', text: `index ${row.name}: ${row.definition}` });
    }
    for (const row of ctx.policies.get(table) || []) {
      if (ctx.matched.has(`policy:${table}:${row.name}`)) continue;
      const effect = row.permissive ? 'PERMISSIVE: adds access on top of the owner-only policies' : 'RESTRICTIVE: can block the owner-only policies';
      items.push({
        severity: 'conflict',
        text: `policy ${row.name} on ${table} (FOR ${COMMANDS[row.command] || row.command} TO ${(row.roles || []).join(', ')}; USING ${row.using_expression ?? 'none'}; WITH CHECK ${row.check_expression ?? 'none'}) is ${effect}`,
      });
    }
    for (const row of ctx.triggers.get(table) || []) {
      if (ctx.matched.has(`trigger:${table}:${row.name}`)) continue;
      items.push({ severity: 'conflict', text: `trigger ${row.name} on ${table}: ${row.definition}` });
    }
    const relation = ctx.relations.get(table);
    if (relation.rls_forced) items.push({ severity: 'info', text: `${table} has FORCE ROW LEVEL SECURITY (not set by any migration)` });
  }
  for (const row of ctx.snapshot.functions || []) {
    if (ctx.matched.has(`function:public:${row.name}(${row.arguments})`)) continue;
    items.push({ severity: 'info', text: `function public.${row.name}(${row.arguments}) is an extra overload` });
  }
  const sync = (ctx.functions.get('sync_server_time') || []).find((row) => row.arguments === '');
  if (sync) {
    const extra = (sync.execute_grantees || []).filter((role) => !['authenticated', 'PUBLIC', 'anon'].includes(role));
    if (extra.length) items.push({ severity: 'info', text: `public.sync_server_time() is also executable by: ${extra.join(', ')} (owner and Supabase service roles)` });
  }
  const seeds = ctx.snapshot.seeds;
  if (seeds && seeds.status === 'ok' && seeds.rows.length) {
    const duplicates = seeds.rows.reduce((sum, row) => sum + Math.max(0, row.exact_matches - 1), 0);
    const matched = seeds.rows.reduce((sum, row) => sum + row.exact_matches, 0);
    const other = seeds.rows[0].total_rows - matched;
    if (duplicates) items.push({ severity: 'info', text: `public.system_categories has ${duplicates} duplicate seed row(s) (001 inserts without a unique key, so a second run duplicates them)` });
    if (other > 0) items.push({ severity: 'info', text: `public.system_categories has ${other} row(s) that match no 001 seed definition (contents not read)` });
  }
  return items;
}

/** The audit report for a collected snapshot. */
function evaluate(snapshot) {
  const ctx = indexSnapshot(snapshot);
  const migrations = MIGRATIONS.map((migration) => {
    const results = checksFor(migration).map((check) => ({ kind: check.kind, label: check.label, distinctive: check.distinctive, ...check.evaluate(ctx) }));
    const status = classify(results);
    return {
      version: migration.version,
      file: migration.file,
      status,
      results,
      passed: results.filter((check) => check.result === 'pass').length,
      missing: results.filter((check) => check.result === 'missing'),
      mismatched: results.filter((check) => check.result === 'mismatch'),
      unknown: results.filter((check) => check.result === 'unknown'),
      evidence: evidenceSummary(results),
      nextAction: NEXT_ACTION[status],
      unprovable: migration.unprovable || [],
    };
  });
  let prefix = 0;
  while (prefix < migrations.length && migrations[prefix].status === STATUS.full) prefix += 1;
  return {
    migrations,
    unexpected: findUnexpected(ctx),
    fullyPresentPrefix: migrations.slice(0, prefix).map((migration) => migration.version),
    session: snapshot.session,
    meta: snapshot.meta,
  };
}

// ---------------------------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------------------------

/** Catalog text made safe to print: no user IDs, emails or tokens, bounded length. */
function safeText(value, limit = 220) {
  const text = String(value ?? '')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, (uuid) => (uuid === NIL_UUID ? uuid : '<uuid>'))
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '<token>')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

const cell = (value) => safeText(value, 400).replace(/\|/g, '\\|');

function listCell(checks) {
  if (!checks.length) return '0';
  const shown = checks.slice(0, 3).map((check) => check.label);
  return `${checks.length}: ${shown.join('; ')}${checks.length > 3 ? `; +${checks.length - 3} more` : ''}`;
}

function renderReport(report, { target }) {
  const lines = [];
  const session = report.session || {};
  lines.push('## SpendWise migration audit (read-only)');
  lines.push('');
  lines.push(`Target: ${target}`);
  lines.push(
    `Session: read-only transaction confirmed (statement_timeout ${session.statement_timeout}, lock_timeout ${session.lock_timeout}), PostgreSQL ${session.server_version_num}; rolled back: ${report.meta.rolledBack ? 'yes' : 'no (the connection was closed, which discards it)'}.`
  );
  lines.push('');
  lines.push('| Migration | Status | Passed checks | Missing checks | Mismatched checks | Evidence | Recommended next action |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const migration of report.migrations) {
    const unknownNote = migration.unknown.length ? ` (${migration.unknown.length} unknown)` : '';
    lines.push(
      `| ${migration.file} | ${migration.status} | ${migration.passed}/${migration.results.length}${unknownNote} | ${cell(listCell(migration.missing))} | ${cell(
        listCell(migration.mismatched)
      )} | ${cell(migration.evidence)} | ${cell(migration.nextAction)} |`
    );
  }
  lines.push('');
  lines.push(
    `Leading run of FULLY_PRESENT migrations: ${report.fullyPresentPrefix.length ? `${report.fullyPresentPrefix[0]}–${report.fullyPresentPrefix[report.fullyPresentPrefix.length - 1]}` : 'none'}.`
  );
  lines.push('');
  lines.push('### Details');
  for (const migration of report.migrations) {
    lines.push('');
    lines.push(`#### ${migration.file}: ${migration.status}`);
    const problems = [...migration.missing, ...migration.mismatched, ...migration.unknown];
    if (!problems.length) lines.push(`- All ${migration.results.length} checks passed.`);
    for (const check of problems) lines.push(`- ${check.result.toUpperCase()}: ${safeText(check.label)}${check.detail ? `: ${safeText(check.detail, 400)}` : ''}`);
    const notes = migration.results.filter((check) => check.result === 'pass' && check.detail && /replaced by|proven|guarantees|identical rows|boolean/.test(check.detail));
    for (const check of notes) lines.push(`- Note: ${safeText(check.label)}: ${safeText(check.detail)}`);
    for (const note of migration.unprovable) lines.push(`- Not provable automatically: ${note}`);
  }
  lines.push('');
  lines.push('### Unexpected objects on the audited tables');
  if (!report.unexpected.length) lines.push('- None.');
  for (const item of report.unexpected) lines.push(`- [${item.severity}] ${safeText(item.text, 400)}`);
  lines.push('');
  lines.push('### Data access and safety');
  lines.push('- Database connection: one connection, one read-only transaction, rolled back at the end.');
  lines.push(
    `- Catalog queries: ${Object.values(STATEMENTS).filter((statement) => !statement.readsApplicationData).length} fixed SELECT statements over pg_catalog with bound parameters.`
  );
  lines.push(
    `- Application data read: ${report.meta.dataQueries.length ? report.meta.dataQueries.join('; ') : 'none (catalog evidence was sufficient)'}.`
  );
  lines.push('- Sensitive values printed: none. No credentials, user IDs, emails, transaction descriptions or amounts are queried or printed.');
  lines.push('- Changes: none. No migration, migration-history, schema, privilege or data change was made.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { envFile: null, caFile: null, help: false };
  const seen = new Set();
  for (let position = 0; position < argv.length; position += 1) {
    const arg = argv[position];
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    const inline = eq > 0 ? arg.slice(eq + 1) : undefined;
    if (seen.has(flag)) throw new RunnerError(`${flag} was given more than once.`, EXIT.usage);
    seen.add(flag);
    switch (flag) {
      case '--env-file':
      case '--ca-file': {
        const value = inline !== undefined ? inline : argv[(position += 1)];
        if (!value || value.startsWith('--')) throw new RunnerError(`${flag} needs a value.`, EXIT.usage);
        if (flag === '--env-file') options.envFile = value;
        else options.caFile = value;
        break;
      }
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new RunnerError(`Unknown argument at position ${position + 1} (not shown). Run with --help.`, EXIT.usage);
    }
  }
  return options;
}

function sha256(text) {
  return createHash('sha256').update(String(text).replace(/\r\n/g, '\n')).digest('hex');
}

/** Refuses when a migration file differs from the one this manifest describes. Returns notes. */
function checkMigrationFiles(deps) {
  const dir = path.join(deps.root, MIGRATIONS_DIR);
  const names = deps.readdir(dir).filter((name) => name.endsWith('.sql')).sort();
  for (const migration of MIGRATIONS) {
    if (!names.includes(migration.file)) throw new RunnerError(`${MIGRATIONS_DIR}/${migration.file} is missing. Nothing was audited.`);
    if (sha256(deps.readFile(path.join(dir, migration.file), 'utf8')) !== migration.sha256) {
      throw new RunnerError(`${migration.file} differs from the version this audit describes. Update the audit manifest first. Nothing was audited.`);
    }
  }
  return names.filter((name) => !MIGRATIONS.some((migration) => migration.file === name)).map((name) => `${name} is not covered by this audit.`);
}

async function loadEnvironment(options, deps) {
  if (!options.envFile) return deps.env;
  const envPath = path.resolve(deps.cwd, options.envFile);
  if (isInside(deps.root, envPath)) {
    const ignored = await deps.exec('git', ['check-ignore', '-q', '--', envPath], { cwd: deps.root, env: deps.env, timeoutMs: 60 * 1000 });
    if (ignored.code !== 0) {
      throw new RunnerError(`${options.envFile} is not ignored by git. Keep the connection string in an ignored file such as .env.local.`);
    }
  }
  return { ...readEnvFile(envPath, deps.env, deps.readFile), ...deps.env };
}

function readCaFile(options, deps) {
  if (!options.caFile) return null;
  let pem;
  try {
    pem = String(deps.readFile(path.resolve(deps.cwd, options.caFile), 'utf8'));
  } catch (error) {
    throw new RunnerError(`Cannot read the --ca-file certificate (${errorCode(error)}).`);
  }
  if (!pem.includes('-----BEGIN CERTIFICATE-----')) throw new RunnerError('The --ca-file is not a PEM certificate.');
  return pem;
}

/** node-postgres settings: TLS verified against the system store or --ca-file, short client timeouts. */
function clientConfig(parsed, ca) {
  return {
    host: parsed.host.replace(/^\[|\]$/g, ''),
    port: Number(parsed.port),
    database: parsed.database,
    user: parsed.user,
    password: parsed.password || undefined,
    ssl: parsed.kind === 'local' && !ca ? false : { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
    application_name: 'spendwise-migration-audit',
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
  };
}

function describeDatabaseError(error) {
  const code = String(errorCode(error));
  const message = String((error && error.message) || error);
  if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET', 'ETIMEDOUT'].includes(code)) {
    return `Could not reach the database (${code}). Check the host, port and network.`;
  }
  if (/CERT|SELF_SIGNED|UNABLE_TO|ERR_TLS/.test(code) || /certificate/i.test(message)) {
    return `TLS certificate verification failed (${code}). Download the CA certificate from Supabase Dashboard → Project Settings → Database → SSL Configuration and pass it with --ca-file <path>.`;
  }
  if (/does not support SSL/i.test(message)) return 'The server does not accept TLS connections. Refusing to send the password unencrypted.';
  if (code === '28P01' || /password authentication failed/i.test(message)) return 'The database rejected the user or password (28P01).';
  if (/Tenant or user not found/i.test(message)) return 'The connection pooler did not recognise the user. Pooled connections use the user postgres.<project-ref>.';
  if (code === '57014') return `A query exceeded the ${SESSION_LIMITS.statementTimeout} statement timeout (57014).`;
  if (code === '55P03') return `A query waited longer than the ${SESSION_LIMITS.lockTimeout} lock timeout (55P03).`;
  if (code === '25006') return 'The read-only transaction refused a statement (25006).';
  if (/timeout|terminated/i.test(message)) return `The connection timed out or was closed (${code}).`;
  return `Database error (${code}): ${message}`;
}

async function run(argv, deps) {
  const redactLater = { fn: (text) => text };
  const out = (line) => deps.stdout(`${redactLater.fn(line)}\n`);
  const err = (line) => deps.stderr(`${redactLater.fn(line)}\n`);
  try {
    const options = parseArgs(argv);
    if (options.help) {
      out(USAGE);
      return EXIT.ok;
    }
    out('SpendWise migration audit (read-only: no migration, history, schema or data changes)');
    const notes = checkMigrationFiles(deps);
    assertAuditStatements();
    out(`Manifest: ${MIGRATIONS.length} migrations (001–009) match their recorded file hashes; ${Object.keys(STATEMENTS).length} read-only statements validated.`);
    notes.forEach((note) => out(`Note: ${note}`));

    const env = await loadEnvironment(options, deps);
    const { variable, url, ignored } = resolveDatabaseUrl(env);
    redactLater.fn = createRedactor([url]);
    const parsed = parseDatabaseUrl(url);
    redactLater.fn = createRedactor([url, parsed.password]);
    out(`Connection string: ${variable}${ignored.length ? ` (also set, ignored: ${ignored.join(', ')})` : ''}.`);
    const target = describeTarget(parsed);
    out(`Target: ${target}`);
    const verified = verifyTarget({
      parsed,
      apiRef: projectRefFromApiUrl(env.EXPO_PUBLIC_SUPABASE_URL),
      linkedRef: readLinkedProjectRef(deps.root, deps.readFile),
      mode: 'check',
      confirm: null,
    });
    verified.notes.forEach((note) => out(`Note: ${note}`));
    const ca = readCaFile(options, deps);

    let snapshot;
    try {
      snapshot = await collectSnapshot(deps.createClient(clientConfig(parsed, ca)));
    } catch (error) {
      if (error instanceof RunnerError) throw error;
      throw new RunnerError(`${describeDatabaseError(error)} No audit result. Nothing was changed.`);
    }
    const report = evaluate(snapshot);
    out('');
    out(renderReport(report, { target }));
    return report.migrations.every((migration) => migration.status === STATUS.full) ? EXIT.ok : EXIT.findings;
  } catch (error) {
    if (error instanceof RunnerError) {
      err(`Error: ${error.message}`);
      if (error.exitCode === EXIT.usage) err(USAGE);
      return error.exitCode;
    }
    err(`Unexpected error: ${(error && error.message) || error}. Nothing was changed.`);
    return EXIT.failed;
  }
}

function defaultDeps() {
  return {
    root: path.resolve(__dirname, '..'),
    cwd: process.cwd(),
    env: process.env,
    exec: execCommand,
    readdir: (dir) => fs.readdirSync(dir),
    readFile: fs.readFileSync,
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    createClient: (config) => {
      const { Client } = require('pg');
      return new Client(config);
    },
  };
}

module.exports = {
  CONTROL,
  EXIT,
  MIGRATIONS,
  SESSION_LIMITS,
  STATEMENTS,
  STATUS,
  SYSTEM_CATEGORIES,
  assertAuditStatements,
  assertReadOnlyStatement,
  checkMigrationFiles,
  clientConfig,
  collectSnapshot,
  decodeTrigger,
  describeDatabaseError,
  evaluate,
  normalizeExpression,
  parseArgs,
  renderReport,
  run,
  safeText,
  defaultDeps,
};

if (require.main === module) {
  run(process.argv.slice(2), defaultDeps()).then((code) => {
    process.exitCode = code;
  });
}
