import { DEFAULT_CATEGORIES } from '@/constants/categories';
import { calculateAccountBalances } from '@/utils/accountLogic';
import { toMinorUnits } from '@/utils/currency';
import type { Account, Category, PaymentMethod, Transaction, TransactionType } from '@/types';

export type ExcelCell = string | number | Date | boolean | null | undefined;
export type ExcelSheet = { name: string; rows: ExcelCell[][] };

export interface ImportIssue {
  sheet: string;
  row: number;
  message: string;
}

export interface StatementLine {
  sheet: string;
  row: number;
  accountKey: string;
  date: string;
  details: string;
  title: string;
  ref: string;
  debitMinor: number | null;
  creditMinor: number | null;
  balanceMinor: number | null;
  paymentMethod: PaymentMethod;
}

export const STATEMENT_DATE_MIN = '2026-09-01';
export const STATEMENT_DATE_MAX = '2026-09-06';
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 500;

export interface ExistingAccountRef {
  id: string;
  name: string;
  type: Account['type'];
  institutionName?: string | null;
  openingBalance: number;
  creditLimit: number | null;
  isActive?: boolean;
}

export interface ExistingCategoryRef {
  id: string;
  name: string;
  type: Category['type'];
}

export interface MappedImportValidation extends ImportValidation {
  accountMatches: Array<{ sheet: string; expected: string; accountId: string | null; accountName: string | null }>;
  investmentRelated: Array<{ sheet: string; row: number; title: string; amount: number }>;
  unresolved: ImportIssue[];
  categoriesMatched: string[];
  categoriesNeedingReview: string[];
}

export interface MappedImportDataset {
  transactions: Transaction[];
  accounts: ExistingAccountRef[];
  categoriesUsed: ExistingCategoryRef[];
}

export interface ImportDataset {
  categories: Category[];
  accounts: Account[];
  transactions: Transaction[];
  budgets: [];
  recurring: [];
}

export interface ImportValidation {
  ready: boolean;
  sheets: string[];
  rowsTotal: number;
  rowsValid: number;
  rowsInvalid: number;
  duplicates: number;
  accounts: number;
  categories: number;
  transactions: number;
  transfers: number;
  budgets: number;
  recurring: number;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  mapping: Array<{ excel: string; spendwise: string; notes: string }>;
  financials: {
    bankOpening: number;
    bankClosing: number;
    bankIncome: number;
    bankExpense: number;
    cardOpeningOutstanding: number;
    cardClosingOutstanding: number;
    cardLimit: number;
    cardAvailable: number;
    reportableIncome: number;
    reportableExpense: number;
    transferTotal: number;
  };
}

const INR_DECIMALS = 2;
const ID_NAMESPACE = 'spendwise-excel-import-v1';

const HEADER_ALIASES: Record<string, string> = {
  date: 'date',
  details: 'details',
  description: 'details',
  narration: 'details',
  'ref no/cheque no': 'ref',
  'ref no': 'ref',
  debit: 'debit',
  credit: 'credit',
  balance: 'balance',
};

function digestHex(value: string): string {
  let a = 2166136261;
  let b = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    a ^= code;
    a = Math.imul(a, 16777619);
    b = Math.imul(b ^ (code + i), 16777619);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return `${hex(a)}${hex(b)}${hex(a ^ b)}${hex(Math.imul(a, b || 1))}`.slice(0, 32);
}

export function stableId(...parts: string[]): string {
  const hex = digestHex([ID_NAMESPACE, ...parts].join('\u001f'));
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function parseMoneyToMinor(value: ExcelCell): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return toMinorUnits(value, INR_DECIMALS);
  }
  if (value instanceof Date) return null;
  const raw = String(value).replace(/₹/g, '').replace(/,/g, '').replace(/CR|DR/gi, '').trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return toMinorUnits(parsed, INR_DECIMALS);
}

export function parseStatementDate(value: ExcelCell): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}

export function cleanDetails(value: ExcelCell): string {
  return String(value ?? '')
    .replace(/\r/g, '')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function titleFromDetails(details: string): string {
  const compact = cleanDetails(details);
  const upi = compact.match(/UPI\/(?:DR|CR)\/\d+\/([^/]+)/i);
  if (upi) return tidyMerchant(upi[1]);
  const imps = compact.match(/IMPS\/\d+\/([^/]+)/i);
  if (imps) return tidyMerchant(imps[1]);
  return compact.slice(0, 80) || 'Transaction';
}

function tidyMerchant(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/[-\s]+$/g, '').trim().slice(0, 80) || 'Transaction';
}

