import { test, expect } from 'vitest';
import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
test('worker thread reads', async () => {
  const w = new Worker(join(import.meta.dirname, '../scripts/worker.mjs'));
  expect(await new Promise((r) => w.once('message', r))).toBe('worker\n');
  await w.terminate();
});
