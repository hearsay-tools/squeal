import { test, expect } from 'vitest';
import { spawn, spawnSync, execFileSync, execSync } from 'node:child_process';
import { join } from 'node:path';
const root = join(import.meta.dirname, '..');
const run = (args: string[], env?: NodeJS.ProcessEnv, detached = false) => new Promise<string>((res, rej) => {
  const c = spawn(process.execPath, args, { env, detached, stdio: ['ignore', 'pipe', 'inherit'] });
  let out = ''; c.stdout!.on('data', (d) => (out += d)); c.on('error', rej); c.on('close', () => res(out));
});
test('spawn node child (inherited env)', async () => {
  expect(await run([join(root, 'scripts/child.mjs'), 'other'])).toBe('1');
});
test('spawn node child with env {} and detached, grandchild with env {}', async () => {
  expect(await run([join(root, 'scripts/child.mjs'), 'envless', 'grand'], {}, true)).toBe('1');
});
test('execFileSync node child', () => {
  expect(execFileSync(process.execPath, [join(root, 'scripts/child.mjs'), 'exec']).toString()).toBe('1');
});
test('shell script child', () => {
  expect(execSync(join(root, 'scripts/run.sh')).toString().trim()).toBe('shell');
});
