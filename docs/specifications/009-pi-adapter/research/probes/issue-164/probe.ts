// Throwaway research probe. Run from the repository root with pnpm exec tsx.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = process.cwd();
const version = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version;
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
function gate() {
  const sample = { at: new Date().toISOString(), oneMinute: loadavg()[0], cpus: cpus().length };
  console.log(JSON.stringify({ load: sample }));
  if (sample.oneMinute > sample.cpus) throw new Error('SKIP: host load exceeds CPU count');
}
console.log(JSON.stringify({ version, commit, node: process.version }));
gate();
const scratch = mkdtempSync('/tmp/squeal-issue-164-');
const home = join(scratch, 'home');
const root = join(scratch, 'project');
const common = join(root, '.git');
mkdirSync(home);
mkdirSync(common, { recursive: true });
writeFileSync(join(common, 'HEAD'), 'ref: refs/heads/main\n');
const { openStore, isStoreOpenFailure } = await import(pathToFileURL(join(repo, 'src/core/store/open.ts')).href);
const { worktreeIdFor } = await import(pathToFileURL(join(repo, 'src/core/fs/git-layout.ts')).href);
const id = worktreeIdFor(root);
const env = { PATH: process.env.PATH!, HOME: home, TMPDIR: scratch, XDG_STATE_HOME: join(home, 'state'), PI_SESSION_ID: 'issue-164-synthetic' };
const normalize = (s: string) => s.replaceAll(scratch, '<scratch>').replaceAll(repo, '<repo>');
function call(label: string, args = ['status'], session: string | undefined = env.PI_SESSION_ID) {
  gate();
  const childEnv: Record<string, string> = { ...env };
  if (session === undefined) delete childEnv.PI_SESSION_ID;
  else childEnv.PI_SESSION_ID = session;
  const argv = ['--disable-warning=ExperimentalWarning', join(repo, 'plugins/pi/dist/cli/squeal.mjs'), ...args];
  const r = spawnSync(process.execPath, argv, { cwd: root, env: childEnv, encoding: 'utf8', timeout: 10000 });
  if (r.error) throw r.error;
  console.log(JSON.stringify({ label, command: [process.execPath, ...argv].map(normalize), cwd: '<scratch>/project', session, code: r.status, stdout: normalize(r.stdout), stderr: normalize(r.stderr) }));
  return { ...r, notice: r.stdout.split('\n').find((line) => line.startsWith('Pi:')) };
}
function store() {
  const s = openStore(common);
  if (isStoreOpenFailure(s)) throw new Error(JSON.stringify(s));
  return s;
}
try {
  const noStore1 = call('no store 1');
  const noStore2 = call('no store 2');
  assert.equal(noStore1.status, 1);
  assert.ok(noStore1.notice);
  assert.equal(noStore1.notice, noStore2.notice);
  const s = store();
  s.revisions.append({ worktreeId: id, createdAt: Date.now(), head: null, dirty: false, trigger: 'watch', changes: [] });
  s.close();
  const first = call('store, absent consumer 1');
  const second = call('store, absent consumer 2');
  const third = call('store, absent consumer 3');
  assert.equal(first.status, 0);
  assert.ok(first.notice);
  assert.equal(first.notice, second.notice);
  assert.equal(first.notice, third.notice);
  const json = call('JSON control', ['status', '--json']);
  assert.equal(json.notice, undefined);
  assert.equal(JSON.parse(json.stdout).available, true);
  assert.equal(call('empty session control', ['status'], '').notice, undefined);
  const s2 = store();
  assert.equal(s2.consumers.list(id).length, 0, 'status must not register a consumer');
  s2.consumers.register({ worktreeId: id, sessionId: env.PI_SESSION_ID, agentId: 'main' }, 1);
  s2.close();
  assert.equal(call('registered consumer control').notice, undefined);
  assert.ok(call('different session control', ['status'], 'issue-164-other').notice);
  console.log(JSON.stringify({ verdict: 'PASS: repeated notice reproduced; JSON, empty-session, registered-session and different-session controls passed; status did not register a consumer' }));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