function classifyAccount(sheetName: string, headerText: string): { type: Account['type']; name: string; institution: string | null } {
  const hay = `${sheetName} ${headerText}`.toLowerCase();
  if (hay.includes('credit card')) {
    const name = sheetName.trim() || 'Credit Card';
    return { type: 'credit_card', name, institution: name };
  }
  if (hay.includes('state bank') || hay.includes('sbi')) {
    return { type: 'bank', name: sheetName.trim() || 'SBI Bank Account', institution: 'State Bank of India' };
  }
  return { type: 'bank', name: sheetName.trim() || 'Bank Account', institution: null };
}

function findHeaderRow(rows: ExcelCell[][]): { index: number; columns: Record<string, number> } | null {
  for (let i = 0; i < rows.length; i += 1) {
    const mapped: Record<string, number> = {};
    rows[i].forEach((cell, col) => {
      const key = HEADER_ALIASES[cleanDetails(cell).toLowerCase()];
      if (key) mapped[key] = col;
    });
    if (mapped.date != null && mapped.details != null && mapped.debit != null && mapped.credit != null) {
      return { index: i, columns: mapped };
    }
  }
  return null;
}

function isSummaryRow(row: ExcelCell[], columns: Record<string, number>): boolean {
  const dateText = cleanDetails(row[columns.date]);
  const details = cleanDetails(row[columns.details]);
  const first = cleanDetails(row[0]);
  const hay = `${first} ${dateText} ${details}`.toLowerCase();
  if (
    hay.includes('brought forward') ||
    hay.includes('statement summary') ||
    hay.includes('statement from') ||
    hay.includes('dr count') ||
    hay.includes('total debits') ||
    dateText.toLowerCase() === 'date' ||
    details.toLowerCase() === 'details'
  ) {
    return true;
  }
  return /cr|dr/i.test(first) && parseStatementDate(row[columns.date]) == null && parseMoneyToMinor(first) != null;
}

function paymentMethodFrom(details: string, accountType: Account['type'], isTransfer: boolean): PaymentMethod {
  if (isTransfer) return 'bank_transfer';
  const lower = details.toLowerCase();
  if (lower.includes('upi')) return 'upi';
  if (lower.includes('imps') || lower.includes('neft') || lower.includes('rtgs')) return 'bank_transfer';
  if (accountType === 'credit_card') return 'credit_card';
  return 'other';
}

export function resolveCategoryName(title: string, details: string, type: TransactionType, isTransfer: boolean): string {
  if (isTransfer) return 'Transfer';
  const hay = `${title} ${details}`.toLowerCase();
  if (type === 'income') {
    if (hay.includes('groww')) return 'Investment';
    return 'Other Income';
  }
  if (hay.includes('reliance') || hay.includes('jiomart') || hay.includes('city gro')) return 'Groceries';
  if (hay.includes('google play') || hay.includes('netflix')) return 'Subscriptions';
  if (hay.includes('bsnl') || hay.includes('gpayrechar') || hay.includes('euronet') || hay.includes('bill')) return 'Bills';
  if (hay.includes('uphar') || hay.includes('radhe')) return 'Food';
  return 'Other';
}

function parseBroughtForward(rows: ExcelCell[][]): number | null {
  for (let i = 0; i < rows.length; i += 1) {
    const label = cleanDetails(rows[i][0]);
    if (label.toLowerCase().startsWith('brought forward')) {
      const next = rows[i + 1]?.[0];
      return parseMoneyToMinor(next);
    }
  }
  return null;
}

function parseSummaryTotals(rows: ExcelCell[][]): { debitCount: number | null; creditCount: number | null; debitMinor: number | null; creditMinor: number | null; closingMinor: number | null } {
  for (let i = 0; i < rows.length; i += 1) {
    const label = cleanDetails(rows[i][0]);
    if (!label.toLowerCase().startsWith('brought forward')) continue;
    const values = rows[i + 1] ?? [];
    return {
      debitCount: typeof values[1] === 'number' ? values[1] : Number(String(values[1] ?? '').replace(/,/g, '')) || null,
      creditCount: typeof values[2] === 'number' ? values[2] : Number(String(values[2] ?? '').replace(/,/g, '')) || null,
      debitMinor: parseMoneyToMinor(values[3]),
      creditMinor: parseMoneyToMinor(values[4]),
      closingMinor: parseMoneyToMinor(values[5]),
    };
  }
  return { debitCount: null, creditCount: null, debitMinor: null, creditMinor: null, closingMinor: null };
}

