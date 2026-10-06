/// <reference types="jest" />

const { readdirSync, readFileSync } = require('fs') as {
  readFileSync: (path: string, encoding: string) => string;
  readdirSync: (path: string) => string[];
};
const { join } = require('path') as { join: (...parts: string[]) => string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

interface CheckResult {
  kind: string;
  label: string;
  result: 'pass' | 'missing' | 'mismatch' | 'unknown';
  detail?: string;
  distinctive: boolean;
}
interface MigrationReport {
  version: string;
  file: string;
  status: string;
  results: CheckResult[];
  passed: number;
  missing: CheckResult[];
  mismatched: CheckResult[];
  unknown: CheckResult[];
  evidence: string;
}
interface Report {
  migrations: MigrationReport[];
  unexpected: Array<{ severity: string; text: string }>;
  fullyPresentPrefix: string[];
  meta: { dataQueries: string[]; rolledBack: boolean };
}
interface Audit {
  CONTROL: Record<string, string>;
  EXIT: { ok: number; failed: number; usage: number; findings: number };
  STATUS: { full: string; partial: string; none: string; ambiguous: string };
  MIGRATIONS: Row[];
  STATEMENTS: Record<string, { sql: string; params: () => unknown[]; readsApplicationData?: string }>;
  SYSTEM_CATEGORIES: Array<{ name: string; icon: string; color: string; type: string; sortOrder: number }>;
  assertReadOnlyStatement(sql: string): void;
  assertAuditStatements(): void;
  collectSnapshot(client: object): Promise<Row>;
  evaluate(snapshot: Row): Report;
  normalizeExpression(value: string | null): string | null;
  renderReport(report: Report, options: { target: string }): string;
  run(argv: string[], deps: object): Promise<number>;
  clientConfig(parsed: Row, ca: string | null): Row;
  describeDatabaseError(error: unknown): string;
  decodeTrigger(bits: number): { timing: string; events: string[]; level: string };
}

const audit = require('../scripts/audit-supabase-migrations') as Audit;
const { EXIT, STATUS } = audit;

const REF = 'abcdefghijklmnopqrst';
const PASSWORD = 'S3cr3t-p@ss/word#1';
const POOLER_URL = `postgresql://postgres.${REF}:${encodeURIComponent(PASSWORD)}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`;
const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const sqlOf = (file: string) => readFileSync(join(migrationsDir, file), 'utf8').replace(/\r\n/g, '\n');
const manifest = (version: string) => audit.MIGRATIONS.find((migration) => migration.version === version)!;
const fileOf = (version: string) => sqlOf(manifest(version).file);
const sorted = (values: string[]) => [...values].sort();

// ---------------------------------------------------------------------------------------------
// A catalog that satisfies every migration, shaped like the audit statements' result rows.
// ---------------------------------------------------------------------------------------------

const COMMAND_LETTER: Record<string, string> = { SELECT: 'r', INSERT: 'a', UPDATE: 'w', DELETE: 'd', ALL: '*' };
const split = (qualified: string) => {
  const [schema, table] = qualified.split('.');
  return { schema, table_name: table };
};
const triggerBits = (spec: Row) =>
  1 | (spec.timing === 'BEFORE' ? 2 : 0) | (spec.events.includes('INSERT') ? 4 : 0) | (spec.events.includes('UPDATE') ? 16 : 0);
const noReference = { ref_schema: null, ref_table: null, ref_columns: [], on_update: ' ', on_delete: ' ', match_type: ' ', deferrable: false };

function fullRows(): Record<string, Row[]> {
  const relations: Row[] = [{ schema: 'auth', name: 'users', kind: 'r', rls_enabled: true, rls_forced: false, rls_filters_current_user: false }];
  const columns: Row[] = [];
  const constraints: Row[] = [];
  const indexes: Row[] = [];
  const policies: Row[] = [];
  const triggers: Row[] = [];
  const functions: Row[] = [];
  const publicationTables: string[] = [];
  const rls = new Set(audit.MIGRATIONS.flatMap((migration) => migration.rls ?? []));
  const columnRow = (table: string, spec: Row) => ({
    ...split(table),
    name: spec.name,
    type: spec.type,
    nullable: spec.nullable,
    default_value: spec.default,
    identity: '',
    generated: '',
  });
  const indexRow = (table: string, name: string, cols: string[], extra: Row = {}) => ({
    ...split(table),
    name,
    method: 'btree',
    is_unique: false,
    is_primary: false,
    is_valid: true,
    is_ready: true,
    key_count: cols.length,
    column_count: cols.length,
    columns: cols,
    options: cols.map(() => 0),
    predicate: null,
    definition: `CREATE INDEX ${name} ON ${table} USING btree (${cols.join(', ')})`,
    backs_constraint: false,
    ...extra,
  });
  for (const migration of audit.MIGRATIONS) {
    for (const table of migration.tables ?? []) {
      relations.push({ schema: 'public', name: split(table.name).table_name, kind: 'r', rls_enabled: rls.has(table.name), rls_forced: false, rls_filters_current_user: false });
      for (const spec of table.columns) columns.push(columnRow(table.name, spec));
    }
    for (const spec of migration.columns ?? []) columns.push(columnRow(spec.table, spec));
    for (const spec of migration.primaryKeys ?? []) {
      const name = `${split(spec.table).table_name}_pkey`;
      constraints.push({ ...split(spec.table), name, type: 'p', validated: true, definition: 'PRIMARY KEY (id)', columns: spec.columns, ...noReference });
      indexes.push(indexRow(spec.table, name, spec.columns, { is_unique: true, is_primary: true, backs_constraint: true }));
    }
    for (const spec of migration.foreignKeys ?? []) {
      if (spec.supersededBy || spec.amendedBy) continue;
      const [refSchema, refTable] = spec.ref.split('.');
      constraints.push({
        ...split(spec.table),
        name: spec.name ?? `${split(spec.table).table_name}_${spec.columns.join('_')}_fkey`,
        type: 'f',
        validated: true,
        definition: `FOREIGN KEY (${spec.columns.join(', ')}) REFERENCES ${spec.ref}(${spec.refColumns.join(', ')})`,
        columns: spec.columns,
        ref_schema: refSchema,
        ref_table: refTable,
        ref_columns: spec.refColumns,
        on_update: 'a',
        on_delete: spec.onDelete,
        match_type: 's',
        delete_set_columns: spec.deleteSetColumns ?? [],
        deferrable: false,
      });
    }
    for (const spec of migration.checks ?? []) {
      constraints.push({ ...split(spec.table), name: spec.name, type: 'c', validated: true, definition: spec.definition, columns: [], ...noReference });
    }
    for (const spec of migration.uniques ?? []) {
      constraints.push({ ...split(spec.table), name: spec.name, type: 'u', validated: true, definition: `UNIQUE (${spec.columns.join(', ')})`, columns: spec.columns, ...noReference });
      indexes.push(indexRow(spec.table, spec.name, spec.columns, { is_unique: true, backs_constraint: true }));
    }
    for (const spec of migration.indexes ?? []) indexes.push(indexRow(spec.table, spec.name, spec.columns, { is_unique: spec.unique, predicate: spec.predicate }));
    for (const spec of migration.policies ?? []) {
      policies.push({
        ...split(spec.table),
        name: spec.name,
        command: COMMAND_LETTER[spec.command],
        permissive: true,
        roles: spec.roles,
        using_expression: spec.using,
        check_expression: spec.check,
      });
    }
    for (const spec of migration.triggers ?? []) {
      const [functionSchema, functionName] = spec.function.split('.');
      triggers.push({
        ...split(spec.table),
        name: spec.name,
        type_bits: triggerBits(spec),
        enabled: 'O',
        function_schema: functionSchema,
        function_name: functionName,
        argument_count: 0,
        has_when: false,
        has_columns: false,
        definition: `CREATE TRIGGER ${spec.name} ${spec.timing} ${spec.events.join(' OR ')} ON ${spec.table} FOR EACH ROW EXECUTE FUNCTION ${spec.function}()`,
      });
    }
    for (const spec of migration.functions ?? []) {
      const sync = spec.name === 'sync_server_time';
      functions.push({
        schema: 'public',
        name: spec.name,
        arguments: spec.arguments,
        result: spec.result,
        language: spec.language,
        security_definer: spec.securityDefiner,
        volatility: spec.volatility,
        config: spec.config,
        source: `\n  ${String(spec.body).replace(/; /g, ';\n  ')}\n`,
        default_acl: !sync,
        execute_grantees: sync ? ['authenticated', 'postgres', 'service_role'] : ['PUBLIC', 'anon', 'authenticated', 'postgres', 'service_role'],
        anon_can_execute: !sync,
        authenticated_can_execute: true,
      });
    }
    publicationTables.push(...(migration.publication ?? []));
  }
  return {
    session: [{ transaction_read_only: 'on', statement_timeout: '15s', lock_timeout: '2s', server_version_num: 170004, superuser: false, bypass_rls: true }],
    namespaces: [{ name: 'public' }, { name: 'auth' }],
    extensions: [{ name: 'pgcrypto', schema: 'extensions', version: '1.3' }],
    relations,
    columns,
    constraints,
    indexes,
    policies,
    triggers,
    functions,
    publication: [{ name: 'supabase_realtime', all_tables: false, tables: sorted(publicationTables) }],
    seeds: audit.SYSTEM_CATEGORIES.map((_, position) => ({ ord: position + 1, exact_matches: 1, name_matches: 1, total_rows: 20 })),
    backfillTransactions: [{ has_unmatched: false }],
    backfillRecurring: [{ has_unmatched: false }],
  };
}

const statementIds = new Map(Object.entries(audit.STATEMENTS).map(([id, statement]) => [statement.sql, id]));

function fakeClient(rows: Record<string, Row[]>, options: { failOn?: string; failConnect?: Error } = {}) {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const client = {
    on: jest.fn(),
    connect: jest.fn(async () => {
      if (options.failConnect) throw options.failConnect;
    }),
    query: jest.fn(async (query: string | { text: string; values: unknown[] }) => {
      const text = typeof query === 'string' ? query : query.text;
      calls.push(typeof query === 'string' ? { text } : { text, values: query.values });
      const id = statementIds.get(text);
      if (!id) return { rows: [] };
      if (options.failOn === id) throw Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
      return { rows: rows[id] ?? [] };
    }),
    end: jest.fn(async () => undefined),
  };
  const ids = () => calls.map((call) => statementIds.get(call.text) ?? call.text);
  return { client, calls, ids };
}

async function reportOf(rows: Record<string, Row[]>): Promise<Report> {
  return audit.evaluate(await audit.collectSnapshot(fakeClient(rows).client));
}
const statusOf = (report: Report, version: string) => report.migrations.find((migration) => migration.version === version)!;
const findRow = (rows: Record<string, Row[]>, id: string, name: string, table?: string) =>
  rows[id].find((row) => row.name === name && (!table || `${row.schema}.${row.table_name}` === table))!;
const removeRows = (rows: Record<string, Row[]>, id: string, keep: (row: Row) => boolean) => {
  rows[id] = rows[id].filter(keep);
};

/** Drops every object 007 creates, as if it had never run. */
function withoutInvestments(rows: Record<string, Row[]>) {
  const notInvestments = (row: Row) => row.table_name !== 'investments';
  removeRows(rows, 'relations', (row) => row.name !== 'investments');
  for (const id of ['columns', 'constraints', 'indexes', 'policies', 'triggers']) removeRows(rows, id, notInvestments);
  rows.publication[0].tables = rows.publication[0].tables.filter((table: string) => table !== 'public.investments');
}

// ---------------------------------------------------------------------------------------------

describe('migration audit: assertion manifest matches the SQL files', () => {
  it('covers every migration file with its current file hash', () => {
    const files = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
    expect(audit.MIGRATIONS.map((migration) => migration.file)).toEqual(files);
    const { createHash } = require('crypto') as { createHash: (a: string) => { update: (d: string) => { digest: (e: string) => string } } };
    for (const migration of audit.MIGRATIONS) {
      expect(createHash('sha256').update(sqlOf(migration.file)).digest('hex')).toBe(migration.sha256);
    }
  });

  it('lists every created table with the same columns in the same order', () => {
    for (const migration of audit.MIGRATIONS) {
      const created = [...sqlOf(migration.file).matchAll(/create table if not exists (public\.\w+) \(\n([\s\S]*?)\n\);/g)].map(([, name, body]) => ({
        name,
        columns: body.split('\n').map((line) => line.trim().split(/\s+/)[0]).filter(Boolean),
      }));
      expect((migration.tables ?? []).map((table: Row) => ({ name: table.name, columns: table.columns.map((spec: Row) => spec.name) }))).toEqual(created);
    }
  });

  it('lists every added column, including the six server_updated_at columns of 008', () => {
    const added = [...fileOf('005').matchAll(/alter table (public\.\w+)\s+add column if not exists (\w+) (\w+)/g)].map(([, table, name, type]) => ({ table, name, type }));
    expect(manifest('005').columns.map((spec: Row) => ({ table: spec.table, name: spec.name, type: spec.type }))).toEqual(added);
    const loopTables = /foreach t in array array\[([\s\S]*?)\]/.exec(fileOf('008'))![1].match(/'(\w+)'/g)!.map((quoted) => quoted.slice(1, -1));
    expect(fileOf('008')).toContain('add column if not exists server_updated_at timestamptz not null default now()');
    expect(manifest('008').columns.map((spec: Row) => spec.table)).toEqual(loopTables.map((name) => `public.${name}`));
    expect(manifest('008').indexes.map((spec: Row) => spec.name)).toEqual(loopTables.map((name) => `idx_${name}_user_server_updated`));
    expect(manifest('008').triggers.map((spec: Row) => spec.name)).toEqual(loopTables.map((name) => `${name}_set_server_updated_at`));
  });

  it('lists every inline and named foreign key with its target and delete action', () => {
    const action = (text: string) => (text === 'cascade' ? 'c' : 'n');
    for (const version of ['001', '005', '007']) {
      const sql = fileOf(version);
      const inline = [...sql.matchAll(/^\s+(\w+) uuid (?:not null |primary key )?references (\w+\.\w+)\((\w+)\) on delete (cascade|set null)/gm)];
      const tableOfLine = (offset: number) => [...sql.slice(0, offset).matchAll(/create table if not exists (public\.\w+)|alter table (public\.\w+)/g)].pop()!;
      for (const match of inline) {
        const owner = tableOfLine(match.index!);
        const table = owner[1] ?? owner[2];
        expect(manifest(version).foreignKeys).toContainEqual(
          expect.objectContaining({ table, columns: [match[1]], ref: match[2], refColumns: [match[3]], onDelete: action(match[4]) })
        );
      }
      const added = [...sql.matchAll(/alter table (public\.\w+)\s+add column if not exists (\w+) uuid references (\w+\.\w+)\((\w+)\) on delete set null/g)];
      for (const [, table, name, ref, refColumn] of added) {
        expect(manifest(version).foreignKeys).toContainEqual(expect.objectContaining({ table, columns: [name], ref, refColumns: [refColumn], onDelete: 'n' }));
      }
    }
    for (const version of ['006', '007']) {
      const named = [...fileOf(version).matchAll(/alter table (public\.\w+)\s+add constraint (\w+)\s+foreign key \(([^)]+)\)\s+references (public\.\w+)\(([^)]+)\)\s+on delete set null/g)];
      expect(named.length).toBeGreaterThan(0);
      for (const [, table, name, cols, ref, refCols] of named) {
        expect(manifest(version).foreignKeys).toContainEqual(
          expect.objectContaining({ table, name, columns: cols.split(', '), ref, refColumns: refCols.split(', '), onDelete: 'n' })
        );
      }
    }
    expect(/add constraint accounts_id_user_unique unique \(id, user_id\)/.test(fileOf('006'))).toBe(true);
    expect(manifest('006').uniques).toEqual([{ table: 'public.accounts', name: 'accounts_id_user_unique', columns: ['id', 'user_id'] }]);
    for (const dropped of ['transactions_account_id_fkey', 'recurring_transactions_account_id_fkey']) expect(fileOf('006')).toContain(`drop constraint if exists ${dropped}`);

    const recreated = [
      ...fileOf('010').matchAll(
        /alter table (public\.\w+)\s+drop constraint (\w+),\s+add constraint (\w+)\s+foreign key \(([^)]+)\)\s+references (public\.\w+) \(([^)]+)\)\s+on delete set null \(([^)]+)\);/g
      ),
    ].map(([, table, dropped, name, cols, ref, refCols, setCols]) => ({ table, dropped, name, columns: cols.split(', '), ref, refColumns: refCols.split(', '), setCols }));
    expect(recreated.map(({ table, name }) => [table, name])).toEqual(manifest('010').foreignKeys.map((spec: Row) => [spec.table, spec.name]));
    for (const key of recreated) {
      expect(key.dropped).toBe(key.name);
      expect(manifest('010').foreignKeys).toContainEqual(
        expect.objectContaining({ table: key.table, name: key.name, columns: key.columns, ref: key.ref, refColumns: key.refColumns, onDelete: 'n', deleteSetColumns: [key.setCols] })
      );
      const original = [...manifest('006').foreignKeys, ...manifest('007').foreignKeys].find((spec: Row) => spec.name === key.name);
      expect(original).toEqual(expect.objectContaining({ columns: key.columns, ref: key.ref, refColumns: key.refColumns, deleteSetColumns: [] }));
    }
    expect(fileOf('010').replace(/--.*$/gm, '')).not.toMatch(/\b(insert|update|delete from|truncate|drop table|cascade)\b/i);
  });

  it('has one check constraint for every CHECK in the files', () => {
    for (const migration of audit.MIGRATIONS) {
      expect((migration.checks ?? []).length).toBe((sqlOf(migration.file).match(/(?<!with )\bcheck \(/g) ?? []).length);
    }
  });

  it('lists every policy with its command, role and expressions', () => {
    for (const migration of audit.MIGRATIONS) {
      const statements = sqlOf(migration.file)
        .split(';')
        .map((text) => text.replace(/\s+/g, ' ').trim())
        .filter((text) => text.startsWith('create policy'));
      const parsed = statements.map((text) => {
        const [, name, table, command, role] = /^create policy "([^"]+)" on (public\.\w+) for (\w+)(?: to (\w+))?/.exec(text)!;
        const using = /using \((.+?)\)(?: with check|$)/.exec(text);
        const check = /with check \((.+)\)$/.exec(text);
        return {
          table,
          name,
          command: command.toUpperCase(),
          roles: [role ?? 'public'],
          using: using ? audit.normalizeExpression(`(${using[1]})`) : null,
          check: check ? audit.normalizeExpression(`(${check[1]})`) : null,
        };
      });
      const expected = (migration.policies ?? []).map((spec: Row) => ({
        ...spec,
        using: audit.normalizeExpression(spec.using),
        check: audit.normalizeExpression(spec.check),
      }));
      expect(expected).toEqual(parsed);
    }
  });

  it('lists every index, trigger, RLS table, publication table and function', () => {
    for (const migration of audit.MIGRATIONS) {
      const sql = sqlOf(migration.file);
      if (migration.version !== '008') {
        const indexes = [...sql.matchAll(/create (unique )?index if not exists (\w+)\s+on (public\.\w+)/g)].map(([, unique, name, table]) => ({ name, table, unique: Boolean(unique) }));
        expect((migration.indexes ?? []).map((spec: Row) => ({ name: spec.name, table: spec.table, unique: spec.unique }))).toEqual(indexes);
        for (const [, name, cols] of sql.matchAll(/create index if not exists (\w+) on public\.\w+\(([^()]+)\);/g)) {
          expect(migration.indexes.find((spec: Row) => spec.name === name).columns).toEqual(cols.split(', '));
        }
        const triggers = [...sql.matchAll(/create trigger (\w+)\s+(before|after) (\w+) on (\w+\.\w+)\s+for each row execute function (\w+\.\w+)\(\)/g)].map(
          ([, name, timing, event, table, fn]) => ({ table, name, timing: timing.toUpperCase(), events: [event.toUpperCase()], function: fn })
        );
        expect(migration.triggers ?? []).toEqual(triggers);
      }
      expect(migration.rls ?? []).toEqual([...sql.matchAll(/alter table (public\.\w+) enable row level security/g)].map((match) => match[1]));
      expect(migration.publication ?? []).toEqual([...sql.matchAll(/alter publication supabase_realtime add table (public\.\w+)/g)].map((match) => match[1]));
      const functions = [...sql.matchAll(/create or replace function public\.(\w+)\(\)\s+returns (\w+)\s+language (\w+)([\s\S]*?)as \$\$([\s\S]*?)\$\$/g)].map(
        ([, name, result, language, options, body]) => ({
          name,
          arguments: '',
          result: result === 'timestamptz' ? 'timestamp with time zone' : result,
          language,
          securityDefiner: /security definer/.test(options),
          volatility: 'v',
          config: /set search_path = (\w+)/.test(options) ? [`search_path=${/set search_path = (\w+)/.exec(options)![1]}`] : null,
          body: body.replace(/\s+/g, ' ').trim(),
        })
      );
      expect(migration.functions ?? []).toEqual(functions);
    }
    expect(fileOf('008')).toContain('before insert or update on public.%I for each row execute function public.set_server_updated_at()');
  });

  it('lists the 20 system category seeds exactly', () => {
    const seeds = [...fileOf('001').matchAll(/\('([^']+)', '([^']+)', '([^']+)', '([^']+)', (\d+)\)/g)].map(([, name, icon, color, type, order]) => ({
      name,
      icon,
      color,
      type,
      sortOrder: Number(order),
    }));
    expect(seeds).toHaveLength(20);
    expect(audit.SYSTEM_CATEGORIES).toEqual(seeds);
  });

  it('models the 008 grant and the 009 revokes on sync_server_time()', () => {
    expect(fileOf('008')).toContain('grant execute on function public.sync_server_time() to authenticated;');
    expect(manifest('008').privileges).toEqual([{ function: 'sync_server_time', role: 'authenticated', expect: 'explicit' }]);
    const sql = fileOf('009');
    expect(sql).toContain('revoke execute on function public.sync_server_time() from public;');
    expect(sql).toContain('revoke execute on function public.sync_server_time() from anon;');
    expect(sql).toContain('grant execute on function public.sync_server_time() to authenticated;');
    expect(manifest('009').privileges.map((spec: Row) => [spec.role, spec.expect])).toEqual([
      ['PUBLIC', 'none'],
      ['anon', 'none'],
      ['authenticated', 'explicit'],
    ]);
  });
});

