// Throwaway probe for row 011-133 (gh-75, gh-77). Uses committed release bundles; no build.
// Usage: node three-versions.mjs <mislabeled|control> <source clone> <scratch dir> [seconds]
// Three versions in one worktree: a Codex SessionStart of 0.1.272 whose kept copy holds 0.1.271
// (the old daemon), Codex hooks of 0.1.273 (PLUGIN_ROOT in the cache, PLUGIN_DATA beside it),
// and a `squeal start` from Claude Code's 0.1.272 CLI. `mislabeled` also keeps a copy named
// 0.1.273 that holds 0.1.272, as this host's Codex plugin data did on 2026-10-23; `control` has
// no 0.1.273 copy. One node:test file runs a real tier; a writer holds the store at set times.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cpus, loadavg } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const [mode = 'mislabeled', source, scratchBase, seconds = '180'] = process.argv.slice(2);
const MAX_LOAD = 16;
const log = (data) => console.log(JSON.stringify({ at: new Date().toISOString(), ...data }));
const load = loadavg()[0];
log({ event: 'host', load, cpus: cpus().length, node: process.version, mode });
if (!['mislabeled', 'control'].includes(mode) || !source || !scratchBase) throw new Error('usage');
if (load >= MAX_LOAD) { log({ event: 'skipped', reason: `one-minute load ${load} is not below ${MAX_LOAD}` }); process.exit(0); }

const scratch = join(scratchBase, `${mode}-${randomUUID().slice(0, 8)}`);
const root = join(scratch, 'repo');
const home = join(scratch, 'home');
const codexHome = join(home, '.codex');
const env = {
  PATH: process.env.PATH, HOME: home, CODEX_HOME: codexHome,
  XDG_RUNTIME_DIR: join(scratch, 'run'), XDG_CONFIG_HOME: join(scratch, 'config'), TMPDIR: join(scratch, 'tmp'),
};
for (const dir of [root, home, env.XDG_RUNTIME_DIR, env.XDG_CONFIG_HOME, env.TMPDIR]) mkdirSync(dir, { recursive: true, mode: 0o700 });

