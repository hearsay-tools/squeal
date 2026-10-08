import { test, expect } from 'vitest';
import { readFileSync, existsSync, createReadStream, writeFileSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import * as fsns from 'fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const root = join(import.meta.dirname, '..');
test('fs reads', async () => {
  expect(JSON.parse(readFileSync(join(root, 'data/input.json'), 'utf8')).value).toBe(1);
  expect(existsSync(join(root, 'data/missing.json'))).toBe(false);
  await readFile(join(root, 'data/promise.txt'), 'utf8');
  await new Promise((r) => createReadStream(join(root, 'data/stream.txt')).on('close', r).resume());
  fsns.readFileSync(join(root, 'data/esm.txt'));
  readdirSync(join(root, 'data'));
  writeFileSync(join(tmpdir(), 'ori-probe-out.txt'), 'x');
  writeFileSync(join(root, 'data/generated.txt'), 'x');
  readFileSync(join(root, 'data/generated.txt'));
});
