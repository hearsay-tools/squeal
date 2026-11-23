// Throwaway probe. Synthetic store facts; no daemon, tests, or repository mutations.
import { readOwn } from '../../../../../../src/core/delivery/own-count.js';
import { lateNotes } from '../../../../../../src/core/delivery/late.js';
import { rekeyedMetaKey } from '../../../../../../src/core/scheduler/rekeyed-record.js';
import { testFileId } from '../../../../../../src/core/keys/reverse-index.js';
const at = Date.now();
const consumer = { worktreeId: 'probe', sessionId: 's', agentId: 'main' };
const file = { project: 'browser', path: 'browser/a.test.ts' };
const meta = new Map([[rekeyedMetaKey('probe'), JSON.stringify({ [testFileId(file)]: [1, 1] })]]);
const revision = { number: 1, createdAt: at - 180_000, head: 'new-base', dirty: false, trigger: 'watch', changes: [{ path: 'src/a.ts', oldHash: 'a', newHash: 'b' }] };
// A partial store double supplies only the operations exercised by this probe.
const store: any = {
 meta: { get: (key: string) => meta.get(key) ?? null, set: (key: string, value: string) => meta.set(key, value) },
 revisions: { latest: () => revision, range: () => [revision], get: () => revision },
 testFileKeys: { list: () => [{ testFile: file, key: 'new', revision: 1, pending: 'queued' }] },
 worktrees: { get: () => ({ id: 'probe', root: '.', commonDir: '.', daemon: { startedAt: at - 200_000, heartbeatAt: at, heartbeatIntervalMs: 3_600_000, squealVersion: 'probe', socketPath: '', token: 'probe' } }) },
 results: { newestForTestFile: () => [] },
 consumers: { list: () => [{ consumer }] },
};
const own = readOwn(store, consumer, 0, [])!;
console.log('clean watched base revision own count:', JSON.stringify(own));
// Only the header fields read by lateNotes are supplied.
const header: any = { testFilesListed: true, noTestsAtEdit: false };
const first = lateNotes(store, consumer, own, at, () => header);
console.log('first late:', JSON.stringify(first?.late));
first?.tell();
console.log('second late:', JSON.stringify(lateNotes(store, consumer, own, at + 1, () => header)?.late ?? null));
console.log('all groups on-request:', JSON.stringify(lateNotes({ ...store, meta: { ...store.meta, get: (key: string) => key.includes('editsLate') ? null : store.meta.get(key) } }, consumer, own, at, () => ({ ...header, noTestsAtEdit: true }))?.late ?? null));