describe('migration audit: read-only enforcement', () => {
  it('accepts every audit statement and binds values as parameters', () => {
    expect(() => audit.assertAuditStatements()).not.toThrow();
    for (const statement of Object.values(audit.STATEMENTS)) {
      expect(statement.sql).toMatch(/^(select|with)\b/);
      expect(Array.isArray(statement.params())).toBe(true);
      const placeholders = new Set((statement.sql.match(/\$\d+/g) ?? []).map((value) => Number(value.slice(1))));
      expect(placeholders.size).toBe(statement.params().length);
    }
  });

  it.each([
    ['an INSERT', 'insert into public.transactions (id) values (gen_random_uuid())'],
    ['an UPDATE', 'update public.accounts set name = name'],
    ['a DELETE in a CTE', 'with gone as (delete from public.transactions returning id) select count(*) from gone'],
    ['a second statement', 'select 1; drop table public.transactions'],
    ['DDL', 'create table public.audit_probe (id int)'],
    ['a GRANT', 'grant select on public.transactions to anon'],
    ['TRUNCATE', 'truncate public.transactions'],
    ['a row lock', 'select id from public.accounts for update'],
    ['a shared row lock', 'select id from public.accounts for share'],
    ['a function outside the allowlist', "select pg_catalog.set_config('search_path', 'public', false)"],
    ['an unqualified function', 'select now()'],
    ['a user-schema function', 'select public.sync_server_time()'],
    ['a side-effecting function', 'select pg_catalog.pg_terminate_backend(1)'],
    ['a sequence bump', "select pg_catalog.nextval('x')"],
    ['dblink', "select dblink_exec('dbname=postgres', 'drop table x')"],
    ['dollar quoting', 'select $$x$$'],
    ['a comment', 'select 1 -- note'],
    ['COPY', 'copy public.transactions to stdout'],
    ['SET', "set statement_timeout = '0'"],
    ['an unterminated literal', "select 'x"],
  ])('rejects %s', (_label, sql) => {
    expect(() => audit.assertReadOnlyStatement(sql)).toThrow();
  });

  it('wraps every audit query in BEGIN TRANSACTION READ ONLY with timeouts and always rolls back', async () => {
    const fake = fakeClient(fullRows());
    await audit.collectSnapshot(fake.client);
    const texts = fake.calls.map((call) => call.text);
    expect(texts.slice(0, 4)).toEqual([audit.CONTROL.begin, audit.CONTROL.statementTimeout, audit.CONTROL.lockTimeout, audit.CONTROL.idleTimeout]);
    expect(audit.CONTROL.begin).toBe('BEGIN TRANSACTION READ ONLY');
    expect(texts[texts.length - 1]).toBe('ROLLBACK');
    for (const call of fake.calls.slice(4, -1)) {
      expect(statementIds.has(call.text)).toBe(true);
      expect(Array.isArray(call.values)).toBe(true);
      expect(() => audit.assertReadOnlyStatement(call.text)).not.toThrow();
    }
    expect(texts.join('\n')).not.toMatch(/\b(commit|insert|update|delete|alter|drop|grant|revoke|truncate)\b/i);
    expect(fake.client.end).toHaveBeenCalledTimes(1);
  });

  it('refuses to audit when the session does not report a read-only transaction', async () => {
    const rows = fullRows();
    rows.session[0].transaction_read_only = 'off';
    const fake = fakeClient(rows);
    await expect(audit.collectSnapshot(fake.client)).rejects.toThrow('did not confirm a read-only transaction');
    expect(fake.ids().slice(4)).toEqual(['session', 'ROLLBACK']);
    expect(fake.client.end).toHaveBeenCalledTimes(1);
  });

  it('rolls back and closes the connection when a catalog query fails', async () => {
    const fake = fakeClient(fullRows(), { failOn: 'constraints' });
    await expect(audit.collectSnapshot(fake.client)).rejects.toThrow('statement timeout');
    const ids = fake.ids();
    expect(ids[ids.length - 2]).toBe('constraints');
    expect(ids[ids.length - 1]).toBe('ROLLBACK');
    expect(fake.client.end).toHaveBeenCalledTimes(1);
  });

  it('closes the connection without a transaction when connecting fails', async () => {
    const fake = fakeClient(fullRows(), { failConnect: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
    await expect(audit.collectSnapshot(fake.client)).rejects.toThrow('ECONNREFUSED');
    expect(fake.client.query).not.toHaveBeenCalled();
    expect(fake.client.end).toHaveBeenCalledTimes(1);
  });

  it('turns a failed data query into unknown results without losing the rollback', async () => {
    const rows = fullRows();
    removeRows(rows, 'constraints', (row) => row.name !== 'transactions_account_user_fkey');
    const fake = fakeClient(rows, { failOn: 'seeds' });
    const report = audit.evaluate(await audit.collectSnapshot(fake.client));
    expect(statusOf(report, '001').status).toBe(STATUS.ambiguous);
    expect(statusOf(report, '006').unknown.map((check) => check.label)).toContain("no public.transactions row points at another user's account");
    expect(fake.ids()).not.toContain('backfillTransactions');
    expect(fake.ids()[fake.ids().length - 1]).toBe('ROLLBACK');
  });
});

describe('migration audit: classification', () => {
  it('reports every migration FULLY_PRESENT for a complete catalog, reading only aggregate seed counts', async () => {
    const fake = fakeClient(fullRows());
    const report = audit.evaluate(await audit.collectSnapshot(fake.client));
    for (const migration of report.migrations) {
      expect([migration.version, migration.status, migration.missing, migration.mismatched]).toEqual([migration.version, STATUS.full, [], []]);
    }
    expect(report.fullyPresentPrefix).toEqual(['001', '002', '003', '004', '005', '006', '007', '008', '009', '010']);
    expect(report.unexpected.filter((item) => item.severity === 'conflict')).toEqual([]);
    expect(report.meta.dataQueries).toEqual([audit.STATEMENTS.seeds.readsApplicationData]);
    expect(fake.ids()).not.toContain('backfillTransactions');
    expect(statusOf(report, '005').results.find((check) => check.label.startsWith('foreign key public.transactions (account_id)'))!.detail).toBe(
      'replaced by transactions_account_user_fkey from 006'
    );
  });

  it('reports a partially applied migration with exactly what is missing', async () => {
    const rows = fullRows();
    removeRows(rows, 'policies', (row) => row.name !== 'budgets_delete_own');
    findRow(rows, 'relations', 'recurring_transactions').rls_enabled = false;
    const report = await reportOf(rows);
    const migration = statusOf(report, '002');
    expect(migration.status).toBe(STATUS.partial);
    expect(migration.missing.map((check) => check.label)).toEqual([
      'row level security enabled on public.recurring_transactions',
      'policy budgets_delete_own on public.budgets',
    ]);
    expect(statusOf(report, '001').status).toBe(STATUS.full);
  });

  it('reports a migration that never ran as NOT_PRESENT and the later one that depends on it as partial', async () => {
    const rows = fullRows();
    withoutInvestments(rows);
    const report = await reportOf(rows);
    expect(statusOf(report, '007').status).toBe(STATUS.none);
    expect(statusOf(report, '007').passed).toBe(0);
    expect(statusOf(report, '008').status).toBe(STATUS.partial);
    expect(statusOf(report, '008').missing.map((check) => check.label)).toEqual([
      'column public.investments.server_updated_at',
      'index idx_investments_user_server_updated on public.investments',
      'trigger investments_set_server_updated_at on public.investments',
    ]);
    expect(report.fullyPresentPrefix).toEqual(['001', '002', '003', '004', '005', '006']);
  });

  it('does not accept a same-name index with a different definition or on another table', async () => {
    const rows = fullRows();
    findRow(rows, 'indexes', 'idx_transactions_user_date').columns = ['user_id', 'created_at'];
    Object.assign(findRow(rows, 'indexes', 'idx_categories_user'), { table_name: 'budgets' });
    const report = await reportOf(rows);
    const migration = statusOf(report, '001');
    expect(migration.status).toBe(STATUS.partial);
    expect(migration.mismatched.map((check) => [check.label, check.detail])).toEqual([
      ['index idx_categories_user on public.categories', 'on public.budgets, expected public.categories'],
      ['index idx_transactions_user_date on public.transactions', 'columns (user_id, created_at), expected (user_id, date)'],
    ]);
  });

  it('normalises PostgreSQL expression formatting in policies but not their meaning', async () => {
    expect(audit.normalizeExpression('( AUTH.UID()  =  "user_id" )')).toBe(audit.normalizeExpression('(auth.uid() = user_id)'));
    expect(audit.normalizeExpression('((auth.uid() = user_id))')).toBe('auth.uid()=user_id');
    expect(audit.normalizeExpression("CHECK ((theme = ANY (ARRAY['system'::text, 'light'::text])))")).toBe(
      audit.normalizeExpression("CHECK (theme = ANY (ARRAY['system'::text, 'light'::text]))")
    );
    expect(audit.normalizeExpression('CHECK (((month >= 1) AND (month <= 12)))')).toBe(audit.normalizeExpression('CHECK ((month >= 1) AND (month <= 12))'));
    expect(audit.normalizeExpression("'0'::bigint")).toBe(audit.normalizeExpression('0'));
    expect(audit.normalizeExpression("'INR'::text")).not.toBe(audit.normalizeExpression("'inr'::text"));
    expect(audit.normalizeExpression('((a = 1) OR (b = 2)) AND (c = 3)')).not.toBe(audit.normalizeExpression('(a = 1) OR ((b = 2) AND (c = 3))'));

    const rows = fullRows();
    findRow(rows, 'policies', 'transactions_select_own').using_expression = '((auth.uid() = user_id))';
    findRow(rows, 'policies', 'budgets_update_own').check_expression = '( AUTH.UID()  =  "user_id" )';
    expect(statusOf(await reportOf(rows), '002').status).toBe(STATUS.full);

    findRow(rows, 'policies', 'categories_select_own').using_expression = '(auth.uid() IS NOT NULL)';
    findRow(rows, 'policies', 'system_categories_select').roles = ['public'];
    const migration = statusOf(await reportOf(rows), '002');
    expect(migration.status).toBe(STATUS.partial);
    expect(migration.mismatched.map((check) => check.detail)).toEqual([
      'TO public, expected TO authenticated',
      'USING (auth.uid() IS NOT NULL), expected (auth.uid() = user_id)',
    ]);
  });

  it('detects a trigger with the wrong timing or function', async () => {
    const rows = fullRows();
    findRow(rows, 'triggers', 'transactions_set_updated_at').type_bits = 1 | 16;
    findRow(rows, 'triggers', 'on_auth_user_created').function_name = 'set_updated_at';
    const migration = statusOf(await reportOf(rows), '003');
    expect(migration.status).toBe(STATUS.partial);
    expect(migration.mismatched.map((check) => [check.label, check.detail])).toEqual([
      ['trigger transactions_set_updated_at on public.transactions', 'AFTER, expected BEFORE'],
      ['trigger on_auth_user_created on auth.users', 'executes public.set_updated_at(), expected public.handle_new_user()'],
    ]);
    expect(audit.decodeTrigger(23)).toEqual({ timing: 'BEFORE', events: ['INSERT', 'UPDATE'], level: 'ROW' });
  });

  it('detects a partial unique index whose predicate differs', async () => {
    const rows = fullRows();
    findRow(rows, 'indexes', 'idx_budgets_unique_active_period').predicate = null;
    let migration = statusOf(await reportOf(rows), '004');
    expect(migration.status).toBe(STATUS.partial);
    expect(migration.mismatched[0].detail).toBe('WHERE none, expected (deleted_at IS NULL)');

    findRow(rows, 'indexes', 'idx_budgets_unique_active_period').predicate = '(deleted_at IS NOT NULL)';
    migration = statusOf(await reportOf(rows), '004');
    expect(migration.mismatched[0].detail).toBe('WHERE (deleted_at IS NOT NULL), expected (deleted_at IS NULL)');

    findRow(rows, 'indexes', 'idx_budgets_unique_active_period').predicate = '((deleted_at IS NULL))';
    expect(statusOf(await reportOf(rows), '004').status).toBe(STATUS.full);
  });

  it('detects a foreign key with the wrong delete action and then checks the backfill with one boolean', async () => {
    const rows = fullRows();
    Object.assign(findRow(rows, 'constraints', 'transactions_account_user_fkey'), { on_delete: 'c', delete_set_columns: [] });
    const fake = fakeClient(rows);
    const report = audit.evaluate(await audit.collectSnapshot(fake.client));
    const migration = statusOf(report, '006');
    expect(migration.status).toBe(STATUS.partial);
    expect(migration.mismatched.map((check) => check.detail)).toEqual(['transactions_account_user_fkey: ON DELETE CASCADE, expected SET NULL']);
    expect(fake.ids()).toContain('backfillTransactions');
    expect(fake.ids()).not.toContain('backfillRecurring');
    expect(report.meta.dataQueries).toContain(audit.STATEMENTS.backfillTransactions.readsApplicationData);
  });

  it('reports rows the 006 backfill would still change without reading or counting them', async () => {
    const rows = fullRows();
    removeRows(rows, 'constraints', (row) => row.name !== 'transactions_account_user_fkey');
    rows.backfillTransactions = [{ has_unmatched: true }];
    const report = await reportOf(rows);
    expect(statusOf(report, '006').missing.map((check) => [check.label, check.detail])).toEqual([
      [
        'foreign key transactions_account_user_fkey public.transactions (account_id, user_id) → public.accounts (id, user_id) ON DELETE SET NULL',
        undefined,
      ],
      ["no public.transactions row points at another user's account", 'rows still point at an account owned by a different user (count not read)'],
    ]);
  });

  it('distinguishes an EXECUTE privilege inherited through PUBLIC from an explicit grant', async () => {
    const rows = fullRows();
    Object.assign(findRow(rows, 'functions', 'sync_server_time'), {
      default_acl: true,
      execute_grantees: ['PUBLIC', 'postgres'],
      anon_can_execute: true,
      authenticated_can_execute: true,
    });
    const report = await reportOf(rows);
    const hardening = statusOf(report, '009');
    expect(hardening.status).toBe(STATUS.none);
    expect(hardening.missing.map((check) => check.detail)).toEqual([
      'PUBLIC can execute. EXECUTE grantees: PUBLIC, postgres (default ACL, never granted or revoked)',
      'anon can execute through PUBLIC. EXECUTE grantees: PUBLIC, postgres (default ACL, never granted or revoked)',
    ]);
    expect(statusOf(report, '008').status).toBe(STATUS.partial);
    expect(statusOf(report, '008').mismatched[0].detail).toContain('authenticated can execute only through PUBLIC, not an explicit grant');
  });

  it('reports 009 as not applied when Supabase default grants still let anon execute', async () => {
    const rows = fullRows();
    Object.assign(findRow(rows, 'functions', 'sync_server_time'), {
      default_acl: false,
      execute_grantees: ['PUBLIC', 'anon', 'authenticated', 'postgres', 'service_role'],
      anon_can_execute: true,
    });
    const report = await reportOf(rows);
    expect(statusOf(report, '008').status).toBe(STATUS.full);
    expect(statusOf(report, '009').status).toBe(STATUS.none);
    expect(statusOf(report, '009').missing[1].detail).toContain('anon can execute through an explicit grant and PUBLIC');
  });

  it('flags extra permissive policies as conflicts and redacts identifiers when printing them', async () => {
    const rows = fullRows();
    rows.policies.push({
      schema: 'public',
      table_name: 'transactions',
      name: 'Enable read access for all users',
      command: 'r',
      permissive: true,
      roles: ['public'],
      using_expression: "(user_id = '3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f'::uuid)",
      check_expression: null,
    });
    const report = await reportOf(rows);
    expect(statusOf(report, '002').status).toBe(STATUS.full);
    expect(report.unexpected.filter((item) => item.severity === 'conflict')).toEqual([
      expect.objectContaining({ text: expect.stringContaining('adds access on top of the owner-only policies') }),
    ]);
    const text = audit.renderReport(report, { target: 'host:5432/postgres (project x)' });
    expect(text).toContain("(user_id = '<uuid>'::uuid)");
    expect(text).not.toContain('3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f');
  });

  it('compares seeds by aggregate counts and reports duplicates and changed rows', async () => {
    const rows = fullRows();
    rows.seeds[0].exact_matches = 2;
    Object.assign(rows.seeds[4], { exact_matches: 0, name_matches: 1 });
    Object.assign(rows.seeds[5], { exact_matches: 0, name_matches: 0 });
    const report = await reportOf(rows);
    const migration = statusOf(report, '001');
    expect(migration.status).toBe(STATUS.partial);
    expect(migration.mismatched.map((check) => check.label)).toEqual(['system category Bills (expense)']);
    expect(migration.missing.map((check) => check.label)).toEqual(['system category Rent (expense)']);
    expect(report.unexpected.map((item) => item.text).filter((text) => text.includes('system_categories'))).toEqual([
      expect.stringContaining('1 duplicate seed row(s)'),
      expect.stringContaining('1 row(s) that match no 001 seed definition'),
    ]);
  });

  it('does not count seeds through row level security and reports them as unknown instead', async () => {
    const rows = fullRows();
    findRow(rows, 'relations', 'system_categories').rls_filters_current_user = true;
    const fake = fakeClient(rows);
    const report = audit.evaluate(await audit.collectSnapshot(fake.client));
    expect(statusOf(report, '001').status).toBe(STATUS.ambiguous);
    expect(fake.ids()).not.toContain('seeds');
    expect(report.meta.dataQueries).toEqual([]);
  });

  it('marks functions with a different body or settings as mismatched without printing the body', async () => {
    const rows = fullRows();
    Object.assign(findRow(rows, 'functions', 'handle_new_user'), { config: null, source: 'begin return new; end;' });
    const migration = statusOf(await reportOf(rows), '003');
    expect(migration.status).toBe(STATUS.partial);
    expect(migration.mismatched[0].detail).toMatch(/^settings \[none\], expected \[search_path=public\]; body differs \(sha256 [0-9a-f]{12}, expected [0-9a-f]{12}\)$/);
  });
});

describe('migration audit: 010 account foreign key delete semantics', () => {
  const KEYS: Array<[string, string, string]> = [
    ['public.transactions', 'transactions_account_user_fkey', '006'],
    ['public.recurring_transactions', 'recurring_account_user_fkey', '006'],
    ['public.investments', 'investments_account_user_fkey', '007'],
  ];
  const keyRow = (rows: Record<string, Row[]>, table: string, name: string) => findRow(rows, 'constraints', name, table);
  /** pg_get_constraintdef output on PostgreSQL 17. */
  const pg17Definition = (setColumns: string) => `FOREIGN KEY (account_id, user_id) REFERENCES accounts(id, user_id) ON DELETE SET NULL${setColumns}`;
  const conflicts = (report: Report) => report.unexpected.filter((item) => item.severity === 'conflict').map((item) => item.text);
  const investmentsLabel =
    'foreign key investments_account_user_fkey public.investments (account_id, user_id) → public.accounts (id, user_id) ON DELETE SET NULL (account_id)';

  it('accepts ON DELETE SET NULL (account_id) as PostgreSQL 17 reports it, and keeps 006 and 007 fully present', async () => {
    const rows = fullRows();
    for (const [table, name] of KEYS) Object.assign(keyRow(rows, table, name), { definition: pg17Definition(' (account_id)') });
    const report = await reportOf(rows);
    const migration = statusOf(report, '010');
    expect(migration.status).toBe(STATUS.full);
    expect(migration.evidence).toBe('foreign keys 3/3, sole account FKs 3/3, nullability 6/6');
    expect(statusOf(report, '006').status).toBe(STATUS.full);
    expect(statusOf(report, '007').status).toBe(STATUS.full);
    expect(statusOf(report, '006').results.find((check) => check.label.startsWith('foreign key transactions_account_user_fkey'))!.detail).toBe(
      'transactions_account_user_fkey, amended by 010 to ON DELETE SET NULL (account_id)'
    );
    expect(conflicts(report)).toEqual([]);
  });

  it('reports the original keys (SET NULL on every key column) as 010 NOT_PRESENT and everything else fully present', async () => {
    const rows = fullRows();
    for (const [table, name] of KEYS) Object.assign(keyRow(rows, table, name), { delete_set_columns: [], definition: pg17Definition('') });
    const report = await reportOf(rows);
    const migration = statusOf(report, '010');
    expect(migration.status).toBe(STATUS.none);
    expect(migration.missing.map((check) => check.detail)).toEqual(
      KEYS.map(([, name, version]) => `${name} still has the ${version} definition: ON DELETE SET NULL on every key column, including the NOT NULL user_id`)
    );
    expect(report.migrations.filter((entry) => entry.version !== '010').map((entry) => entry.status)).toEqual(Array(9).fill(STATUS.full));
    expect(report.fullyPresentPrefix).toEqual(['001', '002', '003', '004', '005', '006', '007', '008', '009']);
    expect(conflicts(report)).toEqual([]);
  });

  it('treats a row without a delete column list as SET NULL on every key column', async () => {
    const rows = fullRows();
    for (const [table, name] of KEYS) delete keyRow(rows, table, name).delete_set_columns;
    expect(statusOf(await reportOf(rows), '010').status).toBe(STATUS.none);
  });

  it.each([
    ['SET NULL (user_id)', { delete_set_columns: ['user_id'] }, 'ON DELETE SET NULL (user_id), expected SET NULL (account_id)'],
    ['SET NULL (account_id, user_id)', { delete_set_columns: ['account_id', 'user_id'] }, 'ON DELETE SET NULL (account_id, user_id), expected SET NULL (account_id)'],
    ['CASCADE', { on_delete: 'c', delete_set_columns: [] }, 'ON DELETE CASCADE, expected SET NULL (account_id)'],
    ['RESTRICT', { on_delete: 'r', delete_set_columns: [] }, 'ON DELETE RESTRICT, expected SET NULL (account_id)'],
    ['NO ACTION', { on_delete: 'a', delete_set_columns: [] }, 'ON DELETE NO ACTION, expected SET NULL (account_id)'],
    ['reversed source columns', { columns: ['user_id', 'account_id'] }, 'columns (user_id, account_id), expected (account_id, user_id)'],
    ['reversed referenced columns', { ref_columns: ['user_id', 'id'] }, 'references public.accounts (user_id, id), expected public.accounts (id, user_id)'],
    ['a NOT VALID key', { validated: false }, 'NOT VALID (existing rows were never checked)'],
  ])('rejects %s on one key and reports 010 as partial', async (_label, change, detail) => {
    const rows = fullRows();
    Object.assign(keyRow(rows, 'public.investments', 'investments_account_user_fkey'), change);
    const migration = statusOf(await reportOf(rows), '010');
    expect(migration.status).toBe(STATUS.partial);
    expect(migration.mismatched.map((check) => [check.label, check.detail])).toEqual([[investmentsLabel, `investments_account_user_fkey: ${detail}`]]);
  });

  it('does not call a database where every key has some other wrong action NOT_PRESENT', async () => {
    const rows = fullRows();
    for (const [table, name] of KEYS) Object.assign(keyRow(rows, table, name), { on_delete: 'c', delete_set_columns: [] });
    expect(statusOf(await reportOf(rows), '010').status).toBe(STATUS.ambiguous);
  });

  it('flags an old key left beside the corrected one, in the migration and as a conflict', async () => {
    const rows = fullRows();
    const corrected = keyRow(rows, 'public.transactions', 'transactions_account_user_fkey');
    rows.constraints.push({ ...corrected, name: 'transactions_account_user_fkey_old', delete_set_columns: [], definition: pg17Definition('') });
    const report = await reportOf(rows);
    const migration = statusOf(report, '010');
    expect(migration.status).toBe(STATUS.partial);
    expect(migration.mismatched.map((check) => [check.label, check.detail])).toEqual([
      ['transactions_account_user_fkey is the only foreign key from public.transactions to public.accounts', `also: transactions_account_user_fkey_old ${pg17Definition('')}`],
    ]);
    expect(conflicts(report)).toEqual([`constraint transactions_account_user_fkey_old on public.transactions: ${pg17Definition('')}`]);
  });

  it('requires user_id to stay NOT NULL', async () => {
    const rows = fullRows();
    findRow(rows, 'columns', 'user_id', 'public.investments').nullable = true;
    const migration = statusOf(await reportOf(rows), '010');
    expect(migration.status).toBe(STATUS.partial);
    expect(migration.mismatched.map((check) => [check.label, check.detail])).toEqual([['public.investments.user_id is NOT NULL', 'nullable']]);
  });

  it('reads the delete column list from pg_constraint.confdelsetcols in key order with a read-only statement', () => {
    const { sql } = audit.STATEMENTS.constraints;
    expect(sql).toContain('pg_catalog.unnest(co.confdelsetcols) with ordinality as k(attnum, ord)');
    expect(sql).toMatch(/a\.attrelid = co\.conrelid and a\.attnum = k\.attnum order by k\.ord\) as delete_set_columns/);
    expect(() => audit.assertReadOnlyStatement(sql)).not.toThrow();
  });
});

describe('migration audit: command line', () => {
  function runDeps(options: { client?: object; env?: Row; envText?: string; envIgnored?: boolean; files?: Record<string, string> } = {}) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const createClient = jest.fn((_config: Row) => options.client ?? fakeClient(fullRows()).client);
    const exec = jest.fn(async () => ({ code: options.envIgnored === false ? 1 : 0, stdout: '', stderr: '' }));
    const deps = {
      root: process.cwd(),
      cwd: process.cwd(),
      env: options.env ?? { SUPABASE_DB_URL: POOLER_URL, EXPO_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co` },
      exec,
      readdir: (dir: string) => readdirSync(dir),
      readFile: (file: string) => {
        const name = file.split(/[\\/]/).pop()!;
        if (name === 'project-ref') throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        if (name.startsWith('.env')) return options.envText ?? '';
        if (options.files && name in options.files) return options.files[name];
        return readFileSync(file, 'utf8');
      },
      stdout: (text: string) => stdout.push(text),
      stderr: (text: string) => stderr.push(text),
      createClient,
    };
    return { deps, createClient, out: () => stdout.join(''), err: () => stderr.join(''), all: () => stdout.join('') + stderr.join('') };
  }

  function expectNoSecrets(text: string) {
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain(encodeURIComponent(PASSWORD));
    expect(text).not.toContain(POOLER_URL);
    expect(text).not.toMatch(/postgres(ql)?:\/\/postgres[:.]/);
  }

  it('audits a complete database, prints the report table and exits 0 without printing secrets', async () => {
    const h = runDeps();
    expect(await audit.run([], h.deps)).toBe(EXIT.ok);
    const out = h.out();
    expect(out).toContain('| Migration | Status | Passed checks | Missing checks | Mismatched checks | Evidence | Recommended next action |');
    expect(out).toContain('| 001_initial_schema.sql | FULLY_PRESENT |');
    expect(out).toContain('Leading run of FULLY_PRESENT migrations: 001–010.');
    expect(out).toContain('Target: aws-0-ap-south-1.pooler.supabase.com:5432/postgres (project abcdefghijklmnopqrst)');
    expect(out).toContain('Changes: none. No migration, migration-history, schema, privilege or data change was made.');
    expectNoSecrets(h.all());
    const config = h.createClient.mock.calls[0][0];
    expect(config).toEqual(
      expect.objectContaining({ host: 'aws-0-ap-south-1.pooler.supabase.com', port: 5432, user: `postgres.${REF}`, password: PASSWORD, ssl: { rejectUnauthorized: true } })
    );
  });

  it('exits 3 when any migration is not fully present', async () => {
    const rows = fullRows();
    withoutInvestments(rows);
    const h = runDeps({ client: fakeClient(rows).client });
    expect(await audit.run([], h.deps)).toBe(EXIT.findings);
    expect(h.out()).toContain('| 007_create_investments.sql | NOT_PRESENT | 0/30 |');
  });

  it('redacts the connection string and password from database errors', async () => {
    const failing = fakeClient(fullRows(), { failConnect: new Error(`could not connect with ${POOLER_URL} using ${PASSWORD}`) });
    const h = runDeps({ client: failing.client });
    expect(await audit.run([], h.deps)).toBe(EXIT.failed);
    expect(h.err()).toContain('No audit result. Nothing was changed.');
    expectNoSecrets(h.all());
  });

  it.each([
    ['ECONNREFUSED', 'Could not reach the database (ECONNREFUSED)'],
    ['ENOTFOUND', 'Could not reach the database (ENOTFOUND)'],
    ['SELF_SIGNED_CERT_IN_CHAIN', 'TLS certificate verification failed (SELF_SIGNED_CERT_IN_CHAIN). Download the CA certificate'],
    ['28P01', 'The database rejected the user or password (28P01).'],
  ])('reports %s as a connection failure without starting a transaction', async (code, message) => {
    const failing = fakeClient(fullRows(), { failConnect: Object.assign(new Error(`failure ${code}`), { code }) });
    const h = runDeps({ client: failing.client });
    expect(await audit.run([], h.deps)).toBe(EXIT.failed);
    expect(h.err()).toContain(message);
    expect(failing.client.query).not.toHaveBeenCalled();
    expect(failing.client.end).toHaveBeenCalledTimes(1);
  });

  it.each([['003_triggers.sql'], ['010_fix_account_fk_delete_semantics.sql']])(
    'refuses before connecting when %s no longer matches the manifest',
    async (file) => {
      const h = runDeps({ files: { [file]: 'select 1;' } });
      expect(await audit.run([], h.deps)).toBe(EXIT.failed);
      expect(h.err()).toContain(`${file} differs from the version this audit describes`);
      expect(h.createClient).not.toHaveBeenCalled();
    }
  );

  it('refuses an env file that git would commit, before connecting', async () => {
    const h = runDeps({ env: {}, envText: `SUPABASE_DB_URL=${POOLER_URL}\n`, envIgnored: false });
    expect(await audit.run(['--env-file', '.env.local'], h.deps)).toBe(EXIT.failed);
    expect(h.err()).toContain('is not ignored by git');
    expect(h.createClient).not.toHaveBeenCalled();
    expectNoSecrets(h.all());
  });

  it('loads the connection string from an ignored env file', async () => {
    const h = runDeps({ env: {}, envText: `SUPABASE_DB_URL=${POOLER_URL}\nEXPO_PUBLIC_SUPABASE_URL=https://${REF}.supabase.co\n` });
    expect(await audit.run(['--env-file=.env.local'], h.deps)).toBe(EXIT.ok);
    expect(h.out()).toContain('Connection string: SUPABASE_DB_URL.');
    expectNoSecrets(h.all());
  });

  it('does not echo an unknown argument', async () => {
    const h = runDeps();
    expect(await audit.run([POOLER_URL], h.deps)).toBe(EXIT.usage);
    expect(h.err()).toContain('Unknown argument at position 1 (not shown)');
    expect(h.createClient).not.toHaveBeenCalled();
    expectNoSecrets(h.all());
  });

  it('verifies TLS by default, accepts a CA certificate, and skips TLS only for a local database', () => {
    const remote = { host: 'db.abcdefghijklmnopqrst.supabase.co', port: '5432', database: 'postgres', user: 'postgres', password: 'pw', kind: 'direct' };
    expect(audit.clientConfig(remote, null).ssl).toEqual({ rejectUnauthorized: true });
    expect(audit.clientConfig(remote, 'PEM').ssl).toEqual({ rejectUnauthorized: true, ca: 'PEM' });
    expect(audit.clientConfig({ ...remote, host: 'localhost', kind: 'local' }, null).ssl).toBe(false);
  });
});