function run(bin, args, options = {}) {
  const r = spawnSync(bin, args, { cwd: root, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options });
  if (r.status !== 0) throw new Error(`${bin} ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}
function extract(version, path, dest) {
  const archive = spawnSync('git', ['archive', `squeal--v${version}`, path], { cwd: source, maxBuffer: 256 * 1024 * 1024 });
  if (archive.status !== 0) throw new Error(archive.stderr.toString());
  const tmp = join(scratch, 'extract', `${version}-${randomUUID().slice(0, 6)}`);
  mkdirSync(tmp, { recursive: true });
  spawnSync('tar', ['-x', '-C', tmp], { input: archive.stdout });
  mkdirSync(join(dest, '..'), { recursive: true });
  cpSync(join(tmp, path), dest, { recursive: true });
}

// Installed assets, as Codex and Claude Code lay them out.
const cache273 = join(codexHome, 'plugins/cache/hearsay/squeal/0.1.273');
const cache272 = join(codexHome, 'plugins/cache/hearsay/squeal/0.1.272');
const data = join(codexHome, 'plugins/data/squeal-hearsay');
const claude272 = join(home, '.claude/plugins/cache/hearsay/squeal/0.1.272');
extract('0.1.273', 'plugins/codex', cache273);
extract('0.1.272', 'plugins/codex', cache272);
extract('0.1.272', 'plugins/claude-code', claude272);
for (const part of ['dist', 'skills']) extract('0.1.271', `plugins/codex/${part}`, join(data, 'versions/0.1.272', part));
if (mode === 'mislabeled') for (const part of ['dist', 'skills']) extract('0.1.272', `plugins/codex/${part}`, join(data, 'versions/0.1.273', part));
const label = (dir) => (readFileSync(join(dir, 'dist/cli/squeal.mjs'), 'utf8').match(/"0\.1\.\d+"/) ?? ['?'])[0];
for (const dir of readdirSync(join(data, 'versions'))) log({ event: 'kept-copy', name: dir, code: label(join(data, 'versions', dir)) });

// The fixture: one node:test project, one test file of about 4 s (a real tier), one fast file.
writeFileSync(join(root, 'squeal.config.json'), JSON.stringify({ nodeTest: [{ name: 'node', include: ['test/**/*.test.mjs'] }], observe: { runtimeInputs: false } }));
writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
writeFileSync(join(root, 'README.md'), 'Probe fixture.\n');
mkdirSync(join(root, 'test'));
writeFileSync(join(root, 'test/slow.test.mjs'), "import test from 'node:test';\ntest('slow', async () => { await new Promise((r) => setTimeout(r, 4000)); });\n");
writeFileSync(join(root, 'test/fast.test.mjs'), "import test from 'node:test';\ntest('fast', () => {});\n");
run('git', ['init', '-q']); run('git', ['add', '.']);
run('git', ['-c', 'user.name=probe', '-c', 'user.email=probe@example.invalid', 'commit', '-qm', 'fixture']);
const dbfile = join(root, '.git/squeal/store.sqlite');

// Records: daemon processes from /proc (argv names the executable and the lock wait), the store's
// daemon record, claim and exit notes. Only processes whose argv names this fixture's root.
const seen = new Map();
function scan() {
  const now = new Set();
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    let args;
    try { args = readFileSync(`/proc/${entry}/cmdline`, 'utf8').split('\0'); } catch { continue; }
    if (!args.includes(root) || !args.includes('daemon')) continue;
    const pid = Number(entry);
    now.add(pid);
    if (!seen.has(pid)) {
      let ppid = null;
      try { ppid = Number(readFileSync(`/proc/${entry}/stat`, 'utf8').split(') ')[1].split(' ')[1]); } catch {}
      let parent = null;
      try { parent = readFileSync(`/proc/${ppid}/cmdline`, 'utf8').split('\0').filter(Boolean).slice(-2).join(' ').replace(scratch, '<scratch>'); } catch {}
      const cli = args.find((a) => a.endsWith('squeal.mjs')) ?? '?';
      seen.set(pid, { cli });
      log({ event: 'daemon-process', pid, cli: cli.replace(scratch, '<scratch>'), code: existsSync(cli) ? (readFileSync(cli, 'utf8').match(/"0\.1\.\d+"/) ?? ['?'])[0] : '?', awaitLock: args.includes('--await-lock'), ppid, parent });
    }
  }
  for (const [pid, d] of seen) if (!now.has(pid) && !d.gone) { d.gone = true; log({ event: 'daemon-gone', pid }); }
}
let lastState = '';
const notesSeen = new Set();
function snapshot() {
  if (!existsSync(dbfile)) return;
  let db;
  try {
    db = new DatabaseSync(dbfile, { readOnly: true });
    db.exec('PRAGMA busy_timeout=50');
    const w = db.prepare('SELECT id, daemon_version, daemon_started_at, daemon_heartbeat_at, daemon_socket IS NOT NULL AS live FROM worktrees').get();
    if (!w) return;
    const claim = db.prepare('SELECT value FROM meta WHERE key = ?').get(`daemon-handoff:${w.id}`)?.value ?? null;
    const state = JSON.stringify({ version: w.daemon_version, started: w.daemon_started_at, live: w.live, claim });
    if (state !== lastState) { lastState = state; log({ event: 'record', version: w.daemon_version, started: w.daemon_started_at && new Date(w.daemon_started_at).toISOString(), live: w.live, claim: claim && JSON.parse(claim) }); }
    const notes = JSON.parse(db.prepare('SELECT value FROM meta WHERE key = ?').get(`notes.${w.id}`)?.value ?? '[]');
    for (const n of notes) {
      const key = `${n.at}:${n.text}`;
      if (notesSeen.has(key)) continue;
      notesSeen.add(key);
      log({ event: 'note', noteAt: new Date(n.at).toISOString(), exitOf: n.exitOf ?? null, text: String(n.text).slice(0, 220) });
    }
  } catch (e) { if (!String(e).includes('busy') && !String(e).includes('locked')) log({ event: 'snapshot-error', error: String(e) }); }
  finally { db?.close(); }
}

const session = randomUUID();
const transcript = join(scratch, `rollout-${session}.jsonl`);
writeFileSync(transcript, '');
const t0 = Date.now();
const since = () => Date.now() - t0;
function child(label, bin, args, extraEnv, stdin, timeoutMs, onOut = () => {}) {
  const start = Date.now();
  return new Promise((resolve) => {
    const c = spawn(bin, args, { cwd: root, env: { ...env, ...extraEnv }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    c.stdout.on('data', (d) => { stdout += d; onOut(stdout); }); c.stderr.on('data', (d) => (stderr += d));
    c.stdin.end(stdin ?? '');
    const timer = setTimeout(() => c.kill('SIGKILL'), timeoutMs);
    c.on('close', (code, signal) => { clearTimeout(timer); resolve({ label, ms: Date.now() - start, code, signal, stdout, stderr }); });
  });
}
const headline = (text) => (text.match(/SQUEAL · [^\n"\\]*/g) ?? []).join(' / ') + ' ' + ((text.match(/handing over from \S+ to \S+ since \S+/) ?? [''])[0]);
async function hook(version, name, event, extra = {}) {
  const pluginRoot = version === '0.1.273' ? cache273 : cache272;
  const payload = { session_id: session, transcript_path: transcript, cwd: root, hook_event_name: event, turn_id: randomUUID(), ...extra };
  const r = await child(`${version} ${name}`, process.execPath, ['--disable-warning=ExperimentalWarning', join(pluginRoot, 'dist', `${name}.mjs`)], { PLUGIN_ROOT: pluginRoot, PLUGIN_DATA: data }, JSON.stringify(payload), 10_000);
  let decision = null;
  try { decision = JSON.parse(r.stdout).decision ?? null; } catch {}
  log({ event: 'hook', t: since(), version, name, ms: r.ms, code: r.code, signal: r.signal, decision, headline: headline(r.stdout), stderr: r.stderr.slice(0, 200) });
  return r;
}
const tool = () => ({ tool_name: 'Bash', tool_input: { command: 'cat README.md' }, tool_use_id: randomUUID() });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// The writer: holds a write transaction on the store for `ms`, in a process of its own.
function holdStore(ms, onHeld = () => {}) {
  const code = `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(${JSON.stringify(dbfile)});db.exec('PRAGMA busy_timeout=10000');db.exec('BEGIN IMMEDIATE');console.log('held '+Date.now());const end=Date.now()+${ms};while(Date.now()<end){}db.exec('COMMIT');console.log('freed '+Date.now());`;
  return child('writer', process.execPath, ['--disable-warning=ExperimentalWarning', '-e', code], {}, '', ms + 20_000, (out) => { if (out.includes('held')) onHeld(); }).then((r) => { log({ event: 'writer', t: since(), ms: r.ms, held: ms, out: r.stdout.trim().replace(/\n/g, ' '), code: r.code }); return r; });
}

const sampler = setInterval(() => { scan(); snapshot(); }, 200);
const duration = Number(seconds) * 1000;
const background = [];
try {
  // 1. A Codex session started on 0.1.272: its SessionStart spawns from its kept copy.
  await hook('0.1.272', 'session-start', 'SessionStart', { source: 'startup' });
  for (let i = 0; i < 150 && !lastState.includes('"live":1'); i++) await wait(200);
  // 2. Codex installs 0.1.273, which deletes the 0.1.272 cache directory.
  rmSync(cache272, { recursive: true, force: true });
  log({ event: 'codex-install', t: since(), removed: '0.1.272 cache' });
  let nextStop = 30_000, waited = false, edited = false, started = false, held = 0;
  const holds = [100_000, 115_000, 130_000, 145_000];
  while (since() < duration) {
    await hook('0.1.273', 'pre-tool-use', 'PreToolUse', tool());
    await hook('0.1.273', 'post-tool-use', 'PostToolUse', { ...tool(), tool_response: 'Probe fixture.' });
    if (!waited && since() >= 40_000) {
      waited = true;
      let held;
      const holding = new Promise((r) => (held = r));
      const writer = holdStore(3_000, () => held());
      await holding;
      log({ event: 'writer-holds', t: since() });
      const r = await child('status-wait', process.execPath, ['--disable-warning=ExperimentalWarning', join(cache273, 'dist/cli/squeal.mjs'), 'status', '--wait', '60000', 'test/fast.test.mjs'], {}, '', 90_000);
      log({ event: 'status-wait', t: since(), ms: r.ms, code: r.code, out: (r.stdout + r.stderr).split('\n').slice(0, 3).join(' | ').slice(0, 400) });
      await writer;
    }
    if (!edited && since() >= 70_000) { edited = true; writeFileSync(join(root, 'test/fast.test.mjs'), "import test from 'node:test';\ntest('fast', () => {});\ntest('fast 2', () => {});\n"); log({ event: 'edit', t: since() }); }
    if (!started && since() >= 90_000) {
      started = true;
      background.push(child('start', process.execPath, ['--disable-warning=ExperimentalWarning', join(claude272, 'dist/cli/squeal.mjs'), 'start'], {}, '', 150_000).then((r) => log({ event: 'start', t: since(), ms: r.ms, code: r.code, out: (r.stdout + r.stderr).split('\n').slice(0, 4).join(' | ').slice(0, 500) })));
    }
    if (held < holds.length && since() >= holds[held]) { held++; background.push(holdStore(2_000)); }
    await wait(3_000);
    if (since() >= nextStop) { nextStop += 20_000; await hook('0.1.273', 'stop', 'Stop', { stop_hook_active: false, last_assistant_message: 'done' }); }
  }
  await Promise.all(background);
  const status = await child('status', process.execPath, ['--disable-warning=ExperimentalWarning', join(cache273, 'dist/cli/squeal.mjs'), 'status'], {}, '', 30_000);
  log({ event: 'final-status', code: status.code, out: (status.stdout + status.stderr).split('\n').slice(0, 4).join(' | ').slice(0, 500) });
  scan(); snapshot();
} finally {
  clearInterval(sampler);
  // Stop only processes whose argv names this fixture's root.
  const owned = [];
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try { if (readFileSync(`/proc/${entry}/cmdline`, 'utf8').split('\0').some((a) => a.includes(scratch))) owned.push(Number(entry)); } catch {}
  }
  for (const pid of owned) { try { process.kill(pid, 'SIGTERM'); } catch {} }
  await wait(3000);
  const left = owned.filter((pid) => { try { process.kill(pid, 0); return true; } catch { return false; } });
  for (const pid of left) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  log({ event: 'cleanup', owned, forced: left, scratch: scratch.replace(scratchBase, '<scratch>') });
}
