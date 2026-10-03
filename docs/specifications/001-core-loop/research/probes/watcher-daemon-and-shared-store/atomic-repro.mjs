// THROWAWAY PROBE. Not product code. See README.md.
// After an atomic save (write tmp + rename over), is a *later* plain write to the same file still reported?
import fs from 'node:fs';
import path from 'node:path';
const backend = process.argv[2];
const root = path.resolve('tmp', `atomic-${backend}-${process.pid}`);
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(path.join(root, 'a'), { recursive: true });
fs.writeFileSync(path.join(root, 'a/f.ts'), '1');
const seen = [];
let stop;
if (backend === 'parcel') {
  const w = await import('@parcel/watcher');
  const s = await w.subscribe(root, (e, evs) => evs.forEach((x) => seen.push(`${x.type} ${path.relative(root, x.path)}`)));
  stop = () => s.unsubscribe();
} else if (backend === 'chokidar') {
  const { watch } = await import('chokidar');
  const w = watch(root, { ignoreInitial: true });
  w.on('all', (t, p) => seen.push(`${t} ${path.relative(root, p)}`));
  await new Promise((r) => w.on('ready', r));
  stop = () => w.close();
} else {
  const w = fs.watch(root, { recursive: true }, (t, f) => seen.push(`${t} ${f}`));
  stop = () => w.close();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(300);
fs.writeFileSync(path.join(root, 'a/.f.ts.tmp'), '2');
fs.renameSync(path.join(root, 'a/.f.ts.tmp'), path.join(root, 'a/f.ts'));
await sleep(500);
seen.push('--- plain write after atomic save ---');
fs.writeFileSync(path.join(root, 'a/f.ts'), '3');
await sleep(500);
await stop();
fs.rmSync(root, { recursive: true, force: true });
console.log(backend.padEnd(8), JSON.stringify(seen));
process.exit(0);
