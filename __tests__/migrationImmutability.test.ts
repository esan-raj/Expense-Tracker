/// <reference types="jest" />

const fs = require('fs') as {
  readFileSync: (path: string, encoding: string) => string;
  readdirSync: (path: string) => string[];
};
const path = require('path') as { join: (...parts: string[]) => string };
const crypto = require('crypto') as {
  createHash: (algorithm: string) => { update: (data: string) => { digest: (encoding: string) => string } };
};

const dir = path.join(process.cwd(), 'supabase', 'migrations');

/** Line endings depend on the checkout (core.autocrlf); the pinned hash is of the LF form. */
const sha256Lf = (name: string) =>
  crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(dir, name), 'utf8').replace(/\r\n/g, '\n'))
    .digest('hex');

describe('applied migrations', () => {
  it('008 is byte-for-byte the version already deployed', () => {
    expect(sha256Lf('008_server_sync_cursor.sql')).toBe('0613eaabe33e2f6f310ba328ae669c76ddb0420fc44554c5c86f6cc30c880211');
  });

  it('has exactly one migration per number and nothing after 009', () => {
    const numbers = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => name.slice(0, 3));
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers.filter((n) => n === '009')).toHaveLength(1);
    expect(numbers.filter((n) => Number(n) > 9)).toEqual([]);
  });
});
