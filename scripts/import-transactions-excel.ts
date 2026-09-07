import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { toRemoteTransaction } from '@/services/supabase/mappers';
import {
  buildMappedImport,
  type ExcelCell,
  type ExcelSheet,
  type ExistingAccountRef,
  type ExistingCategoryRef,
} from '@/utils/excelStatementImport';

function loadEnv() {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  if (!existsSync('.env')) return env;
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) {
      const key = line.slice(0, i).trim();
      const value = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
      env[key] ??= value;
    }
  }
  return env;
}

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply');
  const dryRun = !apply || argv.includes('--dry-run');
  const fileFlag = argv.findIndex((item) => item === '--file');
  const file =
    fileFlag >= 0
      ? argv[fileFlag + 1]
      : (argv.find((item) => item.endsWith('.xlsx') || item.endsWith('.xls')) ?? 'Transaction September.xlsx');
  return { dryRun: apply ? false : dryRun, apply, file: resolve(file) };
}

function cellValue(value: ExcelJS.CellValue): ExcelCell {
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object' && 'richText' in value) {
    return value.richText.map((part) => part.text).join('');
  }
  if (typeof value === 'object' && 'text' in value && typeof value.text === 'string') {
    return value.text;
  }
  if (typeof value === 'object' && 'result' in value) {
    return cellValue(value.result as ExcelJS.CellValue);
  }
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
  return String(value);
}

async function readWorkbook(path: string): Promise<ExcelSheet[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  return workbook.worksheets.map((sheet) => {
    const rows: ExcelCell[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      while (rows.length < rowNumber) rows.push([]);
      const values: ExcelCell[] = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        values[colNumber - 1] = cellValue(cell.value);
      });
      rows[rowNumber - 1] = values;
    });
    return { name: sheet.name, rows };
  });
}

