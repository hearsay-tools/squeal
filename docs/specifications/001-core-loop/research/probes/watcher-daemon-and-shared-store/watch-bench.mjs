// THROWAWAY PROBE. Not product code. See README.md.
// Usage: node watch-bench.mjs <fswatch|chokidar|parcel> [srcDirs] [ignoredDirs]
// Builds a temp tree, starts one watcher backend, runs scenarios, prints JSON.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const backend = process.argv[2];
const SRC_DIRS = Number(process.argv[3] ?? 500);
const IGNORED_DIRS = Number(process.argv[4] ?? 3000);
const root = path.resolve('tmp', `${backend}-${process.pid}`);

function mkTree() {
  fs.rmSync(root, { recursive: true, force: true });
  for (let i = 0; i < SRC_DIRS; i++) {
    const d = path.join(root, 'src', `d${i % 50}`, `s${i}`);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'f.ts'), 'x');
  }
  for (let i = 0; i < IGNORED_DIRS; i++) {
    const d = path.join(root, 'node_modules', `p${i % 100}`, `m${i}`);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'index.js'), 'x');
  }
  // nested worktree: a directory with a .git *file*, like `git worktree add` creates
  const wt = path.join(root, '.ai', 'worktrees', 'wt1');
  for (let i = 0; i < 200; i++) fs.mkdirSync(path.join(wt, `w${i}`), { recursive: true });
  fs.writeFileSync(path.join(wt, '.git'), 'gitdir: /nowhere\n');
  fs.mkdirSync(path.join(root, '.git', 'objects'), { recursive: true });
}

function inotifyWatches() {
  if (process.platform !== 'linux') return null;
  let n = 0;
  for (const fd of fs.readdirSync('/proc/self/fd')) {
    let l;
    try { l = fs.readlinkSync(`/proc/self/fd/${fd}`); } catch { continue; }
    if (l === 'anon_inode:inotify') {
      n += fs.readFileSync(`/proc/self/fdinfo/${fd}`, 'utf8').split('\n').filter((x) => x.startsWith('inotify wd:')).length;
    }
  }
  return n;
}

const IGNORE_RE = /(^|[\\/])(node_modules|\.git|\.ai[\\/]worktrees)([\\/]|$)/;
const events = []; // { t, type, rel }
const push = (type, abs) => events.push({ t: performance.now(), type, rel: path.relative(root, abs) });

async function start() {
  if (backend === 'fswatch') {
    // Node has no ignore option: every directory gets watched, we filter afterwards.
    const w = fs.watch(root, { recursive: true }, (type, f) => {
      if (f && !IGNORE_RE.test(f)) push(type, path.join(root, f));
    });
    return () => w.close();
  }
  if (backend === 'chokidar') {
    const { watch } = await import('chokidar');
    const w = watch(root, { ignoreInitial: true, ignored: (p) => IGNORE_RE.test(path.relative(root, p)) });
    w.on('all', (type, p) => push(type, p));
    await new Promise((r) => w.on('ready', r));
    return () => w.close();
  }
  if (backend === 'parcel') {
    const watcher = await import('@parcel/watcher');
    const sub = await watcher.subscribe(root, (err, evs) => {
      if (err) push('error', String(err));
      for (const e of evs) push(e.type, e.path);
    }, { ignore: ['node_modules', '.git', '.ai/worktrees'] });
    return () => sub.unsubscribe();
  }
  throw new Error(`unknown backend ${backend}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function settle(quietMs = 400, maxMs = 5000) {
  const t0 = performance.now();
  let last = events.length;
  for (;;) {
    await sleep(quietMs);
    if (events.length === last || performance.now() - t0 > maxMs) return;
    last = events.length;
  }
}

async function scenario(name, fn, expect) {
  events.length = 0;
  const t0 = performance.now();
  await fn();
  await settle();
  const seen = new Set(events.map((e) => e.rel));
  const missing = expect ? expect.filter((p) => !seen.has(p)) : [];
  const first = events[0] ? +(events[0].t - t0).toFixed(1) : null;
  return {
    name,
    events: events.length,
    firstEventMs: first,
    missingCount: missing.length,
    missingSample: missing.slice(0, 3),
    sample: events.slice(0, 4).map((e) => `${e.type} ${e.rel}`),
  };
}

mkTree();
const t0 = performance.now();
const stop = await start();
const readyMs = +(performance.now() - t0).toFixed(1);
await sleep(300);
const out = { backend, node: process.version, platform: process.platform, SRC_DIRS, IGNORED_DIRS, readyMs, inotifyWatches: inotifyWatches(), rssMB: Math.round(process.memoryUsage().rss / 1e6), scenarios: [] };
const S = out.scenarios;

S.push(await scenario('single write', () => fsp.writeFile(path.join(root, 'src/d1/s1/f.ts'), 'y'), ['src/d1/s1/f.ts']));
S.push(await scenario('atomic save (write tmp + rename over)', async () => {
  const tmp = path.join(root, 'src/d2/s2/.f.ts.swp');
  await fsp.writeFile(tmp, 'z');
  await fsp.rename(tmp, path.join(root, 'src/d2/s2/f.ts'));
}, ['src/d2/s2/f.ts']));
S.push(await scenario('mkdir -p then write immediately', async () => {
  const d = path.join(root, 'src/new/a/b/c');
  await fsp.mkdir(d, { recursive: true });
  await fsp.writeFile(path.join(d, 'g.ts'), 'x');
}, ['src/new/a/b/c/g.ts']));
S.push(await scenario('1000-file rewrite storm (checkout-like)', async () => {
  for (let i = 0; i < 1000; i++) fs.writeFileSync(path.join(root, `src/d${i % 50}/s${i % SRC_DIRS}/f.ts`), String(i));
}, Array.from({ length: Math.min(1000, SRC_DIRS) }, (_, i) => `src/d${i % 50}/s${i}/f.ts`)));
S.push(await scenario('rename dir with files, then write inside new name', async () => {
  await fsp.rename(path.join(root, 'src/d3'), path.join(root, 'src/d3-moved'));
  await fsp.writeFile(path.join(root, 'src/d3-moved/s3/f.ts'), 'after-move');
}, ['src/d3-moved/s3/f.ts']));
S.push(await scenario('rm -rf dir', () => fsp.rm(path.join(root, 'src/d4'), { recursive: true }), ['src/d4']));
S.push(await scenario('write in ignored node_modules (expect 0)', () => fsp.writeFile(path.join(root, 'node_modules/p1/m1/index.js'), 'y')));
S.push(await scenario('write in nested worktree (expect 0)', () => fsp.writeFile(path.join(root, '.ai/worktrees/wt1/w1/a.ts'), 'y')));
S.push(await scenario('write in .git (expect 0)', () => fsp.writeFile(path.join(root, '.git/objects/x'), 'y')));

await stop();
fs.rmSync(root, { recursive: true, force: true });
console.log(JSON.stringify(out, null, 1));
process.exit(0);
