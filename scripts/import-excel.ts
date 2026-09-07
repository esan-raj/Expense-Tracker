import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import ExcelJS from 'exceljs';
import {
  toRemoteAccount,
  toRemoteBudget,
  toRemoteCategory,
  toRemoteRecurring,
  toRemoteTransaction,
} from '@/services/supabase/mappers';
import { buildImportDataset, type ExcelCell, type ExcelSheet, type ImportDataset, type ImportValidation } from '@/utils/excelStatementImport';

function loadEnv() {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  if (!existsSync('.env')) return env;
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) env[line.slice(0, i).trim()] ??= line.slice(i + 1).trim();
  }
  return env;
}

function parseArgs(argv: string[]) {
  const dryRun = argv.includes('--dry-run');
  const fileFlag = argv.findIndex((item) => item === '--file');
  const file = fileFlag >= 0 ? argv[fileFlag + 1] : argv.find((item) => item.endsWith('.xlsx') || item.endsWith('.xls')) ?? 'Transaction September.xlsx';
  return { dryRun, file: resolve(file) };
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

function printValidation(source: string, validation: ImportValidation) {
  console.log('');
  console.log('Excel Import Validation');
  console.log('');
  console.log(`Source: ${source}`);
  console.log(`Sheets: ${validation.sheets.join(', ') || '(none)'}`);
  console.log('');
  console.log('Rows:');
  console.log(`  Total:       ${validation.rowsTotal}`);
  console.log(`  Valid:       ${validation.rowsValid}`);
  console.log(`  Invalid:     ${validation.rowsInvalid}`);
  console.log(`  Duplicates:  ${validation.duplicates}`);
  console.log('');
  console.log('Entities:');
  console.log(`  Accounts:     ${validation.accounts}`);
  console.log(`  Categories:   ${validation.categories}`);
  console.log(`  Transactions: ${validation.transactions}`);
  console.log(`  Transfers:    ${validation.transfers}`);
  console.log(`  Budgets:      ${validation.budgets}`);
  console.log(`  Recurring:    ${validation.recurring}`);
  console.log('');
  console.log(`Ready for import: ${validation.ready ? 'YES' : 'NO'}`);
  if (validation.warnings.length) {
    console.log('');
    console.log('Warnings:');
    for (const warning of validation.warnings) {
      console.log(`  - [${warning.sheet}:${warning.row}] ${warning.message}`);
    }
  }
  if (validation.errors.length) {
    console.log('');
    console.log('Errors:');
    for (const error of validation.errors) {
      console.log(`  - [${error.sheet}:${error.row}] ${error.message}`);
    }
  }
}

function writeReport(path: string, payload: Record<string, unknown>) {
  writeFileSync(path, JSON.stringify(payload, null, 2));
}

async function signIn(env: Record<string, string>): Promise<{ client: SupabaseClient; userId: string }> {
  const url = env.EXPO_PUBLIC_SUPABASE_URL;
  const anon = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const email = env.SPENDWISE_IMPORT_EMAIL;
  const password = env.SPENDWISE_IMPORT_PASSWORD;
  if (!url || !anon) throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY');
  if (!email || !password) {
    throw new Error('Set SPENDWISE_IMPORT_EMAIL and SPENDWISE_IMPORT_PASSWORD in the environment (not the Expo client) to import.');
  }
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(error?.message ?? 'Sign-in failed');
  return { client, userId: data.user.id };
}

async function softDeleteUserRows(client: SupabaseClient, userId: string, table: string, deletedAt: string) {
  const { error } = await client
    .from(table)
    .update({ deleted_at: deletedAt, updated_at: deletedAt })
    .eq('user_id', userId)
    .is('deleted_at', null);
  if (error) throw error;
}

async function upsertRows<T extends Record<string, unknown>>(client: SupabaseClient, table: string, rows: T[]) {
  if (!rows.length) return;
  const { error } = await client.from(table).upsert(rows);
  if (error) throw error;
}

async function importToSupabase(client: SupabaseClient, userId: string, dataset: ImportDataset) {
  const deletedAt = new Date().toISOString();
  await softDeleteUserRows(client, userId, 'transactions', deletedAt);
  await softDeleteUserRows(client, userId, 'budgets', deletedAt);
  await softDeleteUserRows(client, userId, 'recurring_transactions', deletedAt);
  await softDeleteUserRows(client, userId, 'accounts', deletedAt);
  await softDeleteUserRows(client, userId, 'categories', deletedAt);

  await upsertRows(
    client,
    'categories',
    dataset.categories.map((item) => toRemoteCategory(item, userId))
  );
  await upsertRows(
    client,
    'accounts',
    dataset.accounts.map((item) => toRemoteAccount(item, userId))
  );
  await upsertRows(client, 'budgets', dataset.budgets.map((item) => toRemoteBudget(item, userId)));
  await upsertRows(
    client,
    'recurring_transactions',
    dataset.recurring.map((item) => toRemoteRecurring(item, userId))
  );
  await upsertRows(
    client,
    'transactions',
    dataset.transactions.map((item) => toRemoteTransaction(item, userId))
  );
}

async function verifySupabase(client: SupabaseClient, userId: string, dataset: ImportDataset) {
  const [accounts, categories, transactions] = await Promise.all([
    client.from('accounts').select('id').eq('user_id', userId).is('deleted_at', null),
    client.from('categories').select('id').eq('user_id', userId).is('deleted_at', null),
    client.from('transactions').select('id,is_transfer').eq('user_id', userId).is('deleted_at', null),
  ]);
  if (accounts.error) throw accounts.error;
  if (categories.error) throw categories.error;
  if (transactions.error) throw transactions.error;
  const accountIds = new Set((accounts.data ?? []).map((row) => row.id));
  const categoryIds = new Set((categories.data ?? []).map((row) => row.id));
  const txIds = new Set((transactions.data ?? []).map((row) => row.id));
  const missingAccounts = dataset.accounts.filter((item) => !accountIds.has(item.id));
  const missingCategories = dataset.categories.filter((item) => !categoryIds.has(item.id));
  const missingTx = dataset.transactions.filter((item) => !txIds.has(item.id));
  if (missingAccounts.length || missingCategories.length || missingTx.length) {
    throw new Error(
      `Supabase verify failed: missing accounts=${missingAccounts.length} categories=${missingCategories.length} transactions=${missingTx.length}`
    );
  }
  return {
    accounts: accountIds.size,
    categories: categoryIds.size,
    transactions: txIds.size,
    transfers: (transactions.data ?? []).filter((row) => row.is_transfer).length / 2,
  };
}

async function main() {
  const { dryRun, file } = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  if (!existsSync(file)) {
    console.error(`Excel file not found: ${file}`);
    process.exit(1);
  }

  const sheets = await readWorkbook(file);
  const { dataset, validation } = buildImportDataset(sheets);
  printValidation(basename(file), validation);

  const report = {
    source: basename(file),
    dryRun,
    generatedAt: new Date().toISOString(),
    validation,
    mapping: validation.mapping,
    financials: validation.financials,
    datasetCounts: {
      accounts: dataset.accounts.length,
      categories: dataset.categories.length,
      transactions: dataset.transactions.length,
      transfers: validation.transfers,
      budgets: 0,
      recurring: 0,
    },
    supabase: { attempted: false, ok: false, userIdPresent: false, detail: 'not run' },
    rxdb: { attempted: false, ok: false, detail: 'Local RxDB is updated on the next signed-in app sync (full remote reconcile).' },
  };

  if (!validation.ready) {
    writeReport('import-report.json', report);
    console.log('\nDatabase left untouched because validation failed.');
    process.exit(1);
  }

  mkdirSync('data', { recursive: true });
  writeFileSync(
    'data/excel-import-backup.json',
    JSON.stringify(
      {
        version: 1,
        exportedAt: new Date().toISOString(),
        transactions: dataset.transactions,
        categories: dataset.categories,
        budgets: [],
        recurringTransactions: [],
        accounts: dataset.accounts,
      },
      null,
      2
    )
  );

  if (dryRun) {
    writeReport('import-report.json', report);
    console.log('\nDry run complete. No database changes.');
    return;
  }

  report.supabase.attempted = true;
  try {
    const { client, userId } = await signIn(env);
    report.supabase.userIdPresent = Boolean(userId);
    await importToSupabase(client, userId, dataset);
    const verified = await verifySupabase(client, userId, dataset);
    report.supabase.ok = true;
    report.supabase.detail = `upserted accounts=${verified.accounts} categories=${verified.categories} transactions=${verified.transactions}`;
    console.log('\nSupabase import complete.');
    console.log(report.supabase.detail);
    console.log('Open SpendWise while signed in so RxDB can full-reconcile from Supabase.');
  } catch (error) {
    report.supabase.ok = false;
    report.supabase.detail = error instanceof Error ? error.message : String(error);
    writeReport('import-report.json', report);
    console.error(`\nImport aborted after validation. ${report.supabase.detail}`);
    process.exit(1);
  }

  writeReport('import-report.json', report);
}

void main();
