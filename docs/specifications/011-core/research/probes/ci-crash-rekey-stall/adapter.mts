// Throwaway diagnostic. Product code is imported unchanged. See README.md.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const repo = process.cwd();
const { VitestAdapter } = await import(pathToFileURL(join(repo, 'src/runners/vitest/adapter.ts')).href);
const { WorktreePaths } = await import(pathToFileURL(join(repo, 'src/runners/vitest/paths.ts')).href);
const node = await import('vitest/node');
const dir = mkdtempSync('/tmp/squeal-crash-cancel-');
const root = join(dir, 'project');
mkdirSync(join(root, 'test'), { recursive: true });
symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'dir');
writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
writeFileSync(join(root, 'vitest.config.ts'), 'export default {test:{include:["test/*.test.ts"],maxWorkers:1}};\n');
const rewritten = join(dir, 'rewritten');
const release = join(dir, 'release');
const fixed = 'import { it } from "vitest"; it("survives", () => {});\n';
writeFileSync(join(root, 'test/kill.test.ts'), `
import { existsSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { it } from 'vitest';
it('rewrites then dies after cancellation starts', async () => {
  writeFileSync(new URL(import.meta.url), ${JSON.stringify(fixed)});
  writeFileSync(${JSON.stringify(rewritten)}, String(process.pid));
  while (!existsSync(${JSON.stringify(release)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  process.kill(process.pid, 'SIGKILL');
});
`);
let vitest;
let cancels = 0;
let cancelSettled = false;
let runs = 0;
let creates = 0;
const wrapped = { ...node, createVitest: async (...args) => {
  creates++;
  vitest = await node.createVitest(...args);
  const cancel = vitest.cancelCurrentRun.bind(vitest);
  vitest.cancelCurrentRun = (reason) => {
    cancels++;
    const promise = cancel(reason);
    promise.then(() => { cancelSettled = true; }, () => { cancelSettled = true; });
    // This write is after Pool.cancel has captured the active task.
    writeFileSync(release, 'go');
    return promise;
  };
  const run = vitest.runTestSpecifications.bind(vitest);
  vitest.runTestSpecifications = (...args) => { runs++; return run(...args); };
  return vitest;
}};
let adapter = new VitestAdapter(new WorktreePaths(root), wrapped);
const abort = new AbortController();
const ref = { project: '', path: 'test/kill.test.ts' };
const options = (id, signal, timeoutMs) => ({ runId: id, logDir: join(dir, id), timeoutMs, signal });
try {
  await adapter.open();
  const first = adapter.run([ref], options('first', abort.signal, 5000));
  for (let i = 0; !existsSync(rewritten) && i < 1000; i++) await delay(5);
  assert.ok(existsSync(rewritten), 'child rewrote the test');
  abort.abort('supersession');
  const report = await first;
  assert.equal(report.end, 'crashed');
  assert.equal(cancelSettled, false);
  assert.equal(creates, 1);
  const cancelled = vitest.cancelPromise;
  assert.ok(cancelled, 'Vitest retains the pending cancellation promise');
  if (process.argv.includes('--fresh')) {
    // Control: callers close and open the public adapter, without patching it.
    await adapter.close();
    adapter = new VitestAdapter(new WorktreePaths(root), wrapped);
    await adapter.open();
    const recovered = await adapter.run([ref], options('fresh', undefined, 5000));
    assert.equal(recovered.end, 'completed');
    assert.equal(recovered.completedFiles.length, 1);
    assert.equal(creates, 2);
    await adapter.close();
    console.log(JSON.stringify({ control: 'fresh adapter', creates, result: recovered.end,
      completedFiles: recovered.completedFiles, results: recovered.results.length }));
    console.log('PASS: a fresh instance runs the rewritten file');
    process.exitCode = 0;
  } else {
    await adapter.invalidate([{path: ref.path, kind: 'edit'}]);
    const spawned = vitest.state.workersSpawned;
    let secondSettled = false;
    const secondAbort = new AbortController();
    const second = adapter.run([ref], options('second', secondAbort.signal, 600000));
    second.then(() => { secondSettled = true; });
    await delay(500);
    const pid = Number(readFileSync(rewritten, 'utf8'));
    let childGone = false;
    try { process.kill(pid, 0); } catch { childGone = true; }
    const evidence = {
      node: process.version, vitest: node.version, creates, runs, cancels,
      firstEnd: report.end, firstFailure: report.failure,
      cancelSettled, sameCancelPromise: vitest.cancelPromise === cancelled,
      firstChildGone: childGone, secondSettled,
      workersSpawnedBeforeSecond: spawned, workersSpawnedAfterSecond: vitest.state.workersSpawned,
      secondLogExists: existsSync(join(dir, 'second/vitest.log')),
    };
    console.log(JSON.stringify(evidence, null, 2));
    assert.equal(runs, 2);
    assert.equal(childGone, true);
    assert.equal(secondSettled, false);
    assert.equal(vitest.state.workersSpawned, spawned);
    assert.equal(vitest.cancelPromise, cancelled);
    // Exercise the existing bounded escape rather than leave a process running.
    secondAbort.abort('stop');
    const ended = await second;
    console.log(JSON.stringify({ cleanupReport: ended.end, cleanupFailure: ended.failure }));
    await adapter.close();
    console.log('PASS: crash/cancel leaves the next run waiting before spawn; bounded cleanup finished');
    process.exitCode = 0;
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
