import { buildImportDataset, buildMappedImport, parseMoneyToMinor, parseStatementDate, resolveCategoryName, titleFromDetails } from '@/utils/excelStatementImport';
import { calculateAccountBalances } from '@/utils/accountLogic';
import { calculateTotalExpenses, calculateTotalIncome } from '@/utils/calculations';

describe('excel statement import', () => {
  it('parses day-first dates and does not swap month/day', () => {
    expect(parseStatementDate('01/09/2026')).toBe('2026-09-01');
    expect(parseStatementDate('06/09/2026')).toBe('2026-09-06');
    expect(parseStatementDate(new Date(2026, 8, 4))).toBe('2026-09-04');
  });

  it('parses currency-formatted amounts to minor units', () => {
    expect(parseMoneyToMinor(20302.88)).toBe(2030288);
    expect(parseMoneyToMinor('32,055.68')).toBe(3205568);
    expect(parseMoneyToMinor('57,169.58CR')).toBe(5716958);
    expect(parseMoneyToMinor('')).toBeNull();
  });

  it('extracts a readable title from UPI narration', () => {
    expect(titleFromDetails('WDL TFR UPI/DR/624419957384/BSNL BIL/HDFC/bsnl.billd/Pay')).toBe('BSNL BIL');
  });

  it('maps merchants to existing categories and transfer to Transfer', () => {
    expect(resolveCategoryName('JioMart', 'JioMart', 'expense', false)).toBe('Groceries');
    expect(resolveCategoryName('Google Play', 'Google Play', 'expense', false)).toBe('Subscriptions');
    expect(resolveCategoryName('Groww In', 'DEP TFR IMPS Groww', 'income', false)).toBe('Investment');
    expect(resolveCategoryName('Bill Payment', 'Credit Card Bill Payment', 'income', true)).toBe('Transfer');
  });

  it('validates the September statement and pairs the card payment as a transfer', () => {
    const sheets = [
      {
        name: 'Pixcel Play Credit Card',
        rows: [
          [],
          ['Mr Esan', 'Pixcel Play Credit Card'],
          ['Statement From  :  01-09-2026  to  06-09-2026'],
          ['Date', 'Details', 'Ref No/Cheque No', 'Debit', 'Credit', 'Balance'],
          ['02/09/2026', 'Credit Card Bill Payment', '', null, '20302.88', 70000],
          ['03/09/2026', 'Anoop Kumar Gupta', '', 100, '', 69900],
          [new Date(2026, 8, 4), 'Reliance Limited', '', 438, null, 69462],
          ['05/09/2026', 'Reliance Limited', '', 255.01, '', 69206.99],
          ['05/09/2026', 'Google Play', '', 850, '', 68356.99],
          [new Date(2026, 8, 6), 'JioMart', '', 2679, '', 65677.99],
          [],
          ['Statement Summary : 01-09-2026  To  06-09-2026'],
          ['Brought Forward (₹)', 'Dr Count', 'Cr Count', 'Total Debits (₹)', 'Total Credits (₹)', 'Closing Balance (₹)'],
          ['57,169.58CR', 5, 1, 4322.01, 20302.88, 65677.99],
        ],
      },
      {
        name: 'SBI Bank Account',
        rows: [
          [],
          ['Mr Esan', 'State Bank of India'],
          ['Statement From  :  01-09-2026  to  06-09-2026'],
          ['Date', 'Details', 'Ref No/Cheque No', 'Debit', 'Credit', 'Balance'],
          ['01/09/2026', 'WDL TFR UPI/DR/1/ICCL - M/HDFC/mf autopay', '', '5000.00', '', '52169.58'],
          ['01/09/2026', 'WDL TFR UPI/DR/2/ICCL - M/HDFC/mf autopay', '', '5000.00', '', '47169.58'],
          ['01/09/2026', 'WDL TFR UPI/DR/3/Uphar re/YESB/q920', '', '150.00', '', '47019.58'],
          ['01/09/2026', 'WDL TFR UPI/DR/4/RADHE SH/YESB/paytm', '', '45.00', '', '46974.58'],
          ['01/09/2026', 'WDL TFR UPI/DR/5/BSNL BIL/HDFC/bsnl.billd', '', '411.00', '', '46563.58'],
          ['02/09/2026', 'WDL TFR UPI/DR/6/HDFC BAN/HDFC/hdfcbankdi/empt', '', '20302.88', '', '26260.70'],
          ['03/09/2026', 'WDL TFR UPI/DR/7/Euronet /UTIB/gpayrechar', '', '380.90', '', '25879.80'],
          ['03/09/2026', 'DEP TFR IMPS/8/CNA-XX009-Groww In/PTK', '', null, '13473.91', '39353.71'],
          ['03/09/2026', 'WDL TFR UPI/DR/9/Euronet /UTIB/gpayrechar', '', '350.90', '', '39002.81'],
          ['03/09/2026', 'DEP TFR UPI/CR/10/SANDIP O/INDB/Paym', '', null, '100.00', '39102.81'],
          ['03/09/2026', 'DEP TFR UPI/CR/11/JYOTIRMA/UCBA/Paym', '', null, '200.00', '39302.81'],
          ['05/09/2026', 'WDL TFR UPI/DR/12/Pradeep /AIRP/UPI', '', '50.00', '', '39252.81'],
          ['06/09/2026', 'WDL TFR UPI/DR/13/SANJAY  /CNRB/UPI', '', '50.00', '', '39202.81'],
          ['06/09/2026', 'WDL TFR UPI/DR/14/Mr  RAMJ/UTIB/gpay', '', '15.00', '', '39187.81'],
          ['06/09/2026', 'WDL TFR UPI/DR/15/Rakhi Sw/YESB/UPI', '', '40.00', '', '39147.81'],
          ['06/09/2026', 'WDL TFR UPI/DR/16/City gro/YESB/UPI', '', '260.00', '', '38887.81'],
          [],
          ['Statement Summary : 01-09-2026  To  06-09-2026'],
          ['Brought Forward (₹)', 'Dr Count', 'Cr Count', 'Total Debits (₹)', 'Total Credits (₹)', 'Closing Balance (₹)'],
          ['57,169.58CR', '13', '3', '32,055.68', '13,773.91', '38,887.81CR'],
        ],
      },
    ];

    const { dataset, validation } = buildImportDataset(sheets, '2026-09-06T00:00:00.000Z');
    expect(validation.ready).toBe(true);
    expect(validation.accounts).toBe(2);
    expect(validation.transfers).toBe(1);
    expect(dataset.transactions).toHaveLength(22);
    expect(dataset.transactions.filter((item) => item.isTransfer)).toHaveLength(2);
    expect(calculateTotalIncome(dataset.transactions)).toBe(validation.financials.reportableIncome);
    expect(calculateTotalExpenses(dataset.transactions)).toBe(validation.financials.reportableExpense);
    expect(validation.financials.transferTotal).toBe(2030288);
    expect(validation.financials.reportableExpense).not.toBe(validation.financials.reportableExpense + 2030288);

    const bank = dataset.accounts.find((item) => item.type === 'bank')!;
    const card = dataset.accounts.find((item) => item.type === 'credit_card')!;
    const bankBal = calculateAccountBalances(
      bank,
      dataset.transactions.filter((item) => item.accountId === bank.id)
    );
    const cardBal = calculateAccountBalances(
      card,
      dataset.transactions.filter((item) => item.accountId === card.id)
    );
    expect(bankBal.currentBalance).toBe(3888781);
    expect(cardBal.outstanding).toBe(432201);
    expect(cardBal.availableCredit).toBe(6567799);
  });

  it('maps Excel sheets onto existing account IDs and keeps the card payment as a transfer', () => {
    const sheets = [
      {
        name: 'Pixcel Play Credit Card',
        rows: [
          ['Date', 'Details', 'Ref No/Cheque No', 'Debit', 'Credit', 'Balance'],
          ['02/09/2026', 'Credit Card Bill Payment', '', null, '20302.88', 70000],
          ['03/09/2026', 'Anoop Kumar Gupta', '', 100, '', 69900],
        ],
      },
      {
        name: 'SBI Bank Account',
        rows: [
          ['Date', 'Details', 'Ref No/Cheque No', 'Debit', 'Credit', 'Balance'],
          ['01/09/2026', 'WDL TFR UPI/DR/1/ICCL - M/HDFC/mf autopay', '', '5000.00', '', '52169.58'],
          ['01/09/2026', 'WDL TFR UPI/DR/2/ICCL - M/HDFC/mf autopay', '', '5000.00', '', '47169.58'],
          ['02/09/2026', 'WDL TFR UPI/DR/6/HDFC BAN/HDFC/hdfcbankdi/empt', '', '20302.88', '', '26260.70'],
          ['03/09/2026', 'DEP TFR IMPS/8/CNA-XX009-Groww In/PTK', '', null, '13473.91', '39353.71'],
        ],
      },
    ];
    const existing = {
      accounts: [
        {
          id: 'acct-sbi',
          name: 'State Bank of India',
          type: 'bank' as const,
          institutionName: 'State Bank of India',
          openingBalance: 5716958,
          creditLimit: null,
          isActive: true,
        },
        {
          id: 'acct-card',
          name: 'Pixcel Play Credit Card',
          type: 'credit_card' as const,
          institutionName: 'Pixcel Play',
          openingBalance: 2030288,
          creditLimit: 7000000,
          isActive: true,
        },
      ],
      categories: [
        { id: 'cat-other', name: 'Other', type: 'expense' as const },
        { id: 'cat-investment', name: 'Investment', type: 'income' as const },
        { id: 'cat-transfer', name: 'Transfer', type: 'both' as const },
      ],
    };
    const { dataset, validation } = buildMappedImport(sheets, existing, '2026-09-07T00:00:00.000Z');
    expect(validation.ready).toBe(true);
    expect(validation.accountMatches.every((item) => item.accountId)).toBe(true);
    expect(dataset.transactions.every((item) => item.accountId === 'acct-sbi' || item.accountId === 'acct-card')).toBe(true);
    expect(dataset.transactions.filter((item) => item.isTransfer)).toHaveLength(2);
    expect(dataset.transactions.filter((item) => item.amount === 500000)).toHaveLength(2);
    const groww = dataset.transactions.find((item) => /groww/i.test(item.description ?? ''));
    expect(groww?.isTransfer).toBe(false);
    expect(groww?.type).toBe('income');
    expect(validation.unresolved.some((item) => /Groww/i.test(item.message))).toBe(true);
    expect(validation.investmentRelated.length).toBeGreaterThanOrEqual(3);
    const again = buildMappedImport(sheets, existing, '2026-09-07T00:00:00.000Z');
    expect(again.dataset.transactions.map((item) => item.id).sort()).toEqual(
      dataset.transactions.map((item) => item.id).sort()
    );
  });

  it('stops before import when the expected SBI account is missing', () => {
    const { validation } = buildMappedImport(
      [
        {
          name: 'SBI Bank Account',
          rows: [
            ['Date', 'Details', 'Ref', 'Debit', 'Credit', 'Balance'],
            ['01/09/2026', 'Coffee', '', 10, '', 10],
          ],
        },
      ],
      { accounts: [], categories: [{ id: 'cat-other', name: 'Other', type: 'expense' }] }
    );
    expect(validation.ready).toBe(false);
    expect(validation.errors.some((item) => item.message.includes('Missing account'))).toBe(true);
  });

  it('does not build a dataset when a required date is invalid', () => {
    const { validation } = buildImportDataset([
      {
        name: 'SBI Bank Account',
        rows: [
          ['Date', 'Details', 'Ref', 'Debit', 'Credit', 'Balance'],
          ['13/13/2026', 'Coffee', '', 10, '', 10],
        ],
      },
    ]);
    expect(validation.ready).toBe(false);
    expect(validation.errors.some((item) => item.message.includes('Invalid date'))).toBe(true);
  });
});
