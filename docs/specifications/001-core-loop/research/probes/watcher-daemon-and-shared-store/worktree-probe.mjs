// THROWAWAY PROBE. Not product code. See README.md.
// (a) What does each backend report when a nested worktree is added under the watched root?
// (b) What does each backend report when the watched worktree itself is removed with `git worktree remove`?
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const backend = process.argv[2];
const T = path.resolve('tmp', `wt-${backend}-${process.pid}`);
const sh = (c, cwd = T) => execSync(c, { cwd, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 'p', GIT_AUTHOR_EMAIL: 'p@p', GIT_COMMITTER_NAME: 'p', GIT_COMMITTER_EMAIL: 'p@p' } });
fs.rmSync(T, { recursive: true, force: true }); fs.mkdirSync(T, { recursive: true });
sh('git init -q -b main repo');
const repo = path.join(T, 'repo');
for (let i = 0; i < 300; i++) { fs.mkdirSync(path.join(repo, `src/m${i % 30}`), { recursive: true }); fs.writeFileSync(path.join(repo, `src/m${i % 30}/f${i}.ts`), String(i)); }
sh('git add -A && git commit -qm init', repo);
sh('git worktree add -q -b other ../wt-removable', repo);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function watch(root, onEv, ignoreGit) {
  if (backend === 'parcel') {
    const w = await import('@parcel/watcher');
    const s = await w.subscribe(root, (err, evs) => { if (err) onEv('ERROR', String(err)); evs.forEach((e) => onEv(e.type, e.path)); }, { ignore: ignoreGit ? ['.git'] : [] });
    return () => s.unsubscribe();
  }
  if (backend === 'chokidar') {
    const { watch: cw } = await import('chokidar');
    const w = cw(root, { ignoreInitial: true, ignored: (p) => ignoreGit && /[\\/]\.git([\\/]|$)/.test(p) });
    w.on('all', onEv); w.on('error', (e) => onEv('ERROR', String(e)));
    await new Promise((r) => w.on('ready', r));
    return () => w.close();
  }
  const w = fs.watch(root, { recursive: true }, (t, f) => onEv(t, path.join(root, f ?? '')));
  w.on('error', (e) => onEv('ERROR', String(e.code ?? e)));
  return () => w.close();
}

// (a) nested worktree added under the root
let evs = [];
let stop = await watch(repo, (t, p) => evs.push([t, path.relative(repo, p)]), true);
await sleep(300);
sh('git worktree add -q -b nested .ai/worktrees/wt2', repo);
await sleep(1500);
await stop();
const nested = evs.filter(([, p]) => p.startsWith('.ai/worktrees/wt2'));
const a = { nestedWorktreeEvents: nested.length, totalEvents: evs.length, gitFileSeen: nested.some(([, p]) => p === '.ai/worktrees/wt2/.git') };

// (b) the watched worktree is removed
evs = [];
const wtRoot = path.join(T, 'wt-removable');
stop = await watch(wtRoot, (t, p) => evs.push([t, path.relative(wtRoot, p) || '<root>']), true);
await sleep(300);
sh('git worktree remove --force ../wt-removable', repo);
await sleep(1500);
const b = { rootGoneEvents: evs.filter(([, p]) => p === '<root>' || p === '').map(([t]) => t), errors: evs.filter(([t]) => t === 'ERROR').map(([, p]) => p), total: evs.length, existsAfter: fs.existsSync(wtRoot) };
try { await stop(); } catch (e) { b.stopError = String(e); }
fs.rmSync(T, { recursive: true, force: true });
console.log(JSON.stringify({ backend, a, b }));
process.exit(0);
