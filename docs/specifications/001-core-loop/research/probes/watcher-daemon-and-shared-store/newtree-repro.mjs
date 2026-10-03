// THROWAWAY PROBE. Not product code. See README.md.
// Copy a whole directory tree into the watched root (like `git worktree add`, `cp -r`, unzip), then later
// write into a deep file of that new tree. Are the copied files reported, and is the new tree watched afterwards?
import fs from 'node:fs';
import path from 'node:path';
const backend = process.argv[2];
const T = path.resolve('tmp', `newtree-${backend}-${process.pid}`);
const root = path.join(T, 'root'), srcTree = path.join(T, 'template');
fs.rmSync(T, { recursive: true, force: true });
for (let i = 0; i < 300; i++) { fs.mkdirSync(path.join(srcTree, `m${i % 30}/x`), { recursive: true }); fs.writeFileSync(path.join(srcTree, `m${i % 30}/x/f${i}.ts`), '1'); }
fs.mkdirSync(root, { recursive: true });
const seen = [];
let stop;
if (backend === 'parcel') {
  const w = await import('@parcel/watcher');
  const s = await w.subscribe(root, (e, evs) => evs.forEach((x) => seen.push([x.type, path.relative(root, x.path)])));
  stop = () => s.unsubscribe();
} else if (backend === 'chokidar') {
  const { watch } = await import('chokidar');
  const w = watch(root, { ignoreInitial: true });
  w.on('all', (t, p) => seen.push([t, path.relative(root, p)]));
  await new Promise((r) => w.on('ready', r));
  stop = () => w.close();
} else {
  const w = fs.watch(root, { recursive: true }, (t, f) => seen.push([t, f]));
  stop = () => w.close();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(300);
fs.cpSync(srcTree, path.join(root, 'copied'), { recursive: true });
await sleep(1000);
const copiedFiles = new Set(seen.filter(([, p]) => p.endsWith('.ts')).map(([, p]) => p)).size;
seen.length = 0;
fs.writeFileSync(path.join(root, 'copied/m7/x/f7.ts'), 'later');
await sleep(800);
await stop();
fs.rmSync(T, { recursive: true, force: true });
console.log(JSON.stringify({ backend, copiedFilesReportedOf300: copiedFiles, laterWriteReported: seen.some(([, p]) => p === 'copied/m7/x/f7.ts'), laterEvents: seen.slice(0, 3) }));
process.exit(0);