export function extractStatementLines(sheets: ExcelSheet[]): { lines: StatementLine[]; errors: ImportIssue[]; warnings: ImportIssue[] } {
  const lines: StatementLine[] = [];
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];

  for (const sheet of sheets) {
    const header = findHeaderRow(sheet.rows);
    if (!header) {
      errors.push({ sheet: sheet.name, row: 0, message: 'Missing Date/Details/Debit/Credit header row' });
      continue;
    }
    const accountMeta = classifyAccount(sheet.name, sheet.rows.slice(0, header.index).map((row) => cleanDetails(row[1] ?? row[0])).join(' '));
    const seen = new Map<string, number>();

    for (let i = header.index + 1; i < sheet.rows.length; i += 1) {
      const row = sheet.rows[i] ?? [];
      const details = cleanDetails(row[header.columns.details]);
      const dateCell = row[header.columns.date];
      const debitCell = row[header.columns.debit];
      const creditCell = row[header.columns.credit];
      if (isSummaryRow(row, header.columns)) continue;
      if ((dateCell == null || dateCell === '') && !details && debitCell == null && creditCell == null) continue;

      const date = parseStatementDate(dateCell);
      const debitMinor = parseMoneyToMinor(debitCell);
      const creditMinor = parseMoneyToMinor(creditCell);
      const excelRow = i + 1;

      if (!date) {
        errors.push({ sheet: sheet.name, row: excelRow, message: `Invalid date: ${String(dateCell)}` });
        continue;
      }
      if (!details) {
        errors.push({ sheet: sheet.name, row: excelRow, message: 'Missing Details' });
        continue;
      }
      const hasDebit = debitMinor != null && debitMinor > 0;
      const hasCredit = creditMinor != null && creditMinor > 0;
      if (hasDebit && hasCredit) {
        errors.push({ sheet: sheet.name, row: excelRow, message: 'Row has both Debit and Credit' });
        continue;
      }
      if (!hasDebit && !hasCredit) {
        errors.push({ sheet: sheet.name, row: excelRow, message: 'Row has neither Debit nor Credit' });
        continue;
      }

      const fingerprint = `${sheet.name}|${date}|${details}|${debitMinor ?? ''}|${creditMinor ?? ''}`;
      const previous = seen.get(fingerprint);
      if (previous) {
        errors.push({ sheet: sheet.name, row: excelRow, message: `Duplicate of row ${previous}` });
        continue;
      }
      seen.set(fingerprint, excelRow);

      lines.push({
        sheet: sheet.name,
        row: excelRow,
        accountKey: accountMeta.type === 'credit_card' ? 'card' : 'bank',
        date,
        details,
        title: titleFromDetails(details),
        ref: header.columns.ref != null ? cleanDetails(row[header.columns.ref]) : '',
        debitMinor: hasDebit ? debitMinor : null,
        creditMinor: hasCredit ? creditMinor : null,
        balanceMinor: parseMoneyToMinor(row[header.columns.balance]),
        paymentMethod: paymentMethodFrom(details, accountMeta.type, false),
      });
    }

    const summary = parseSummaryTotals(sheet.rows);
    const sheetLines = lines.filter((line) => line.sheet === sheet.name);
    const debitCount = sheetLines.filter((line) => line.debitMinor).length;
    const creditCount = sheetLines.filter((line) => line.creditMinor).length;
    const debitSum = sheetLines.reduce((sum, line) => sum + (line.debitMinor ?? 0), 0);
    const creditSum = sheetLines.reduce((sum, line) => sum + (line.creditMinor ?? 0), 0);
    if (summary.debitCount != null && summary.debitCount !== debitCount) {
      errors.push({ sheet: sheet.name, row: 0, message: `Debit count ${debitCount} does not match summary ${summary.debitCount}` });
    }
    if (summary.creditCount != null && summary.creditCount !== creditCount) {
      errors.push({ sheet: sheet.name, row: 0, message: `Credit count ${creditCount} does not match summary ${summary.creditCount}` });
    }
    if (summary.debitMinor != null && summary.debitMinor !== debitSum) {
      errors.push({ sheet: sheet.name, row: 0, message: `Debit total ${debitSum} does not match summary ${summary.debitMinor}` });
    }
    if (summary.creditMinor != null && summary.creditMinor !== creditSum) {
      errors.push({ sheet: sheet.name, row: 0, message: `Credit total ${creditSum} does not match summary ${summary.creditMinor}` });
    }
    if (accountMeta.type === 'bank') {
      const opening = parseBroughtForward(sheet.rows);
      if (opening != null && summary.closingMinor != null) {
        const expected = opening - debitSum + creditSum;
        if (expected !== summary.closingMinor) {
          errors.push({
            sheet: sheet.name,
            row: 0,
            message: `Bank closing ${summary.closingMinor} does not match opening ${opening} − debits + credits = ${expected}`,
          });
        }
      }
    } else if (summary.closingMinor != null) {
      warnings.push({
        sheet: sheet.name,
        row: 0,
        message: 'Credit-card Brought Forward is treated as available-credit history; opening outstanding is derived so closing available matches the statement.',
      });
    }
  }

  return { lines, errors, warnings };
}

