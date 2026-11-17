// Throwaway store probe. No daemon, runner, or product test starts.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cpus, loadavg } from 'node:os';

const source = resolve(process.env.SQUEAL_RESEARCH_SOURCE ?? '.');
const fromSource = (path: string) => import(pathToFileURL(join(source, path)).href);
const { worktreeIdFor } = await fromSource('src/core/fs/git-layout.ts');
const { openStore, isStoreOpenFailure } = await fromSource('src/core/store/open.ts');
const { recordRefinedApplied } = await fromSource('src/core/scheduler/refined.ts');
const { waitForNamed } = await fromSource('src/cli/status-wait-paths.ts');
const { printNamed } = await fromSource('src/cli/named-print.ts');
const version = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version;
const load = loadavg()[0];
console.log(JSON.stringify({ version, node: process.version, load1: load, cpus: cpus().length }));
if (load > cpus().length) throw new Error('Skipped: one-minute load exceeds CPU count');

for (const count of [2, 6]) {
  for (const scenario of ['pending-sync', 'pending-listing', 'settled']) {
    const root = mkdtempSync('/tmp/squeal-issue232-');
    const commonDir = join(root, '.git');
    mkdirSync(commonDir);
    writeFileSync(join(commonDir, 'HEAD'), 'ref: refs/heads/main\n');
    const store = openStore(commonDir);
    if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
    const now = Date.now();
    const id = worktreeIdFor(root);
    const paths = Array.from({ length: count }, (_, i) => `sample-${i + 1}.test.ts`);
    try {
      store.worktrees.upsert({ id, root, commonDir, isMain: true, registeredAt: now,
        daemon: { socketPath: '/tmp/unused-issue232.sock', startedAt: now,
          heartbeatAt: now, heartbeatIntervalMs: 5000, squealVersion: version, token: 'probe' } });
      const revision = scenario === 'pending-listing' ? 81 : 80;
      for (let i = 0; i < revision; i++) {
        store.revisions.append({ worktreeId: id, createdAt: now, head: null,
          dirty: false, trigger: 'watch', changes: [] });
      }
      recordRefinedApplied(store, id, 80);
      for (const path of paths) {
        store.testFileKeys.upsertMany([{ worktreeId: id, testFile: { project: '', path },
          key: `key-${path}`, revision: 80, pending: null }]);
        store.knownStates.upsertMany([{ worktreeId: id,
          check: { kind: 'test', project: '', testPath: path, fullName: 'passes' },
          outcome: 'pass', validity: 'current', pendingPhase: null, observedAt: 80,
          commit: null, origin: { kind: 'local' }, durationMs: 1,
          location: null, summary: null, fingerprint: null }]);
      }
      const sync = scenario === 'pending-sync' ? { state: 'pending' }
        : { state: 'synced', revision, incarnation: null };
      const wait = await waitForNamed(root, paths, { timeoutMs: 80, pollMs: 10,
        settleMs: 0, now: () => now,
        sync: () => ({ current: () => sync, stop() {} }),
        ask: async () => [], promote: async () => {} });
      let stdout = '', stderr = '', text = '';
      const code = await printNamed(Promise.resolve(wait), { json: true }, {
        env: {}, stdout: (s: string) => { stdout += s; }, stderr: (s: string) => { stderr += s; },
      }, () => now);
      const textCode = await printNamed(Promise.resolve(wait), { json: false }, {
        env: {}, stdout: (s: string) => { text += s; }, stderr: () => {},
      }, () => now);
      const { selection } = JSON.parse(stdout);
      assert.equal(code, scenario === 'settled' ? 0 : 3);
      assert.equal(textCode, code);
      assert.equal(selection.code, code);
      assert.equal(selection.result, scenario === 'settled' ? 'pass' : 'none');
      assert.equal(selection.reason, scenario === 'pending-sync' ? 'unsynced'
        : scenario === 'pending-listing' ? 'unlisted' : undefined);
      assert.equal(selection.testFiles.length, count);
      assert(selection.testFiles.every((f: { state: string; verdict: string }) => f.state === 'current' && f.verdict === 'pass'));
      assert.match(text, scenario === 'settled' ? /no known failures/ : /Named test files have no verdict:/);
      assert.match(stderr, scenario === 'settled' ? /no known failures/ : /Named test files have no verdict:/);
      console.log(JSON.stringify({ scenario, count, code, selection, text, stderr }));
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  }
}
console.log('PASS: six cases; text, JSON and return code agree; pending sync/listing explain the absent verdict.');
