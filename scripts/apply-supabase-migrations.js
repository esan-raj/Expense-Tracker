#!/usr/bin/env node
'use strict';
/**
 * Guarded runner for supabase/migrations, driven by the Supabase CLI's tracked migration
 * history (supabase_migrations.schema_migrations).
 *
 *   node scripts/apply-supabase-migrations.js [--check] [--env-file .env.local]
 *   node scripts/apply-supabase-migrations.js --apply --confirm-project-ref <ref> [--env-file .env.local]
 *
 * --check (the default) only reads the remote history. --apply pushes pending migrations after
 * every local and remote check passes. The connection string is read from SUPABASE_DB_URL
 * (then DATABASE_URL, then POSTGRES_URL) and is never printed or put on a command line.
 */
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');

const SUPABASE_CLI_VERSION = '2.119.0';
const DB_URL_VARIABLES = ['SUPABASE_DB_URL', 'DATABASE_URL', 'POSTGRES_URL'];
const MIGRATIONS_DIR = 'supabase/migrations';
const NAME_PATTERN = /^(\d{3})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;
const PROJECT_REF = /^[a-z0-9]{20}$/;
/** Published migrations: content hashes after normalizing line endings to LF. */
const PUBLISHED = {
  '008': {
    name: '008_server_sync_cursor.sql',
    sha256: '0613eaabe33e2f6f310ba328ae669c76ddb0420fc44554c5c86f6cc30c880211',
  },
  '009': {
    name: '009_harden_sync_server_time_permissions.sql',
    sha256: '5cdf1b754509d27f23d3e696592c94253e1e4a1196b4b6d55cdb742c44fa66dc',
  },
};
const EXIT = { ok: 0, failed: 1, usage: 2, unknown: 3 };
const LIST_TIMEOUT_MS = 2 * 60 * 1000;
const PUSH_TIMEOUT_MS = 15 * 60 * 1000;

const CONNECTION_HELP =
  'Copy the connection string from Supabase Dashboard → Project Settings → Database → Connection string ' +
  'into SUPABASE_DB_URL in an ignored file such as .env.local. Never commit it.';

const USAGE = `Usage:
  node scripts/apply-supabase-migrations.js [--check] [--env-file <path>] [--verbose]
  node scripts/apply-supabase-migrations.js --apply --confirm-project-ref <ref> [--env-file <path>] [--verbose]

  --check                     Read-only (default): validate local files and show what the remote has applied.
  --apply                     Push pending migrations. Requires --confirm-project-ref.
  --confirm-project-ref <ref> The Supabase project ref you expect to change ("local" for a local database).
  --env-file <path>           Load variables from a git-ignored file. Variables already set win.
  --verbose                   Also print the Supabase CLI output (credentials redacted).

Connection string: SUPABASE_DB_URL, or DATABASE_URL, or POSTGRES_URL (first one set wins).`;

class RunnerError extends Error {
  constructor(message, exitCode = EXIT.failed) {
    super(message);
    this.name = 'RunnerError';
    this.exitCode = exitCode;
  }
}

function parseArgs(argv) {
  const options = { mode: null, envFile: null, confirmProjectRef: null, verbose: false, help: false };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    const inline = eq > 0 ? arg.slice(eq + 1) : undefined;
    // Never echo an unknown argument: it could be a pasted connection string.
    if (seen.has(flag)) throw new RunnerError(`${flag} was given more than once.`, EXIT.usage);
    seen.add(flag);
    switch (flag) {
      case '--check':
      case '--apply':
        if (inline !== undefined) throw new RunnerError(`${flag} takes no value.`, EXIT.usage);
        if (options.mode) throw new RunnerError('Use either --check or --apply, not both.', EXIT.usage);
        options.mode = flag.slice(2);
        break;
      case '--env-file':
      case '--confirm-project-ref': {
        const value = inline !== undefined ? inline : argv[(index += 1)];
        if (!value || value.startsWith('--')) throw new RunnerError(`${flag} needs a value.`, EXIT.usage);
        if (flag === '--env-file') options.envFile = value;
        else options.confirmProjectRef = value;
        break;
      }
      case '--verbose':
        options.verbose = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new RunnerError(`Unknown argument at position ${index + 1} (not shown). Run with --help.`, EXIT.usage);
    }
  }
  options.mode = options.mode || 'check';
  return options;
}

