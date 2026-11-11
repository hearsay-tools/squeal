// Throwaway probe. Real scheduler/store; synthetic runner and presence records.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { claimBoundMs, Claims } from '../../../../../../src/core/scheduler/claims.js';
import { readNamedFiles } from '../../../../../../src/core/status/standing.js';
import type { SchedulerContext } from '../../../../../../src/core/scheduler/context.js';
import { DEFAULT_POLICY } from '../../../../../../src/core/types/policy.js';
import { claimRepo, clean, side } from './fixture.js';

const emit = (event: string, fields: object) => console.log(JSON.stringify({ event, ...fields }));
const started = Date.now();
const load = loadavg()[0];
const cpus = availableParallelism();
emit('environment', { at: new Date().toISOString(), node: process.version, load, cpus,
  defaultBoundMs: claimBoundMs(DEFAULT_POLICY.runner.timeoutMs), noTimeoutBoundMs: claimBoundMs(null) });
if (load > cpus) { emit('skipped', { reason: 'one-minute load above CPU count' }); process.exit(0); }
mkdirSync(new URL('.scratch/', import.meta.url), { recursive: true });
async function until(ok: () => boolean, label: string) {
  const deadline = Date.now() + 20000;
  while (!ok()) { if (Date.now() > deadline) throw new Error(`deadline: ${label}`); await delay(25); }
}
try {
  const { main, other } = claimRepo(849);
  const policy = { baseline: { onStart: 'lookup-then-run-missing' as const } };
  const owner = side(main, { count: 849, backlogTierSize: 200, policy });
  const requester = side(other, { count: 849, backlogTierSize: 200, policy });
  owner.runner.hold();
  await owner.scheduler.start();
  await until(() => owner.runner.active === 1, 'owner holds tier');
  const rows = owner.store.testFileKeys.list(owner.worktreeId);
  const held = rows.find(r => r.pending === 'running')!;
  const queued = rows.find(r => r.pending === 'queued')!;
  emit('owner-sweep', { total: rows.length, running: rows.filter(r=>r.pending==='running').length,
    queued: rows.filter(r=>r.pending==='queued').length, held: held.testFile.path, unclaimed: queued.testFile.path });
  await requester.scheduler.start();
  assert.equal(requester.keyOf(held.testFile.path), held.key);
  assert.equal(requester.keyOf(queued.testFile.path), queued.key);
  await requester.scheduler.promote([held.testFile, queued.testFile], 60000);
  await until(() => requester.phase(queued.testFile.path) === null, 'unclaimed file completes');
  await delay(1250);
  assert.equal(requester.runner.ran(held.testFile.path), 0);
  assert.equal(requester.phase(held.testFile.path), 'queued');
  assert.ok(requester.runner.ran(queued.testFile.path) > 0);
  const readAt = Date.now();
  const named = readNamedFiles(requester.store, requester.worktreeId, other, [held.testFile],
    { state: 'alive', lastHeartbeatAt: readAt }, readAt);
  assert.equal(named[0]?.pending?.kind, 'claim');
  emit('promoted-while-owner-live', { elapsedMs: Date.now()-started,
    heldLocalRuns: requester.runner.ran(held.testFile.path), queuedLocalRuns: requester.runner.ran(queued.testFile.path),
    reason: named[0]?.pending, readAt });

  // Pure clock-bound check using the actual Claims object and real claimant rows.
  let clock = Date.now();
  const claims = new Claims({ store: requester.store, worktreeId: requester.worktreeId,
    policy: { ...DEFAULT_POLICY, runner: { ...DEFAULT_POLICY.runner, timeoutMs: 1000 } }, now: () => clock } as SchedulerContext);
  assert.equal(claims.holds(held.key!), true);
  clock += 7000;
  assert.equal(claims.holds(held.key!), true);
  clock += 1;
  assert.equal(claims.holds(held.key!), false);
  emit('bound-clock-probe', { timeoutMs: 1000, heldAtMs: 7000, releasedAtMs: 7001, realTimeWaited: false });

  // End only this synthetic owner's held run without a result and close its scheduler.
  owner.runner.cancelled = true;
  const stopAt = Date.now();
  const closing = owner.scheduler.close();
  owner.runner.release();
  await closing;
  owner.stopBeat();
  await until(() => requester.phase(held.testFile.path) === null, 'requester completes released key');
  assert.equal(requester.runner.ran(held.testFile.path), 1);
  const pass = requester.store.knownStates.list(requester.worktreeId)
    .find(s => s.check.testPath === held.testFile.path && s.check.kind === 'test');
  assert.equal(pass?.outcome, 'pass');
  assert.equal(pass?.validity, 'current');
  emit('owner-stop', { recoveryMs: Date.now()-stopAt, heldLocalRuns: requester.runner.ran(held.testFile.path), outcome: pass?.outcome,
    validity: pass?.validity });

  const nextLoad = loadavg()[0];
  emit('takeover-load', { load: nextLoad, cpus });
  if (nextLoad <= cpus) {
    const boundedRepo = claimRepo(1);
    const a = side(boundedRepo.main, { count: 1, policy });
    const b = side(boundedRepo.other, { count: 1, policy, timeoutMs: 1000 });
    a.runner.hold();
    await a.scheduler.start();
    await until(() => a.runner.active === 1, 'bounded owner holds');
    const began = Date.now();
    await b.scheduler.start();
    await b.scheduler.promote([{ project: '', path: 'test/f00.test.ts' }], 20000);
    await until(() => b.runner.ran('test/f00.test.ts') === 1, 'live owner timeout takeover');
    const takeoverMs = Date.now() - began;
    assert.equal(a.runner.active, 1);
    await until(() => b.passing() === 1, 'takeover pass');
    emit('live-owner-takeover', { takeoverMs, requesterTimeoutMs: 1000, ownerActive: a.runner.active, passing: b.passing() });
  } else emit('takeover-skipped', { reason: 'one-minute load above CPU count' });
} finally {
  await clean();
}
emit('complete', { elapsedMs: Date.now()-started });
