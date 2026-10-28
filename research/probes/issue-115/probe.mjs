// Throwaway research probe. Run with pnpm exec tsx, never as a test suite.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { countFile, COUNTER_VERSION } from '../../../src/core/code/count/index.ts';
import { runPass } from '../../../src/core/code/pass/pass.ts';
import { openCodeStore, isCodeStoreOpenFailure } from '../../../src/core/code/store/index.ts';
import { blobHash } from '../../../src/core/hash/index.ts';
import { readPolicy } from '../../../src/core/daemon/policy.ts';

const emit = (value) => console.log(JSON.stringify(value));
const here = dirname(fileURLToPath(import.meta.url));
const bytes = 597 * 1024;
function loadGate(stage) {
  const load = loadavg();
  const cpuCount = cpus().length;
  emit({ stage, time: new Date().toISOString(), node: process.version, load, cpuCount });
  if (load[0] > cpuCount) throw new Error('Skip live probe: one-minute load exceeds CPU count');
}
function fixture(dense) {
  let text = 'export function overTwenty(x: number): number {\n';
  for (let i = 0; i < 22; i++) text += `  if (x === ${i}) return ${i};\n`;
  text += '  return -1;\n}\n';
  let helpers = 0;
  if (dense) {
    while (true) {
      const next = `export function helper${helpers}(x: number): number { return x + ${helpers}; }\n`;
      if (Buffer.byteLength(text) + next.length + 5 > bytes) break;
      text += next;
      helpers++;
    }
  }
  text += `/*${'x'.repeat(bytes - Buffer.byteLength(text) - 5)}*/\n`;
  assert.equal(Buffer.byteLength(text), bytes);
  return { text, helpers };
}

loadGate('start');
for (const dense of [false, true]) {
  loadGate(dense ? 'dense' : 'comment-padded');
  const scratch = mkdtempSync(join(here, '.scratch-'));
  let store;
  try {
    const root = join(scratch, 'tree');
    const common = join(scratch, 'common');
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(common);
    const { text, helpers } = fixture(dense);
    const path = 'src/large.ts';
    writeFileSync(join(root, path), text);
    const hash = blobHash(Buffer.from(text), 'sha1');
    const file = { path, hash, size: bytes };
    const source = {
      latestRevision: () => 1,
      changedPaths: () => [path],
      lastChanges: () => new Map([[path, 1]]),
      movedHead: () => null,
      file: () => file,
      files: () => [file],
      listing: () => ({ revision: 1, count: 1 }),
      testFiles: () => [],
      ignored: () => [],
    };
    let calls = 0;
    const counter = {
      version: COUNTER_VERSION,
      async count(input, language) {
        calls++;
        const start = performance.now();
        const cpu = process.cpuUsage();
        const result = await countFile(input, language);
        const elapsed = process.cpuUsage(cpu);
        emit({ stage: 'count', dense, calls, wallMs: +(performance.now() - start).toFixed(2),
          cpuMs: +((elapsed.user + elapsed.system) / 1000).toFixed(2),
          functions: result.functions.length, errors: result.errors.length,
          target: result.functions.find((f) => f.qualifiedName === 'overTwenty')?.complexity });
        assert.equal(result.errors.length, 0);
        assert.equal(result.functions.length, helpers + 1);
        assert.equal(result.functions.find((f) => f.qualifiedName === 'overTwenty')?.complexity, 23);
        return result;
      },
    };
    let policy = readPolicy(root);
    store = openCodeStore(common, policy);
    assert(!isCodeStoreOpenFailure(store));
    const context = () => ({ worktreeId: 'probe', root, format: 'sha1', store, source, counter,
      complexity: policy.complexity, switchedOn: false, retry: new Set(), now: Date.now, log: emit });
    async function pass(stage, overrides = {}) {
      const start = performance.now();
      const cpu = process.cpuUsage();
      const report = await runPass({ ...context(), ...overrides });
      const elapsed = process.cpuUsage(cpu);
      const id = overrides.worktreeId ?? 'probe';
      const states = store.states.list(id);
      const target = states.find((s) => s.check.qualifiedName === 'overTwenty');
      emit({ stage, dense, bytes, maxFileBytes: policy.complexity.maxFileBytes, report, calls,
        tooBig: store.files.list(id)[0]?.tooBig ?? false, states: states.length, target,
        wallMs: +(performance.now() - start).toFixed(2),
        cpuMs: +((elapsed.user + elapsed.system) / 1000).toFixed(2) });
      return { states, target };
    }
    assert.equal(policy.complexity.maxFileBytes, 524288);
    const skipped = await pass('default');
    assert.equal(calls, 0);
    assert.equal(skipped.states.length, 0);
    assert.equal(store.files.list('probe')[0].tooBig, true);
    writeFileSync(join(root, 'squeal.config.json'), JSON.stringify({ complexity: { maxFileBytes: 1048576 } }));
    policy = readPolicy(root);
    assert.equal(policy.complexity.maxFileBytes, 1048576);
    const counted = await pass('raised');
    assert.equal(calls, 1);
    assert.equal(counted.target.outcome, 'fail');
    await pass('shared-blob', { worktreeId: 'second-probe' });
    assert.equal(calls, 1);
    // One warm direct count, bypassing cache, separates count cost from SQLite writes.
    loadGate('warm-count');
    await counter.count(text, 'typescript');
  } finally {
    store?.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}
emit({ stage: 'complete', packageVersion: JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url))).version });
