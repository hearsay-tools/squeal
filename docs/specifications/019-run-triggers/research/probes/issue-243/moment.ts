// Throwaway probe: actual moment predicate, synthetic store and elapsed time.
import assert from 'node:assert/strict';
import { momentHolds } from '../../../../../../src/core/scheduler/slow-trigger.ts';
const consumer = { worktreeId: 'probe', sessionId: 'session', agentId: 'agent' };
let at = 0;
let turn = 'in-turn';
const store = {
  consumers: { list: () => [{ consumer, lastSeenAt: at, lastDeliveredAt: at }] },
  meta: { get: () => JSON.stringify({ 'session\nagent': { turn } }) },
  revisions: { latest: () => ({ number: 1, createdAt: 0 }) },
};
const context = { store, worktreeId: 'probe', now: () => at };
const pause = { at: 'pause', quietMs: 3000 };
const edit = { at: 'edit', quietMs: 3000 };
let pauseReady = 0;
let editReady = 0;
for (at = 0; at <= 6 * 60 * 60 * 1000; at += 1000) {
  if (momentHolds(context as never, pause as never)) pauseReady++;
  if (momentHolds(context as never, edit as never)) editReady++;
}
assert.equal(pauseReady, 0);
assert.equal(editReady, 21598);
turn = 'idle';
assert.equal(momentHolds(context as never, pause as never), true);
console.log(JSON.stringify({ simulatedHours: 6, pauseReady, editReady, pauseReadyAfterIdle: true }));