function rupees(minor: number): string {
  return `₹${(minor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function signIn(env: Record<string, string>): Promise<{ client: SupabaseClient; userId: string }> {
  const url = env.EXPO_PUBLIC_SUPABASE_URL;
  const anon = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const email = env.SPENDWISE_IMPORT_EMAIL;
  const password = env.SPENDWISE_IMPORT_PASSWORD;
  if (!url || !anon) throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY');
  if (!email || !password) {
    throw new Error('Set SPENDWISE_IMPORT_EMAIL and SPENDWISE_IMPORT_PASSWORD to map existing accounts and import.');
  }
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(error?.message ?? 'Sign-in failed');
  return { client, userId: data.user.id };
}

async function loadExisting(
  client: SupabaseClient,
  userId: string
): Promise<{ accounts: ExistingAccountRef[]; categories: ExistingCategoryRef[]; transactionCount: number }> {
  const [accounts, categories, transactions] = await Promise.all([
    client.from('accounts').select('id,name,type,institution_name,opening_balance,credit_limit,is_active,deleted_at').eq('user_id', userId),
    client.from('categories').select('id,name,type,deleted_at').eq('user_id', userId),
    client.from('transactions').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('deleted_at', null),
  ]);
  if (accounts.error) throw accounts.error;
  if (categories.error) throw categories.error;
  if (transactions.error) throw transactions.error;
  return {
    accounts: (accounts.data ?? [])
      .filter((row) => !row.deleted_at)
      .map((row) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        institutionName: row.institution_name,
        openingBalance: row.opening_balance,
        creditLimit: row.credit_limit,
        isActive: row.is_active,
      })),
    categories: (categories.data ?? [])
      .filter((row) => !row.deleted_at)
      .map((row) => ({ id: row.id, name: row.name, type: row.type })),
    transactionCount: transactions.count ?? 0,
  };
}

async function replaceTransactions(client: SupabaseClient, userId: string, rows: ReturnType<typeof toRemoteTransaction>[]) {
  const deletedAt = new Date().toISOString();
  const soft = await client
    .from('transactions')
    .update({ deleted_at: deletedAt, updated_at: deletedAt })
    .eq('user_id', userId)
    .is('deleted_at', null);
  if (soft.error) throw soft.error;
  if (!rows.length) return;
  const { error } = await client.from('transactions').upsert(rows);
  if (error) throw error;
}

function writeReport(payload: Record<string, unknown>) {
  mkdirSync('reports', { recursive: true });
  const path = 'reports/transaction-import-2026-09-07.json';
  writeFileSync(path, JSON.stringify(payload, null, 2));
  return path;
}

async function main() {
  const { dryRun, apply, file } = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  if (!existsSync(file)) {
    console.error(`Excel file not found: ${file}`);
    process.exit(1);
  }

  const sheets = await readWorkbook(file);
  const envReady = Boolean(env.SPENDWISE_IMPORT_EMAIL && env.SPENDWISE_IMPORT_PASSWORD);
  let existing = { accounts: [] as ExistingAccountRef[], categories: [] as ExistingCategoryRef[], transactionCount: 0 };
  let userId = '';
  let client: SupabaseClient | null = null;

  if (envReady) {
    const signed = await signIn(env);
    client = signed.client;
    userId = signed.userId;
    existing = await loadExisting(client, userId);
    if (apply && !existing.categories.some((item) => item.name.toLowerCase() === 'transfer')) {
      const created = await client
        .from('categories')
        .insert({
          user_id: userId,
          name: 'Transfer',
          icon: 'swap-horizontal',
          color: '#64748B',
          type: 'both',
          is_default: false,
        })
        .select('id,name,type')
        .single();
      if (created.error) throw created.error;
      if (created.data) existing.categories.push(created.data);
    }
  }

  const { dataset, validation } = buildMappedImport(sheets, existing, new Date().toISOString(), {
    requireExistingAccounts: apply || envReady,
  });
  const bankLines = dataset.transactions.filter((item) => item.accountId === dataset.accounts.find((account) => account.type === 'bank')?.id);
  const cardLines = dataset.transactions.filter((item) => item.accountId === dataset.accounts.find((account) => account.type === 'credit_card')?.id);

  const report = {
    workbook: basename(file),
    sheetsProcessed: validation.sheets,
    transactionsDiscovered: validation.rowsTotal,
    transactionsValidated: validation.ready ? validation.rowsTotal : validation.rowsValid,
    transactionsImported: 0,
    sbi: {
      debitRows: bankLines.filter((item) => item.type === 'expense').length,
      creditRows: bankLines.filter((item) => item.type === 'income').length,
      totalDebits: bankLines.filter((item) => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0),
      totalCredits: bankLines.filter((item) => item.type === 'income').reduce((sum, item) => sum + item.amount, 0),
    },
    pixcelPlayCreditCard: {
      debitRows: cardLines.filter((item) => item.type === 'expense').length,
      creditRows: cardLines.filter((item) => item.type === 'income').length,
      totalDebits: cardLines.filter((item) => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0),
      totalCredits: cardLines.filter((item) => item.type === 'income').reduce((sum, item) => sum + item.amount, 0),
    },
    transfersDetected: validation.transfers,
    investmentRelatedRows: validation.investmentRelated,
    unresolvedRows: validation.unresolved,
    duplicatesDetected: validation.duplicates,
    categoriesMatched: validation.categoriesMatched,
    categoriesRequiringReview: validation.categoriesNeedingReview,
    accountMatches: validation.accountMatches,
    financials: validation.financials,
    rxdbTransactionCount: { before: 'app-local; updated on next signed-in sync', after: null },
    supabaseTransactionCount: { before: existing.transactionCount, after: null as number | null },
    importStatus: dryRun ? 'dry-run' : 'pending',
    errors: validation.errors,
    warnings: validation.warnings,
  };

  console.log('');
  console.log('TRANSACTION EXCEL IMPORT');
  console.log(`Workbook: ${basename(file)}`);
  console.log(`Sheets: ${validation.sheets.join(', ') || '(none)'}`);
  console.log(`Rows discovered: ${validation.rowsTotal}`);
  console.log(`Ready: ${validation.ready ? 'YES' : 'NO'}`);
  console.log(`Mode: ${dryRun ? 'DRY-RUN (no deletes, no writes)' : 'APPLY'}`);
  if (!envReady) {
    console.log('Account mapping: skipped (set SPENDWISE_IMPORT_EMAIL / SPENDWISE_IMPORT_PASSWORD to load existing accounts)');
  }
  for (const match of validation.accountMatches) {
    console.log(
      `  ${match.sheet} → ${match.accountName ? `${match.accountName} (${match.accountId})` : `MISSING (${match.expected})`}`
    );
  }
  console.log(`Transfers: ${validation.transfers}`);
  console.log(`Investment-related: ${validation.investmentRelated.length}`);
  console.log(`Unresolved: ${validation.unresolved.length}`);
  if (validation.errors.length) {
    console.log('\nErrors:');
    for (const error of validation.errors) console.log(`  - [${error.sheet}:${error.row}] ${error.message}`);
  }
  if (validation.warnings.length) {
    console.log('\nWarnings:');
    for (const warning of validation.warnings) console.log(`  - [${warning.sheet}:${warning.row}] ${warning.message}`);
  }

  if (!validation.ready) {
    report.importStatus = 'validation-failed';
    const path = writeReport(report);
    console.log(`\nVALIDATION FAILED. No data was deleted or imported. Report: ${path}`);
    process.exit(1);
  }

  if (dryRun) {
    const path = writeReport(report);
    console.log('\nVALIDATION PASSED (dry-run).');
    console.log('No transactions were deleted. Re-run with --apply to import.');
    console.log(`Report: ${path}`);
    return;
  }

  if (!client || !userId) {
    console.error('Cannot apply without SPENDWISE_IMPORT_EMAIL and SPENDWISE_IMPORT_PASSWORD.');
    process.exit(1);
  }
  if (validation.accountMatches.some((item) => !item.accountId) || dataset.transactions.length === 0) {
    console.error('Cannot apply: existing accounts were not mapped or no transactions were built.');
    process.exit(1);
  }

  console.log('');
  console.log('VALIDATION PASSED');
  console.log('');
  console.log('About to replace existing BUSINESS TRANSACTION data.');
  console.log('');
  console.log(`Existing transaction count: ${existing.transactionCount}`);
  console.log(`Excel transaction count: ${dataset.transactions.length}`);
  console.log('');
  console.log('This will:');
  console.log('- remove/replace existing transaction records');
  console.log('- preserve accounts/categories/budgets/recurring/investments/auth');
  console.log('- import the September 2026 statement');
  console.log('');
  console.log('Proceeding with import...');

  const card = dataset.accounts.find((item) => item.type === 'credit_card');
  const priorBill = dataset.transactions.find(
    (item) => item.isTransfer && item.transferRole === 'destination' && item.accountId === card?.id
  );
  if (client && userId && card && priorBill) {
    const limit = card.creditLimit && card.creditLimit > 0 ? card.creditLimit : 7000000;
    const updated = await client
      .from('accounts')
      .update({
        opening_balance: priorBill.amount,
        credit_limit: limit,
        updated_at: new Date().toISOString(),
      })
      .eq('id', card.id)
      .eq('user_id', userId);
    if (updated.error) throw updated.error;
    console.log(
      `Pixel Play prior-cycle outstanding set to opening balance ${rupees(priorBill.amount)}; limit ${rupees(limit)}.`
    );
  }

  await replaceTransactions(
    client,
    userId,
    dataset.transactions.map((item) => toRemoteTransaction(item, userId))
  );

  const after = await client.from('transactions').select('id,is_transfer', { count: 'exact' }).eq('user_id', userId).is('deleted_at', null);
  if (after.error) throw after.error;
  const importedIds = new Set(dataset.transactions.map((item) => item.id));
  const remoteIds = new Set((after.data ?? []).map((row) => row.id));
  const missing = dataset.transactions.filter((item) => !remoteIds.has(item.id));
  if (missing.length) {
    throw new Error(`Supabase verify failed: missing ${missing.length} imported transactions`);
  }

  report.transactionsImported = dataset.transactions.length;
  report.supabaseTransactionCount.after = after.count ?? remoteIds.size;
  report.importStatus = 'imported';
  const path = writeReport(report);

  console.log('');
  console.log(`Imported ${dataset.transactions.length} transactions.`);
  console.log(`Supabase active transactions: ${report.supabaseTransactionCount.after}`);
  console.log(`Transfer groups: ${validation.transfers}`);
  console.log(`SBI movement: debits ${rupees(validation.financials.bankExpense + (dataset.transactions.find((item) => item.isTransfer && item.transferRole === 'source' && item.accountId === bankLines[0]?.accountId)?.amount ?? 0))} credits ${rupees(validation.financials.bankIncome)}`);
  console.log('Open SpendWise signed-in so RxDB can pull these transactions.');
  console.log(`Report: ${path}`);
}

void main();