/** Variables from an env file, without the ones already set in `env` (those win). */
function readEnvFile(filePath, env, readFile = fs.readFileSync) {
  if (typeof util.parseEnv !== 'function') {
    throw new RunnerError('Node.js 20.12 or newer is required to read --env-file.');
  }
  let text;
  try {
    text = readFile(filePath, 'utf8');
  } catch (error) {
    throw new RunnerError(`Cannot read the env file ${filePath} (${(error && error.code) || 'error'}).`);
  }
  const values = {};
  for (const [name, value] of Object.entries(util.parseEnv(text))) {
    if (env[name] === undefined) values[name] = value;
  }
  return values;
}

function resolveDatabaseUrl(env) {
  const present = DB_URL_VARIABLES.filter((name) => typeof env[name] === 'string' && env[name].trim());
  if (!present.length) {
    throw new RunnerError(
      `No database connection string found. Set SUPABASE_DB_URL (DATABASE_URL and POSTGRES_URL are accepted as fallbacks). ${CONNECTION_HELP}`
    );
  }
  return { variable: present[0], url: env[present[0]].trim(), ignored: present.slice(1) };
}

function parseDatabaseUrl(raw) {
  if (/^https?:\/\//i.test(raw)) {
    throw new RunnerError(
      `The database variable holds an HTTP address (the Supabase API URL?), not a PostgreSQL connection string. ${CONNECTION_HELP}`
    );
  }
  if (/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(raw) || /^sb_(publishable|secret)_/.test(raw)) {
    throw new RunnerError(
      `The database variable holds an API key (anon or service role), not a PostgreSQL connection string. ${CONNECTION_HELP}`
    );
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new RunnerError(
      `The database connection string is malformed. Special characters in the password must be percent-encoded. ${CONNECTION_HELP}`
    );
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new RunnerError(`The database connection string must start with postgres:// or postgresql://. ${CONNECTION_HELP}`);
  }
  if (!url.hostname) throw new RunnerError('The database connection string has no host.');
  if (!url.username) throw new RunnerError('The database connection string has no user.');
  let user;
  let password;
  try {
    user = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch {
    throw new RunnerError('The database connection string has an invalid percent-encoded user or password.');
  }
  const host = url.hostname.toLowerCase();
  const direct = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(host);
  const pooler = host.endsWith('.pooler.supabase.com') ? /^[^.]+\.([a-z0-9]{20})$/.exec(user) : null;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(host);
  return {
    raw,
    host,
    port: url.port || '5432',
    database: decodeURIComponent(url.pathname.replace(/^\//, '')) || 'postgres',
    user,
    password,
    projectRef: (direct && direct[1]) || (pooler && pooler[1]) || null,
    kind: direct ? 'direct' : pooler ? 'pooler' : local ? 'local' : 'other',
  };
}

/** Host, port and database only: never the user's password or the full string. */
function describeTarget(parsed) {
  const ref = parsed.projectRef ? `project ${parsed.projectRef}` : parsed.kind === 'local' ? 'local database' : 'project not identifiable from host';
  return `${parsed.host}:${parsed.port}/${parsed.database} (${ref})`;
}

function createRedactor(secrets) {
  const values = [...new Set(secrets.filter((value) => typeof value === 'string' && value.length >= 3))];
  for (const value of [...values]) {
    try {
      values.push(encodeURIComponent(value));
    } catch {
      // Unencodable values are still redacted verbatim.
    }
  }
  values.sort((a, b) => b.length - a.length);
  return (text) => {
    let out = String(text);
    for (const value of values) out = out.split(value).join('[redacted]');
    return out
      .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, 'postgresql://[redacted]')
      .replace(/(PGPASSWORD\s*[=:]\s*)\S+/gi, '$1[redacted]');
  };
}

function projectRefFromApiUrl(value) {
  const match = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/i.exec((value || '').trim());
  return match ? match[1].toLowerCase() : null;
}

function readLinkedProjectRef(root, readFile = fs.readFileSync) {
  try {
    const ref = readFile(path.join(root, 'supabase', '.temp', 'project-ref'), 'utf8').trim();
    return PROJECT_REF.test(ref) ? ref : null;
  } catch {
    return null;
  }
}

/**
 * Which project the connection string points at, cross-checked against every other source.
 * --apply also needs the caller's confirmation to match. Returns the notes worth printing.
 */
function verifyTarget({ parsed, apiRef, linkedRef, mode, confirm }) {
  const sources = [
    ['database host or pooler user', parsed.projectRef],
    ['EXPO_PUBLIC_SUPABASE_URL', apiRef],
    ['linked project (supabase/.temp/project-ref)', linkedRef],
  ].filter(([, ref]) => ref);
  const refs = [...new Set(sources.map(([, ref]) => ref))];
  if (refs.length > 1) {
    throw new RunnerError(
      `The project sources disagree: ${sources.map(([name, ref]) => `${name} = ${ref}`).join(', ')}. Refusing to continue.`
    );
  }
  const notes = [];
  if (parsed.kind !== 'local' && !parsed.projectRef) {
    notes.push(
      refs.length
        ? `The database host does not reveal a project ref; matching used ${sources.map(([name]) => name).join(' and ')} only.`
        : 'No source identifies the project.'
    );
  }
  if (mode !== 'apply' && !confirm) return { ref: refs[0] || null, notes };

  if (!confirm) {
    throw new RunnerError('--apply needs --confirm-project-ref <project-ref> naming the project you expect to change.', EXIT.usage);
  }
  if (parsed.kind === 'local') {
    if (confirm !== 'local') throw new RunnerError('The connection string points at a local database: confirm with --confirm-project-ref local.');
    return { ref: 'local', notes };
  }
  if (!PROJECT_REF.test(confirm)) throw new RunnerError('--confirm-project-ref must be a 20-character Supabase project ref.', EXIT.usage);
  if (!refs.length) {
    throw new RunnerError(
      'Cannot identify the target project from the database URL, EXPO_PUBLIC_SUPABASE_URL or a linked project. Refusing to apply.'
    );
  }
  if (refs[0] !== confirm) {
    throw new RunnerError(`--confirm-project-ref ${confirm} does not match the target project ${refs[0]}. Nothing was applied.`);
  }
  return { ref: refs[0], notes };
}

function sha256(text) {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
}

/** Problems with the local migration files; empty when they are safe to push. */
function migrationProblems(files) {
  const problems = [];
  const byNumber = new Map();
  for (const file of files) {
    const match = NAME_PATTERN.exec(file.name);
    if (!match) {
      problems.push(`${file.name}: migration names must look like 010_short_description.sql.`);
      continue;
    }
    byNumber.set(match[1], [...(byNumber.get(match[1]) || []), file]);
  }
  for (const [number, list] of byNumber) {
    if (list.length > 1) problems.push(`Migration ${number} exists more than once: ${list.map((file) => file.name).join(', ')}.`);
  }
  const highest = Math.max(0, ...[...byNumber.keys()].map(Number));
  for (let number = 1; number <= highest; number += 1) {
    const key = String(number).padStart(3, '0');
    if (!byNumber.has(key)) problems.push(`Migration ${key} is missing: numbers must run from 001 without gaps.`);
  }
  for (const [number, pin] of Object.entries(PUBLISHED)) {
    const list = byNumber.get(number) || [];
    if (!list.length && highest < Number(number)) problems.push(`Published migration ${pin.name} is missing.`);
    for (const file of list) {
      if (file.name !== pin.name) problems.push(`${file.name}: published migration ${number} must stay named ${pin.name}.`);
      else if (sha256(file.content) !== pin.sha256) {
        problems.push(`${pin.name} changed after it was published. Add a new migration instead of editing it.`);
      }
    }
  }
  return problems;
}

function versionsOf(files) {
  return files.map((file) => NAME_PATTERN.exec(file.name)[1]).sort();
}

/** A table cell without surrounding whitespace or one pair of backticks (the CLI on Windows wraps cells). */
function tableCell(cell) {
  const trimmed = cell.trim();
  const quoted = /^`([^`]*)`$/.exec(trimmed);
  return quoted ? quoted[1].trim() : trimmed;
}

/** Rows of `supabase migration list`: the Local and Remote version columns. */
function parseMigrationList(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.includes('|')) continue;
    const [local = '', remote = ''] = line.split('|').map(tableCell);
    if (/^local$/i.test(local) || (/^-*$/.test(local) && /^-*$/.test(remote))) continue;
    if ((local && !/^\d+$/.test(local)) || (remote && !/^\d+$/.test(remote))) continue;
    rows.push({ local: local || null, remote: remote || null });
  }
  return rows;
}

/** Migration files named by `supabase db push --dry-run`. */
function parseDryRun(text) {
  const names = [];
  for (const line of String(text).split(/\r?\n/)) {
    const match = /^\s*(?:[•*-]\s*)?(\d+_[^\s]+\.sql)\s*$/.exec(line);
    if (match) names.push(match[1]);
  }
  return names;
}

/** What remains to apply, and anything that makes a tracked push unsafe. */
function planMigrations(localVersions, rows) {
  const remote = [...new Set(rows.map((row) => row.remote).filter(Boolean))].sort();
  const remoteSet = new Set(remote);
  const localSet = new Set(localVersions);
  const problems = [];
  for (const version of remote) {
    if (!localSet.has(version)) {
      problems.push(`The remote history records ${version}, which is not in ${MIGRATIONS_DIR}. Restore that file before applying.`);
    }
  }
  const pending = localVersions.filter((version) => !remoteSet.has(version));
  if (!remote.length && pending.length) {
    problems.push(
      'The remote migration history is empty. If this database was set up by running the SQL files by hand, a push would run ' +
        `${pending[0]} onwards again. Check which migrations the schema already has, record them with ` +
        '`supabase migration repair --status applied <version>`, then run --check again. This runner never repairs history.'
    );
  }
  const newest = remote[remote.length - 1];
  const older = newest ? pending.filter((version) => version < newest) : [];
  if (older.length) {
    problems.push(
      `Migrations ${older.join(', ')} are older than the newest applied migration ${newest}. Applying them would need --include-all, which this runner does not use.`
    );
  }
  return { applied: localVersions.filter((version) => remoteSet.has(version)), pending, problems };
}

function resolveCli(env, { execPath = process.execPath, platform = process.platform, exists = fs.existsSync } = {}) {
  if (env.SUPABASE_CLI_PATH) return { file: env.SUPABASE_CLI_PATH, prefix: [] };
  const nodeDir = path.dirname(execPath);
  const candidates = [
    env.npm_execpath ? path.join(path.dirname(env.npm_execpath), 'npx-cli.js') : null,
    platform === 'win32'
      ? path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npx-cli.js')
      : path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
  ].filter(Boolean);
  const npx = candidates.find((candidate) => exists(candidate));
  if (!npx) {
    throw new RunnerError('Cannot find npx to run the Supabase CLI. Install the CLI and set SUPABASE_CLI_PATH to its executable.');
  }
  return { file: execPath, prefix: [npx, '--yes', `supabase@${SUPABASE_CLI_VERSION}`] };
}

/**
 * Command and environment for one Supabase CLI call. The password travels in PGPASSWORD, which
 * the CLI's PostgreSQL driver reads when the URL has none, so it never appears in arguments.
 */
function buildCliCall(cli, parsed, cliArgs, baseEnv) {
  const url = new URL(parsed.raw);
  url.password = '';
  const env = { ...baseEnv };
  for (const name of DB_URL_VARIABLES) delete env[name];
  if (parsed.password) env.PGPASSWORD = parsed.password;
  else delete env.PGPASSWORD;
  return { file: cli.file, args: [...cli.prefix, ...cliArgs, '--db-url', url.toString()], env };
}

function execCommand(file, args, { cwd, env, timeoutMs }) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, ...result });
    };
    let child;
    try {
      child = spawn(file, args, { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ code: null, signal: null, stdout, stderr, error: (error && error.code) || 'spawn failed', started: false });
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      finish({ code: null, signal: 'timeout', started: true });
    }, timeoutMs);
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => finish({ code: null, signal: null, error: (error && error.code) || 'error', started: false }));
    child.on('close', (code, signal) => finish({ code, signal, started: true }));
  });
}

function listMigrationFiles(root, deps) {
  const dir = path.join(root, MIGRATIONS_DIR);
  return deps
    .readdir(dir)
    .filter((name) => !name.startsWith('.'))
    .sort()
    .map((name) => ({ name, content: deps.readFile(path.join(dir, name), 'utf8') }));
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
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
    const root = deps.root;
    out(`SpendWise migration runner (${options.mode === 'apply' ? 'APPLY' : 'check only, no changes'})`);

    // Local checks first: nothing connects until the repository is in a pushable state.
    const files = listMigrationFiles(root, deps);
    const problems = migrationProblems(files);
    if (problems.length) throw new RunnerError(`Local migrations are not safe to push:\n- ${problems.join('\n- ')}`);
    const localVersions = versionsOf(files);
    out(`Local migrations: ${files.length} (${localVersions[0]}–${localVersions[localVersions.length - 1]}), 008 and 009 match their published hashes.`);

    const status = await deps.exec('git', ['status', '--porcelain', '--untracked-files=all', '--', MIGRATIONS_DIR], {
      cwd: root,
      env: deps.env,
      timeoutMs: LIST_TIMEOUT_MS,
    });
    if (status.code !== 0) throw new RunnerError('Could not run git status; run this from a git checkout of the repository.');
    if (status.stdout.trim()) {
      throw new RunnerError(`${MIGRATIONS_DIR} has uncommitted changes. Commit or discard them first:\n${status.stdout.trim()}`);
    }

    let env = deps.env;
    if (options.envFile) {
      const envPath = path.resolve(deps.cwd, options.envFile);
      if (isInside(root, envPath)) {
        const ignored = await deps.exec('git', ['check-ignore', '-q', '--', envPath], { cwd: root, env: deps.env, timeoutMs: LIST_TIMEOUT_MS });
        if (ignored.code !== 0) {
          throw new RunnerError(`${options.envFile} is not ignored by git. Keep the connection string in an ignored file such as .env.local.`);
        }
      }
      env = { ...readEnvFile(envPath, deps.env, deps.readFile), ...deps.env };
    }

    const { variable, url, ignored } = resolveDatabaseUrl(env);
    redactLater.fn = createRedactor([url]);
    const parsed = parseDatabaseUrl(url);
    redactLater.fn = createRedactor([url, parsed.password]);
    out(`Connection string: ${variable}${ignored.length ? ` (also set, ignored: ${ignored.join(', ')})` : ''}.`);
    out(`Target: ${describeTarget(parsed)}`);

    const target = verifyTarget({
      parsed,
      apiRef: projectRefFromApiUrl(env.EXPO_PUBLIC_SUPABASE_URL),
      linkedRef: readLinkedProjectRef(root, deps.readFile),
      mode: options.mode,
      confirm: options.confirmProjectRef,
    });
    target.notes.forEach((note) => out(`Note: ${note}`));
    if (options.mode === 'apply') out(`Confirmed target project: ${target.ref}.`);

    const cli = resolveCli(env, deps);
    const callCli = async (cliArgs, timeoutMs) => {
      const call = buildCliCall(cli, parsed, cliArgs, env);
      const result = await deps.exec(call.file, call.args, { cwd: root, env: call.env, timeoutMs });
      if (options.verbose) {
        const output = `${result.stdout}${result.stderr}`.trim();
        if (output) out(`--- supabase ${cliArgs.join(' ')}\n${output}\n---`);
      }
      return result;
    };
    const tail = (result) => {
      const text = `${result.stderr || ''}${result.stdout || ''}`.trim().split(/\r?\n/).slice(-5).join('\n');
      const reason = result.error ? ` (${result.error})` : '';
      return text ? `${reason}\n${text}` : reason;
    };
    const readHistory = async () => {
      const result = await callCli(['migration', 'list'], LIST_TIMEOUT_MS);
      if (result.code !== 0) return { error: result };
      const rows = parseMigrationList(result.stdout);
      if (!rows.length) return { error: { ...result, stderr: 'Unrecognised `supabase migration list` output.' } };
      return { plan: planMigrations(localVersions, rows) };
    };

    const before = await readHistory();
    if (before.error) {
      throw new RunnerError(`Could not read the remote migration history. Nothing was changed.${tail(before.error)}`);
    }
    const { plan } = before;
    out(`Recorded as applied on the remote: ${plan.applied.length ? plan.applied.join(', ') : 'none'}`);
    out(`Pending: ${plan.pending.length ? plan.pending.join(', ') : 'none'}`);
    if (plan.problems.length) {
      throw new RunnerError(`The remote history is not safe to push to. Nothing was changed.\n- ${plan.problems.join('\n- ')}`);
    }
    if (options.mode === 'check') {
      out(plan.pending.length ? 'Check passed. Run with --apply --confirm-project-ref <ref> to apply the pending migrations.' : 'Check passed. The remote is up to date.');
      return EXIT.ok;
    }
    if (!plan.pending.length) {
      out('The remote is already up to date. Nothing to apply.');
      return EXIT.ok;
    }

    const dryRun = await callCli(['db', 'push', '--dry-run'], LIST_TIMEOUT_MS);
    if (dryRun.code !== 0) throw new RunnerError(`The Supabase CLI dry run failed. Nothing was applied.${tail(dryRun)}`);
    const wouldPush = parseDryRun(`${dryRun.stdout}\n${dryRun.stderr}`).map((name) => name.split('_')[0]).sort();
    if (wouldPush.join(',') !== plan.pending.join(',')) {
      throw new RunnerError(
        `The Supabase CLI would push [${wouldPush.join(', ')}] but the history shows [${plan.pending.join(', ')}] pending. Nothing was applied.`
      );
    }

    out(`Applying ${plan.pending.join(', ')}…`);
    const push = await callCli(['db', 'push', '--yes'], PUSH_TIMEOUT_MS);
    if (push.started === false) {
      err(`Could not start the Supabase CLI. Nothing was applied.${tail(push)}`);
      return EXIT.failed;
    }
    if (push.code === null) {
      err(
        'The apply command was interrupted, so its result is unknown. Do not run --apply again yet: run --check to see which migrations the remote recorded.'
      );
      return EXIT.unknown;
    }
    if (push.code !== 0) {
      const after = await readHistory();
      const recorded = after.plan ? `Recorded as applied now: ${after.plan.applied.join(', ') || 'none'}.` : 'The remote history could not be read afterwards.';
      err(
        `The Supabase CLI stopped with an error.${tail(push)}\nEach migration file runs in its own transaction: the failing file was rolled back and not recorded, files before it stay applied. ${recorded} Fix the cause, then run --check before retrying.`
      );
      return EXIT.failed;
    }
    const after = await readHistory();
    if (after.error || after.plan.pending.length || after.plan.problems.length) {
      err('The push reported success, but the remote history does not confirm it. Run --check before doing anything else.');
      return EXIT.unknown;
    }
    out(`Applied ${plan.pending.join(', ')}. The remote history now records ${after.plan.applied.join(', ')}.`);
    return EXIT.ok;
  } catch (error) {
    if (error instanceof RunnerError) {
      err(`Error: ${error.message}`);
      if (error.exitCode === EXIT.usage) err(USAGE);
      return error.exitCode;
    }
    err(`Unexpected error: ${(error && error.message) || error}`);
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
    execPath: process.execPath,
    platform: process.platform,
    exists: fs.existsSync,
  };
}

module.exports = {
  DB_URL_VARIABLES,
  EXIT,
  PUBLISHED,
  SUPABASE_CLI_VERSION,
  RunnerError,
  buildCliCall,
  createRedactor,
  describeTarget,
  execCommand,
  isInside,
  migrationProblems,
  parseArgs,
  parseDatabaseUrl,
  parseDryRun,
  parseMigrationList,
  planMigrations,
  projectRefFromApiUrl,
  readEnvFile,
  readLinkedProjectRef,
  resolveCli,
  resolveDatabaseUrl,
  run,
  verifyTarget,
  defaultDeps,
};

if (require.main === module) {
  run(process.argv.slice(2), defaultDeps()).then((code) => {
    process.exitCode = code;
  });
}