function pairTransfers(lines: StatementLine[]): Map<string, string> {
  const pairs = new Map<string, string>();
  const bankCreditsOrDebits = lines.filter((line) => line.accountKey === 'bank');
  const cardLines = lines.filter((line) => line.accountKey === 'card');

  for (const card of cardLines) {
    const isPayment = Boolean(card.creditMinor) && /bill payment|credit card/i.test(`${card.title} ${card.details}`);
    if (!isPayment || !card.creditMinor) continue;
    const bank = bankCreditsOrDebits.find(
      (line) =>
        line.date === card.date &&
        line.debitMinor === card.creditMinor &&
        !pairs.has(`${line.sheet}:${line.row}`)
    );
    if (!bank) continue;
    const group = stableId('transfer', card.date, String(card.creditMinor));
    pairs.set(`${card.sheet}:${card.row}`, group);
    pairs.set(`${bank.sheet}:${bank.row}`, group);
  }
  return pairs;
}

export function buildImportDataset(sheets: ExcelSheet[], now = new Date().toISOString()): {
  dataset: ImportDataset;
  validation: ImportValidation;
} {
  const { lines, errors, warnings } = extractStatementLines(sheets);
  const transferGroups = pairTransfers(lines);
  const timestamp = now;

  const categories: Category[] = [
    ...DEFAULT_CATEGORIES.map((item) => ({
      id: stableId('category', item.name, item.type),
      name: item.name,
      icon: item.icon,
      color: item.color,
      type: item.type,
      isDefault: true,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    })),
    {
      id: stableId('category', 'Transfer', 'both'),
      name: 'Transfer',
      icon: 'swap-horizontal',
      color: '#64748B',
      type: 'both',
      isDefault: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    },
  ];
  const categoryByName = Object.fromEntries(categories.map((item) => [item.name, item]));

  const accountDefs = sheets.map((sheet) => {
    const headerText = sheet.rows.slice(0, 4).map((row) => cleanDetails(row[1] ?? row[0])).join(' ');
    const meta = classifyAccount(sheet.name, headerText);
    const summary = parseSummaryTotals(sheet.rows);
    const openingFromBf = parseBroughtForward(sheet.rows);
    return { sheet: sheet.name, meta, summary, openingFromBf };
  });

  const bankDef = accountDefs.find((item) => item.meta.type === 'bank');
  const cardDef = accountDefs.find((item) => item.meta.type === 'credit_card');
  const cardLines = lines.filter((line) => line.accountKey === 'card');
  const cardDebits = cardLines.reduce((sum, line) => sum + (line.debitMinor ?? 0), 0);
  const cardCredits = cardLines.reduce((sum, line) => sum + (line.creditMinor ?? 0), 0);
  const cardLimit = cardLines.find((line) => line.creditMinor && line.balanceMinor)?.balanceMinor ?? 7000000;
  const cardClosingAvailable = cardDef?.summary.closingMinor ?? cardLimit - cardDebits;
  const cardClosingOutstanding = Math.max(0, cardLimit - cardClosingAvailable);
  const cardOpeningOutstanding = cardClosingOutstanding - cardDebits + cardCredits;

  const accounts: Account[] = [];
  if (bankDef) {
    accounts.push({
      id: stableId('account', 'bank', bankDef.meta.name),
      name: bankDef.meta.name,
      type: 'bank',
      institutionName: bankDef.meta.institution,
      currency: 'INR',
      openingBalance: bankDef.openingFromBf ?? 0,
      creditLimit: null,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    });
  }
  if (cardDef) {
    accounts.push({
      id: stableId('account', 'credit_card', cardDef.meta.name),
      name: cardDef.meta.name,
      type: 'credit_card',
      institutionName: cardDef.meta.institution,
      currency: 'INR',
      openingBalance: cardOpeningOutstanding,
      creditLimit: cardLimit,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    });
  }
  const accountByKey = {
    bank: accounts.find((item) => item.type === 'bank') ?? null,
    card: accounts.find((item) => item.type === 'credit_card') ?? null,
  };

  const transactions: Transaction[] = [];
  for (const line of lines) {
    const account = accountByKey[line.accountKey as 'bank' | 'card'];
    if (!account) {
      errors.push({ sheet: line.sheet, row: line.row, message: `No account for ${line.accountKey}` });
      continue;
    }
    const groupId = transferGroups.get(`${line.sheet}:${line.row}`) ?? null;
    const isTransfer = Boolean(groupId);
    const type: TransactionType = line.debitMinor ? 'expense' : 'income';
    const amount = line.debitMinor ?? line.creditMinor ?? 0;
    const categoryName = resolveCategoryName(line.title, line.details, type, isTransfer);
    const category = categoryByName[categoryName];
    if (!category) {
      errors.push({ sheet: line.sheet, row: line.row, message: `Missing category ${categoryName}` });
      continue;
    }
    transactions.push({
      id: stableId('tx', line.sheet, String(line.row), line.date, String(amount), line.details),
      type,
      amount,
      categoryId: category.id,
      title: isTransfer
        ? type === 'expense'
          ? `Transfer to ${accountByKey.card?.name ?? 'credit card'}`
          : `Transfer from ${accountByKey.bank?.name ?? 'bank'}`
        : line.title,
      description: line.details,
      date: line.date,
      paymentMethod: paymentMethodFrom(line.details, account.type, isTransfer),
      notes: null,
      isRecurring: false,
      recurringId: null,
      accountId: account.id,
      isTransfer,
      transferGroupId: groupId,
      transferRole: isTransfer ? (type === 'expense' ? 'source' : 'destination') : null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  const unpairedTransfers = lines.filter((line) => {
    const looksLikePayment =
      Boolean(line.creditMinor) && /bill payment/i.test(`${line.title} ${line.details}`) && line.accountKey === 'card';
    const looksLikeBankPayment =
      Boolean(line.debitMinor) && /hdfcbankdi|credit card/i.test(line.details) && line.accountKey === 'bank';
    return (looksLikePayment || looksLikeBankPayment) && !transferGroups.has(`${line.sheet}:${line.row}`);
  });
  for (const line of unpairedTransfers) {
    errors.push({ sheet: line.sheet, row: line.row, message: 'Credit-card payment could not be paired as a transfer' });
  }

  const bank = accountByKey.bank;
  const card = accountByKey.card;
  const bankEntries = transactions.filter((item) => item.accountId === bank?.id);
  const cardEntries = transactions.filter((item) => item.accountId === card?.id);
  const bankBalances = bank ? calculateAccountBalances(bank, bankEntries) : null;
  const cardBalances = card ? calculateAccountBalances(card, cardEntries) : null;

  if (bank && bankDef?.summary.closingMinor != null && bankBalances && bankBalances.currentBalance !== bankDef.summary.closingMinor) {
    errors.push({
      sheet: bankDef.sheet,
      row: 0,
      message: `Imported bank balance ${bankBalances.currentBalance} does not match statement closing ${bankDef.summary.closingMinor}`,
    });
  }
  if (card && cardDef?.summary.closingMinor != null && cardBalances && cardBalances.availableCredit !== cardDef.summary.closingMinor) {
    errors.push({
      sheet: cardDef.sheet,
      row: 0,
      message: `Imported available credit ${cardBalances.availableCredit} does not match statement closing ${cardDef.summary.closingMinor}`,
    });
  }

  const missingAccount = transactions.filter((item) => !accounts.some((account) => account.id === item.accountId));
  const missingCategory = transactions.filter((item) => !categories.some((category) => category.id === item.categoryId));
  if (missingAccount.length) errors.push({ sheet: '', row: 0, message: 'Transaction references a missing account' });
  if (missingCategory.length) errors.push({ sheet: '', row: 0, message: 'Transaction references a missing category' });

  const transferCount = new Set(transactions.filter((item) => item.isTransfer).map((item) => item.transferGroupId)).size;
  const reportable = transactions.filter((item) => !item.isTransfer);
  const validation: ImportValidation = {
    ready: errors.length === 0,
    sheets: sheets.map((sheet) => sheet.name),
    rowsTotal: lines.length + errors.filter((item) => item.row > 0).length,
    rowsValid: lines.length,
    rowsInvalid: errors.filter((item) => item.row > 0).length,
    duplicates: errors.filter((item) => item.message.startsWith('Duplicate')).length,
    accounts: accounts.length,
    categories: categories.length,
    transactions: transactions.length,
    transfers: transferCount,
    budgets: 0,
    recurring: 0,
    errors,
    warnings,
    mapping: [
      { excel: 'Sheet name / header', spendwise: 'accounts.name + accounts.type', notes: 'Credit Card sheet → credit_card; SBI sheet → bank' },
      { excel: 'Date (DD/MM/YYYY or Excel date)', spendwise: 'transactions.date', notes: 'Normalized to YYYY-MM-DD; day-first for slash dates' },
      { excel: 'Details', spendwise: 'transactions.title + description', notes: 'UPI/IMPS merchant extracted for title; raw text kept as description' },
      { excel: 'Debit', spendwise: 'transactions.amount (expense)', notes: 'Major currency → integer minor units' },
      { excel: 'Credit', spendwise: 'transactions.amount (income) or transfer destination', notes: 'Bill payment paired with bank debit becomes a transfer' },
      { excel: 'Balance / Brought Forward', spendwise: 'accounts.openingBalance + creditLimit', notes: 'Validation only for running totals; not stored per transaction' },
      { excel: 'Ref No/Cheque No', spendwise: '(unused)', notes: 'Empty in this workbook' },
    ],
    financials: {
      bankOpening: bank?.openingBalance ?? 0,
      bankClosing: bankBalances?.currentBalance ?? 0,
      bankIncome: bankEntries.filter((item) => item.type === 'income' && !item.isTransfer).reduce((sum, item) => sum + item.amount, 0),
      bankExpense: bankEntries.filter((item) => item.type === 'expense' && !item.isTransfer).reduce((sum, item) => sum + item.amount, 0),
      cardOpeningOutstanding: card?.openingBalance ?? 0,
      cardClosingOutstanding: cardBalances?.outstanding ?? 0,
      cardLimit: card?.creditLimit ?? 0,
      cardAvailable: cardBalances?.availableCredit ?? 0,
      reportableIncome: reportable.filter((item) => item.type === 'income').reduce((sum, item) => sum + item.amount, 0),
      reportableExpense: reportable.filter((item) => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0),
      transferTotal: transactions.filter((item) => item.isTransfer && item.transferRole === 'source').reduce((sum, item) => sum + item.amount, 0),
    },
  };

  return {
    dataset: {
      categories,
      accounts,
      transactions,
      budgets: [],
      recurring: [],
    },
    validation,
  };
}

export const EXCEL_IMPORT_MAPPING = [
  'Excel Date → transactions.date (YYYY-MM-DD)',
  'Excel Details → transactions.title / description',
  'Excel Debit → expense amount (minor units)',
  'Excel Credit → income amount or transfer destination',
  'Sheet → existing accounts.id (name + type match; never create a second account)',
  'Category name rules → existing categories.id',
  'Paired bill payment → transactions.isTransfer + transferGroupId',
];

export function isInvestmentRelatedLine(line: Pick<StatementLine, 'title' | 'details'>): boolean {
  const hay = `${line.title} ${line.details}`.toLowerCase();
  return hay.includes('mf autopay') || hay.includes('mutual fund') || hay.includes('groww') || hay.includes('iccl');
}

export function isGrowwCredit(line: StatementLine): boolean {
  return line.accountKey === 'bank' && Boolean(line.creditMinor) && /groww/i.test(`${line.title} ${line.details}`);
}

export function matchExistingAccount(
  sheetName: string,
  accounts: ExistingAccountRef[]
): { account: ExistingAccountRef | null; expected: string; reason: string } {
  const active = accounts.filter((item) => item.isActive !== false);
  const hay = sheetName.toLowerCase();
  if (hay.includes('credit card') || hay.includes('pixcel')) {
    const expected = 'Pixcel Play Credit Card (credit_card)';
    const named = active.filter(
      (item) =>
        item.type === 'credit_card' &&
        (/pixcel|play/i.test(item.name) || /pixcel|play/i.test(item.institutionName ?? ''))
    );
    if (named.length === 1) return { account: named[0], expected, reason: 'name+type' };
    const cards = active.filter((item) => item.type === 'credit_card');
    if (cards.length === 1) return { account: cards[0], expected, reason: 'sole credit_card' };
    return { account: null, expected, reason: named.length ? 'ambiguous credit card name' : 'no credit_card account' };
  }
  if (hay.includes('sbi') || hay.includes('bank')) {
    const expected = 'State Bank of India (bank)';
    const named = active.filter(
      (item) =>
        item.type === 'bank' &&
        (/sbi|state bank/i.test(item.name) || /sbi|state bank/i.test(item.institutionName ?? ''))
    );
    if (named.length === 1) return { account: named[0], expected, reason: 'name+type' };
    return { account: null, expected, reason: named.length ? 'ambiguous SBI account name' : 'no SBI bank account' };
  }
  return { account: null, expected: sheetName, reason: 'unrecognized sheet' };
}

export function matchGrowwAccount(accounts: ExistingAccountRef[]): ExistingAccountRef | null {
  const active = accounts.filter((item) => item.isActive !== false);
  const named = active.filter((item) => /groww/i.test(item.name) || /groww/i.test(item.institutionName ?? ''));
  if (named.length === 1) return named[0];
  const investments = active.filter((item) => item.type === 'investment');
  if (investments.length === 1 && named.length === 0) return null;
  return named[0] ?? null;
}

function findExistingCategory(
  categories: ExistingCategoryRef[],
  name: string,
  type: TransactionType,
  isTransfer: boolean
): ExistingCategoryRef | null {
  const needle = name.toLowerCase();
  const pool = categories.filter((item) => item.name.toLowerCase() === needle);
  if (isTransfer) {
    return pool.find((item) => item.name.toLowerCase() === 'transfer') ?? categories.find((item) => item.name.toLowerCase() === 'transfer') ?? null;
  }
  return pool.find((item) => item.type === type || item.type === 'both') ?? pool[0] ?? null;
}

function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max - 1).trimEnd() + '…';
}

export function buildMappedImport(
  sheets: ExcelSheet[],
  existing: { accounts: ExistingAccountRef[]; categories: ExistingCategoryRef[] },
  now = new Date().toISOString(),
  options: { requireExistingAccounts?: boolean } = {}
): { dataset: MappedImportDataset; validation: MappedImportValidation } {
  const requireExistingAccounts = options.requireExistingAccounts !== false;
  const { lines, errors, warnings } = extractStatementLines(sheets);
  const accountMatches: MappedImportValidation['accountMatches'] = [];
  const unresolved: ImportIssue[] = [];
  const investmentRelated: MappedImportValidation['investmentRelated'] = [];
  const categoriesMatched = new Set<string>();
  const categoriesNeedingReview = new Set<string>();
  const sheetAccount = new Map<string, ExistingAccountRef>();

  for (const sheet of sheets) {
    const match = matchExistingAccount(sheet.name, existing.accounts);
    accountMatches.push({
      sheet: sheet.name,
      expected: match.expected,
      accountId: match.account?.id ?? null,
      accountName: match.account?.name ?? null,
    });
    if (!match.account) {
      const message = `Missing account:\nExpected account: ${match.expected}\nExcel sheet: ${sheet.name}\nReason: ${match.reason}`;
      if (requireExistingAccounts) errors.push({ sheet: sheet.name, row: 0, message });
      else warnings.push({ sheet: sheet.name, row: 0, message: `${message} (dry-run without signed-in accounts)` });
      continue;
    }
    sheetAccount.set(sheet.name, match.account);
  }

  for (const line of lines) {
    if (line.date < STATEMENT_DATE_MIN || line.date > STATEMENT_DATE_MAX) {
      errors.push({
        sheet: line.sheet,
        row: line.row,
        message: `Date ${line.date} is outside ${STATEMENT_DATE_MIN} through ${STATEMENT_DATE_MAX}`,
      });
    }
    if (isInvestmentRelatedLine(line)) {
      investmentRelated.push({
        sheet: line.sheet,
        row: line.row,
        title: line.title,
        amount: line.debitMinor ?? line.creditMinor ?? 0,
      });
    }
  }

  const transferGroups = pairTransfers(lines);
  const growwAccount = matchGrowwAccount(existing.accounts);
  const bankAccount = [...sheetAccount.values()].find((item) => item.type === 'bank') ?? null;
  const cardAccount = [...sheetAccount.values()].find((item) => item.type === 'credit_card') ?? null;

  for (const line of lines) {
    if (!isGrowwCredit(line)) continue;
    if (growwAccount && bankAccount) {
      const group = stableId('transfer', 'groww', line.date, String(line.creditMinor));
      transferGroups.set(`${line.sheet}:${line.row}`, group);
    } else {
      unresolved.push({
        sheet: line.sheet,
        row: line.row,
        message:
          'Groww credit has no matching Groww/investment account. Kept as an Investment-category income transaction. Do not treat as salary. Add a Groww account later if this should be a transfer.',
      });
    }
  }

  const transactions: Transaction[] = [];
  const categoriesUsed: ExistingCategoryRef[] = [];

  for (const line of lines) {
    const account = sheetAccount.get(line.sheet);
    if (!account) continue;
    const groupId = transferGroups.get(`${line.sheet}:${line.row}`) ?? null;
    const isTransfer = Boolean(groupId);
    const amount = line.debitMinor ?? line.creditMinor ?? 0;
    let type: TransactionType = line.debitMinor ? 'expense' : 'income';
    let transferRole: Transaction['transferRole'] = null;
    if (isTransfer) {
      if (isGrowwCredit(line) || line.creditMinor) {
        type = 'income';
        transferRole = 'destination';
      } else {
        type = 'expense';
        transferRole = 'source';
      }
    }
    const categoryName = resolveCategoryName(line.title, line.details, type, isTransfer);
    const category = findExistingCategory(existing.categories, categoryName, type, isTransfer);
    if (!category) {
      errors.push({ sheet: line.sheet, row: line.row, message: `No existing category named "${categoryName}"` });
      categoriesNeedingReview.add(categoryName);
      continue;
    }
    categoriesMatched.add(category.name);
    if (!categoriesUsed.some((item) => item.id === category.id)) categoriesUsed.push(category);

    const notes = line.ref ? clip(line.ref, DESCRIPTION_MAX) : null;
    transactions.push({
      id: stableId('mapped-tx', account.id, line.date, line.details, String(amount), type),
      type,
      amount,
      categoryId: category.id,
      title: clip(
        isTransfer
          ? type === 'expense'
            ? `Transfer to ${cardAccount?.name ?? 'credit card'}`
            : isGrowwCredit(line)
              ? `Transfer from ${growwAccount?.name ?? 'Groww'}`
              : `Transfer from ${bankAccount?.name ?? 'bank'}`
          : line.title,
        TITLE_MAX
      ),
      description: clip(line.details, DESCRIPTION_MAX),
      date: line.date,
      paymentMethod: paymentMethodFrom(line.details, account.type, isTransfer),
      notes,
      isRecurring: false,
      recurringId: null,
      accountId: account.id,
      isTransfer,
      transferGroupId: groupId,
      transferRole,
      createdAt: now,
      updatedAt: now,
    });

    if (isTransfer && isGrowwCredit(line) && growwAccount && groupId) {
      const growwCategory = findExistingCategory(existing.categories, 'Transfer', 'expense', true);
      if (growwCategory && !categoriesUsed.some((item) => item.id === growwCategory.id)) categoriesUsed.push(growwCategory);
      if (growwCategory) {
        transactions.push({
          id: stableId('mapped-tx', growwAccount.id, line.date, line.details, String(amount), 'expense'),
          type: 'expense',
          amount,
          categoryId: growwCategory.id,
          title: clip(`Transfer to ${account.name}`, TITLE_MAX),
          description: clip(line.details, DESCRIPTION_MAX),
          date: line.date,
          paymentMethod: 'bank_transfer',
          notes,
          isRecurring: false,
          recurringId: null,
          accountId: growwAccount.id,
          isTransfer: true,
          transferGroupId: groupId,
          transferRole: 'source',
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  const bank = bankAccount;
  const card = cardAccount;
  const bankEntries = transactions.filter((item) => item.accountId === bank?.id);
  const cardEntries = transactions.filter((item) => item.accountId === card?.id);
  const bankBalances = bank ? calculateAccountBalances(bank, bankEntries) : null;
  const cardBalances = card ? calculateAccountBalances(card, cardEntries) : null;
  const transferCount = new Set(transactions.filter((item) => item.isTransfer).map((item) => item.transferGroupId)).size;
  const reportable = transactions.filter((item) => !item.isTransfer);

  const validation: MappedImportValidation = {
    ready: errors.length === 0,
    sheets: sheets.map((sheet) => sheet.name),
    rowsTotal: lines.length,
    rowsValid: lines.length,
    rowsInvalid: errors.filter((item) => item.row > 0).length,
    duplicates: errors.filter((item) => item.message.startsWith('Duplicate')).length,
    accounts: accountMatches.filter((item) => item.accountId).length,
    categories: categoriesUsed.length,
    transactions: transactions.length,
    transfers: transferCount || new Set(transferGroups.values()).size,
    budgets: 0,
    recurring: 0,
    errors,
    warnings: [...warnings, ...unresolved],
    mapping: [
      { excel: 'Sheet name', spendwise: 'existing accounts.id', notes: 'Match by type + name/institution; never create a second account' },
      { excel: 'Date', spendwise: 'transactions.date', notes: 'YYYY-MM-DD, day-first slash dates, range 2026-09-01..2026-09-06' },
      { excel: 'Details', spendwise: 'transactions.title + description', notes: 'Full narration preserved; title clipped to 200, description to 500' },
      { excel: 'Ref No/Cheque No', spendwise: 'transactions.notes', notes: 'Stored when present' },
      { excel: 'Debit/Credit', spendwise: 'expense/income or transfer pair', notes: 'Card bill payment is a transfer, not an expense' },
    ],
    financials: {
      bankOpening: bank?.openingBalance ?? 0,
      bankClosing: bankBalances?.currentBalance ?? 0,
      bankIncome: bankEntries.filter((item) => item.type === 'income' && !item.isTransfer).reduce((sum, item) => sum + item.amount, 0),
      bankExpense: bankEntries.filter((item) => item.type === 'expense' && !item.isTransfer).reduce((sum, item) => sum + item.amount, 0),
      cardOpeningOutstanding: card?.openingBalance ?? 0,
      cardClosingOutstanding: cardBalances?.outstanding ?? 0,
      cardLimit: card?.creditLimit ?? 0,
      cardAvailable: cardBalances?.availableCredit ?? 0,
      reportableIncome: reportable.filter((item) => item.type === 'income').reduce((sum, item) => sum + item.amount, 0),
      reportableExpense: reportable.filter((item) => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0),
      transferTotal: transactions.filter((item) => item.isTransfer && item.transferRole === 'source').reduce((sum, item) => sum + item.amount, 0),
    },
    accountMatches,
    investmentRelated,
    unresolved,
    categoriesMatched: [...categoriesMatched],
    categoriesNeedingReview: [...categoriesNeedingReview],
  };

  return {
    dataset: { transactions, accounts: [...sheetAccount.values()], categoriesUsed },
    validation,
  };
}
