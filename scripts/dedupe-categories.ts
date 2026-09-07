import { getRxDatabase } from '../database/database';
import { categoryDedupeService } from '../services/categoryDedupeService';

async function main() {
  const apply = process.argv.includes('--apply');
  await getRxDatabase();
  const report = apply ? await categoryDedupeService.apply() : await categoryDedupeService.report();
  console.log(apply ? 'Applied category dedupe.\n' : 'Dry-run only. Pass --apply to execute.\n');
  console.log(report.summary);
  console.log('\nCanonical categories:');
  for (const group of report.groups) {
    console.log(`  ${group.name} (${group.type}) -> ${group.canonicalId}`);
    console.log(`    hide: ${group.duplicateIds.join(', ') || 'none'}`);
  }
  console.log(`\nTransactions remapped: ${report.transactionIds.length}`);
  console.log(`Recurring remapped: ${report.recurringIds.length}`);
  console.log(`Budgets remapped: ${report.budgetIds.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  console.error('If this failed outside Expo, start SpendWise instead; bootstrap and sync run the same cleanup.');
  process.exitCode = 1;
});
