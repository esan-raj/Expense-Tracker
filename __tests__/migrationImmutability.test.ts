/// <reference types="jest" />

const fs = require('fs') as {
  readFileSync: (path: string, encoding: string) => string;
  readdirSync: (path: string) => string[];
};
const path = require('path') as { join: (...parts: string[]) => string };
const crypto = require('crypto') as {
  createHash: (algorithm: string) => { update: (data: string) => { digest: (encoding: string) => string } };
};

interface MigrationFile {
  name: string;
  contents: string;
}

/** Migrations already published (and expected to be deployed). Their name and content are frozen. */
const PUBLISHED: Record<string, { name: string; sha256: string }> = {
  '008': {
    name: '008_server_sync_cursor.sql',
    sha256: '0613eaabe33e2f6f310ba328ae669c76ddb0420fc44554c5c86f6cc30c880211',
  },
  '009': {
    name: '009_harden_sync_server_time_permissions.sql',
    sha256: '5cdf1b754509d27f23d3e696592c94253e1e4a1196b4b6d55cdb742c44fa66dc',
  },
  '010': {
    name: '010_fix_account_fk_delete_semantics.sql',
    sha256: 'c982482144c3fb098754b27747c7352ba9c80e364aeba34924cd0865f3f308ee',
  },
};

const NAME_PATTERN = /^(\d{3})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;

/** Line endings depend on the checkout (core.autocrlf); hashes are of the LF form. */
const sha256Lf = (contents: string) => crypto.createHash('sha256').update(contents.replace(/\r\n/g, '\n')).digest('hex');

/**
 * Problems with a migrations directory: malformed names, duplicate or missing numbers
 * (001, 002, … with no gaps), and published migrations that were renamed, renumbered or edited.
 * New migrations after the last one are allowed.
 */
function migrationProblems(files: readonly MigrationFile[]): string[] {
  const problems: string[] = [];
  const numbers: number[] = [];
  const seen = new Map<string, string>();
  for (const file of files) {
    const match = NAME_PATTERN.exec(file.name);
    if (!match) {
      problems.push(`malformed name: ${file.name}`);
      continue;
    }
    const number = match[1];
    const previous = seen.get(number);
    if (previous) problems.push(`duplicate number ${number}: ${previous}, ${file.name}`);
    seen.set(number, file.name);
    numbers.push(Number(number));
  }
  [...new Set(numbers)]
    .sort((a, b) => a - b)
    .forEach((number, index) => {
      if (number !== index + 1) problems.push(`out of sequence: expected ${String(index + 1).padStart(3, '0')}, found ${String(number).padStart(3, '0')}`);
    });
  for (const [number, published] of Object.entries(PUBLISHED)) {
    const file = files.find((candidate) => candidate.name === published.name);
    if (!file) problems.push(`published migration ${number} missing or renamed: ${published.name}`);
    else if (sha256Lf(file.contents) !== published.sha256) problems.push(`published migration ${number} modified: ${published.name}`);
  }
  return problems;
}

const dir = path.join(process.cwd(), 'supabase', 'migrations');
const repository: MigrationFile[] = fs
  .readdirSync(dir)
  .map((name) => ({ name, contents: fs.readFileSync(path.join(dir, name), 'utf8') }));
const named = (name: string) => repository.find((file) => file.name === name)!;
const without = (name: string) => repository.filter((file) => file.name !== name);

describe('migrations directory', () => {
  it('is valid: ordered, unique and with 008, 009 and 010 exactly as published', () => {
    expect(migrationProblems(repository)).toEqual([]);
  });

  it.each(Object.entries(PUBLISHED))('pins the published hash of %s', (_number, published) => {
    expect(sha256Lf(named(published.name).contents)).toBe(published.sha256);
  });

  it('ignores line endings when hashing', () => {
    const file = named(PUBLISHED['008'].name);
    expect(sha256Lf(file.contents.replace(/\r?\n/g, '\r\n'))).toBe(PUBLISHED['008'].sha256);
  });
});

describe('migration validation rules', () => {
  it('accepts a correctly named next migration', () => {
    expect(migrationProblems([...repository, { name: '011_add_receipts.sql', contents: 'select 1;' }])).toEqual([]);
  });

  it.each(Object.entries(PUBLISHED).map(([number, published]) => [number, published.name]))('rejects an edited %s', (number, name) => {
    const edited = without(name).concat({ name, contents: `${named(name).contents}\n-- edited\n` });
    expect(migrationProblems(edited)).toEqual([`published migration ${number} modified: ${name}`]);
  });

  it('rejects a second 009', () => {
    const files = [...repository, { name: '009_another_change.sql', contents: 'select 1;' }];
    expect(migrationProblems(files)).toEqual([`duplicate number 009: ${PUBLISHED['009'].name}, 009_another_change.sql`]);
  });

  it('rejects renumbering a published migration', () => {
    const name = PUBLISHED['010'].name;
    const files = without(name).concat({ name: name.replace('010_', '011_'), contents: named(name).contents });
    expect(migrationProblems(files)).toEqual([
      'out of sequence: expected 010, found 011',
      `published migration 010 missing or renamed: ${name}`,
    ]);
  });

  it('rejects a gap in the sequence', () => {
    expect(migrationProblems([...repository, { name: '012_skips_eleven.sql', contents: 'select 1;' }])).toEqual([
      'out of sequence: expected 011, found 012',
    ]);
  });

  it.each([['10_short_number.sql'], ['010-dash.sql'], ['010_Upper_case.sql'], ['010_trailing_.sql'], ['010_no_extension'], ['010_wrong.SQL']])(
    'rejects the malformed name %s',
    (name) => {
      expect(migrationProblems([...repository, { name, contents: 'select 1;' }])).toEqual([`malformed name: ${name}`]);
    }
  );
});
