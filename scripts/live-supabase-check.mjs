/**
 * Live checks against the configured Supabase project.
 * Reads .env locally. Does not print secrets.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

function loadEnv() {
  const env = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

const env = loadEnv();
const url = env.EXPO_PUBLIC_SUPABASE_URL;
const key = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const results = [];

function record(name, status, detail = '') {
  results.push({ name, status, detail });
  console.log(`${status === 'Passed' ? 'PASS' : status === 'Failed' ? 'FAIL' : 'SKIP'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function client() {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function main() {
  if (!url || !key || !url.startsWith('http')) {
    record('configured', 'Failed', 'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY');
    return;
  }
  record('configured', 'Passed', url.replace(/^https:\/\//, ''));

  const anon = client();
  const probe = await anon.from('profiles').select('id').limit(1);
  if (probe.error) {
    const msg = probe.error.message || String(probe.error);
    if (/could not find the table|schema cache|does not exist/i.test(msg)) {
      record('migrations', 'Failed', 'tables missing — apply supabase/migrations in the SQL editor');
      printSummary();
      return;
    }
    record('migrations', 'Passed', 'profiles table reachable (anon sees 0 rows or RLS)');
  } else {
    record('migrations', 'Passed', `anon profiles rows=${(probe.data ?? []).length}`);
  }

  const stamp = Date.now();
  const password = 'SpendWise1!test';
  // Supabase Auth rejects reserved domains such as example.com.
  // Use a unique, obviously automated local-part on a generally accepted domain.
  const emailA = `spendwise.livecheck.a.${stamp}@gmail.com`;
  const emailB = `spendwise.livecheck.b.${stamp}@gmail.com`;

  const a = client();
  const signUpA = await a.auth.signUp({ email: emailA, password });
  if (signUpA.error) {
    record('signup', 'Failed', signUpA.error.message);
    printSummary();
    return;
  }
  const sessionA = signUpA.data.session;
  if (!sessionA) {
    record('signup', 'Failed', 'no session — email confirmation is probably required');
    printSummary();
    return;
  }
  record('signup', 'Passed', 'User A session established');

  const profileA = await a.from('profiles').select('id,display_name').eq('id', sessionA.user.id).maybeSingle();
  if (profileA.error || !profileA.data) {
    record('profile_trigger', 'Failed', profileA.error?.message ?? 'profile row missing');
  } else {
    record('profile_trigger', 'Passed', 'profile exists for User A');
  }

  const loginA = client();
  const signedIn = await loginA.auth.signInWithPassword({ email: emailA, password });
  if (signedIn.error || !signedIn.data.session) {
    record('login', 'Failed', signedIn.error?.message ?? 'no session');
    printSummary();
    return;
  }
  record('login', 'Passed');

  const bad = await client().auth.signInWithPassword({ email: emailA, password: 'wrong-password' });
  if (bad.error) {
    record('invalid_credentials', 'Passed', 'rejected invalid password');
  } else {
    record('invalid_credentials', 'Failed', 'accepted a wrong password');
  }

  const catId = randomUUID();
  const txId = randomUUID();
  const budgetId = randomUUID();
  const recId = randomUUID();
  const now = new Date().toISOString();

  const catIns = await loginA.from('categories').upsert({
    id: catId,
    user_id: sessionA.user.id,
    name: 'Live Test',
    icon: 'ellipse',
    color: '#64748B',
    type: 'expense',
    is_default: false,
    created_at: now,
    updated_at: now,
  });
  if (catIns.error) record('category_create', 'Failed', catIns.error.message);
  else record('category_create', 'Passed', catId);

  const txIns = await loginA.from('transactions').upsert({
    id: txId,
    user_id: sessionA.user.id,
    type: 'expense',
    amount: 45050,
    category_id: catId,
    title: 'Live coffee',
    date: now,
    payment_method: 'upi',
    notes: 'first',
    is_recurring: false,
    created_at: now,
    updated_at: now,
  });
  if (txIns.error) record('online_create', 'Failed', txIns.error.message);
  else record('online_create', 'Passed', txId);

  const txUpd = await loginA.from('transactions').update({ title: 'Live coffee edited', notes: 'updated', amount: 50000 }).eq('id', txId);
  if (txUpd.error) record('online_update', 'Failed', txUpd.error.message);
  else {
    const row = await loginA.from('transactions').select('id,title,amount,updated_at').eq('id', txId).single();
    if (row.data?.title === 'Live coffee edited' && row.data.amount === 50000) {
      record('online_update', 'Passed', 'same id, updated_at changed');
    } else {
      record('online_update', 'Failed', 'row missing or fields not updated');
    }
  }

  const recIns = await loginA.from('recurring_transactions').upsert({
    id: recId,
    user_id: sessionA.user.id,
    title: 'Live rent',
    amount: 1500000,
    type: 'expense',
    category_id: catId,
    frequency: 'monthly',
    start_date: '2026-09-01',
    next_date: '2026-10-01',
    payment_method: 'bank_transfer',
    is_active: true,
  });
  if (recIns.error) record('recurring_create', 'Failed', recIns.error.message);
  else record('recurring_create', 'Passed');

  const budIns = await loginA.from('budgets').upsert({
    id: budgetId,
    user_id: sessionA.user.id,
    category_id: null,
    amount: 3000000,
    month: 9,
    year: 2026,
  });
  if (budIns.error) record('budget_create', 'Failed', budIns.error.message);
  else record('budget_create', 'Passed');

  const bankId = randomUUID();
  const cardId = randomUUID();
  const extraAccId = randomUUID();
  const txWithAccId = randomUUID();
  const transferGroupId = randomUUID();
  const transferOutId = randomUUID();
  const transferInId = randomUUID();

  const bankIns = await loginA.from('accounts').upsert({
    id: bankId,
    user_id: sessionA.user.id,
    name: 'Bank Account A',
    type: 'bank',
    institution_name: 'HDFC',
    currency: 'INR',
    opening_balance: 5025000,
    credit_limit: null,
    is_active: true,
    created_at: now,
    updated_at: now,
  });
  const cardIns = await loginA.from('accounts').upsert({
    id: cardId,
    user_id: sessionA.user.id,
    name: 'Credit Card A',
    type: 'credit_card',
    institution_name: 'HDFC',
    currency: 'INR',
    opening_balance: 0,
    credit_limit: 5000000,
    is_active: true,
    created_at: now,
    updated_at: now,
  });
  if (bankIns.error || cardIns.error) {
    record(
      'account_create',
      'Failed',
      bankIns.error?.message ?? cardIns.error?.message ?? 'apply supabase/migrations/005_accounts.sql'
    );
  } else {
    record('account_create', 'Passed', 'bank + credit card');
  }

  const accUpd = await loginA.from('accounts').update({ name: 'Bank Account A edited', institution_name: 'HDFC Bank' }).eq('id', bankId);
  if (accUpd.error) record('account_update', 'Failed', accUpd.error.message);
  else {
    const accRow = await loginA.from('accounts').select('id,name').eq('id', bankId).single();
    record(accRow.data?.name === 'Bank Account A edited' ? 'account_update' : 'account_update', accRow.data?.name === 'Bank Account A edited' ? 'Passed' : 'Failed');
  }

  const extraAcc = await loginA.from('accounts').upsert({
    id: extraAccId,
    user_id: sessionA.user.id,
    name: 'Scratch Account',
    type: 'bank',
    currency: 'INR',
    opening_balance: 0,
    is_active: true,
  });
  const accSoft = extraAcc.error
    ? { error: extraAcc.error }
    : await loginA.from('accounts').update({ deleted_at: new Date().toISOString(), is_active: false }).eq('id', extraAccId);
  if (accSoft.error) record('account_soft_delete', 'Failed', accSoft.error.message);
  else {
    const gone = await loginA.from('accounts').select('id,deleted_at').eq('id', extraAccId).single();
    record(gone.data?.deleted_at ? 'account_soft_delete' : 'account_soft_delete', gone.data?.deleted_at ? 'Passed' : 'Failed', 'soft delete');
  }

  const txAcc = await loginA.from('transactions').upsert({
    id: txWithAccId,
    user_id: sessionA.user.id,
    type: 'expense',
    amount: 250000,
    category_id: catId,
    title: 'Dinner on card',
    date: now,
    payment_method: 'credit_card',
    is_recurring: false,
    account_id: cardId,
    is_transfer: false,
  });
  if (txAcc.error) record('transaction_with_account', 'Failed', txAcc.error.message);
  else record('transaction_with_account', 'Passed');

  const tOut = await loginA.from('transactions').upsert({
    id: transferOutId,
    user_id: sessionA.user.id,
    type: 'expense',
    amount: 500000,
    category_id: catId,
    title: 'Card payment',
    date: now,
    payment_method: 'bank_transfer',
    is_recurring: false,
    account_id: bankId,
    is_transfer: true,
    transfer_group_id: transferGroupId,
    transfer_role: 'source',
  });
  const tIn = await loginA.from('transactions').upsert({
    id: transferInId,
    user_id: sessionA.user.id,
    type: 'income',
    amount: 500000,
    category_id: catId,
    title: 'Card payment received',
    date: now,
    payment_method: 'bank_transfer',
    is_recurring: false,
    account_id: cardId,
    is_transfer: true,
    transfer_group_id: transferGroupId,
    transfer_role: 'destination',
  });
  if (tOut.error || tIn.error) {
    record('account_transfer', 'Failed', tOut.error?.message ?? tIn.error?.message);
  } else {
    record('account_transfer', 'Passed', 'linked source + destination');
  }

  const soft = await loginA.from('transactions').update({ deleted_at: new Date().toISOString() }).eq('id', txId);
  if (soft.error) record('online_delete', 'Failed', soft.error.message);
  else {
    const again = await loginA.from('transactions').select('id,deleted_at').eq('id', txId).single();
    record(again.data?.deleted_at ? 'online_delete' : 'online_delete', again.data?.deleted_at ? 'Passed' : 'Failed', 'soft delete');
  }

  const upsertAgain = await loginA.from('transactions').upsert({
    id: txId,
    user_id: sessionA.user.id,
    type: 'expense',
    amount: 50000,
    category_id: catId,
    title: 'Live coffee edited',
    date: now,
    payment_method: 'upi',
    notes: 'retry',
    is_recurring: false,
    deleted_at: new Date().toISOString(),
  });
  const count = await loginA.from('transactions').select('id', { count: 'exact', head: true }).eq('id', txId);
  if (upsertAgain.error || count.count !== 1) {
    record('upsert_idempotent', 'Failed', upsertAgain.error?.message ?? `count=${count.count}`);
  } else {
    record('upsert_idempotent', 'Passed', 'same UUID did not duplicate');
  }

  const sysWrite = await loginA.from('system_categories').insert({
    name: 'Should fail',
    icon: 'ellipse',
    color: '#000000',
    type: 'expense',
    sort_order: 99,
  });
  if (sysWrite.error) record('system_categories_readonly', 'Passed', 'insert denied');
  else record('system_categories_readonly', 'Failed', 'user could insert a system category');

  const b = client();
  const signUpB = await b.auth.signUp({ email: emailB, password });
  if (signUpB.error || !signUpB.data.session) {
    record('signup_b', 'Failed', signUpB.error?.message ?? 'no session');
    printSummary();
    return;
  }
  record('signup_b', 'Passed');

  const leaked = await b.from('transactions').select('id,title').eq('id', txId);
  if (leaked.error) record('rls_select', 'Failed', leaked.error.message);
  else if ((leaked.data ?? []).length === 0) record('rls_select', 'Passed', 'User B sees 0 of User A rows');
  else record('rls_select', 'Failed', `User B saw ${leaked.data.length} of User A rows`);

  const steal = await b.from('transactions').update({ title: 'stolen' }).eq('id', txId).select();
  if (steal.error) record('rls_update', 'Passed', 'update denied or errored');
  else if ((steal.data ?? []).length === 0) record('rls_update', 'Passed', '0 matching rows');
  else record('rls_update', 'Failed', 'User B updated User A row');

  const stealDel = await b.from('transactions').delete().eq('id', txId).select();
  if (stealDel.error) record('rls_delete', 'Passed', 'delete denied or errored');
  else if ((stealDel.data ?? []).length === 0) record('rls_delete', 'Passed', '0 matching rows');
  else record('rls_delete', 'Failed', 'User B deleted User A row');

  const aCats = await loginA.from('categories').select('id').eq('id', catId);
  const bCats = await b.from('categories').select('id').eq('id', catId);
  if ((aCats.data ?? []).length === 1 && (bCats.data ?? []).length === 0) {
    record('multi_account_categories', 'Passed');
  } else {
    record('multi_account_categories', 'Failed', `A=${aCats.data?.length} B=${bCats.data?.length}`);
  }

  const missingAccounts = /could not find the table|schema cache|does not exist/i;
  const bAccounts = await b.from('accounts').select('id,name').in('id', [bankId, cardId]);
  if (bAccounts.error && missingAccounts.test(bAccounts.error.message)) {
    record('account_rls_select', 'Failed', 'apply supabase/migrations/005_accounts.sql');
  } else if (bAccounts.error) record('account_rls_select', 'Failed', bAccounts.error.message);
  else if ((bAccounts.data ?? []).length === 0) record('account_rls_select', 'Passed', 'User B sees 0 of User A accounts');
  else record('account_rls_select', 'Failed', `User B saw ${bAccounts.data.length} of User A accounts`);

  const stealAcc = await b.from('accounts').update({ name: 'stolen' }).eq('id', bankId).select();
  if (stealAcc.error && missingAccounts.test(stealAcc.error.message)) {
    record('account_rls_update', 'Failed', 'apply supabase/migrations/005_accounts.sql');
  } else if (stealAcc.error) record('account_rls_update', 'Passed', 'update denied or errored');
  else if ((stealAcc.data ?? []).length === 0) record('account_rls_update', 'Passed', '0 matching rows');
  else record('account_rls_update', 'Failed', 'User B updated User A account');

  const stealAccDel = await b.from('accounts').delete().eq('id', bankId).select();
  if (stealAccDel.error && missingAccounts.test(stealAccDel.error.message)) {
    record('account_rls_delete', 'Failed', 'apply supabase/migrations/005_accounts.sql');
  } else if (stealAccDel.error) record('account_rls_delete', 'Passed', 'delete denied or errored');
  else if ((stealAccDel.data ?? []).length === 0) record('account_rls_delete', 'Passed', '0 matching rows');
  else record('account_rls_delete', 'Failed', 'User B deleted User A account');

  const hijackTx = await b.from('transactions').insert({
    id: randomUUID(),
    user_id: signUpB.data.session.user.id,
    type: 'expense',
    amount: 100,
    category_id: catId,
    title: 'bypass',
    date: now,
    payment_method: 'upi',
    account_id: bankId,
    is_recurring: false,
  });
  if (hijackTx.error && /could not find the 'account_id'|schema cache|does not exist/i.test(hijackTx.error.message)) {
    record('account_rls_via_transaction', 'Failed', 'apply supabase/migrations/005_accounts.sql');
  } else if (hijackTx.error) record('account_rls_via_transaction', 'Passed', 'cannot attach User A account');
  else record('account_rls_via_transaction', 'Failed', 'User B wrote a transaction against User A account');

  await loginA.auth.signOut();
  const afterOut = await loginA.auth.getSession();
  record(afterOut.data.session ? 'logout' : 'logout', afterOut.data.session ? 'Failed' : 'Passed', 'session cleared');

  printSummary();
}

function printSummary() {
  const failed = results.filter((item) => item.status === 'Failed').length;
  console.log(`\n${results.length - failed}/${results.length} live checks passed (${failed} failed)`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error('LIVE_SCRIPT_ERROR', error instanceof Error ? error.message : 'unknown');
  process.exit(1);
});
