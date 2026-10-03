// THROWAWAY PROBE. Not product code. See README.md.
// Block the event loop while 40k writes happen, overflowing the kernel inotify queue (max_queued_events).
// Does the backend report anything about the loss?
import fs from 'node:fs';
import path from 'node:path';
const backend = process.argv[2];
const root = path.resolve('tmp', `ovf-${backend}-${process.pid}`);
fs.rmSync(root, { recursive: true, force: true });
for (let i = 0; i < 100; i++) fs.mkdirSync(path.join(root, `d${i}`), { recursive: true });
const seen = new Set(); const errors = []; let last = 0; const mark = () => (last = performance.now());
let stop;
if (backend === 'parcel') {
  const w = await import('@parcel/watcher');
  const s = await w.subscribe(root, (e, evs) => { if (e) errors.push(String(e)); evs.forEach((x) => seen.add(x.path)); mark(); });
  stop = () => s.unsubscribe();
} else {
  const { watch } = await import('chokidar');
  const w = watch(root, { ignoreInitial: true });
  w.on("all", (t, p) => { seen.add(p); mark(); }); w.on('error', (e) => errors.push(String(e)));
  await new Promise((r) => w.on('ready', r));
  stop = () => w.close();
}
await new Promise((r) => setTimeout(r, 300));
const N = Number(process.argv[3] ?? 40000); // > /proc/sys/fs/inotify/max_queued_events (16384 here)
for (let i = 0; i < N; i++) fs.writeFileSync(path.join(root, `d${i % 100}`, `f${i}.ts`), 'x'); // sync: watcher thread may drain, JS cannot
const writesDone = performance.now();
await new Promise((r) => setTimeout(r, Number(process.argv[4] ?? 5000)));
await stop();
fs.rmSync(root, { recursive: true, force: true });
console.log(JSON.stringify({ backend, created: N, reported: seen.size, lastEventAfterWritesMs: Math.round(last - writesDone), errors: errors.slice(0, 2) }));
process.exit(0);
