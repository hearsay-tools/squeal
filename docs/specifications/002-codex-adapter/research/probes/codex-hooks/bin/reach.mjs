// Throwaway Q7 probe. Run as a hook (stdin = event JSON) or from the agent's
// shell tool. Usage: node reach.mjs <label> <repo> <sockA> <sockB>
// Reads <repo>/.git/squeal/store.sqlite, pings two unix sockets, spawns a
// detached child (own session) and a same-group child, and appends one JSON
// line to $PROBE_LOG. Prints nothing on stdout when run as a hook.
import { DatabaseSync } from 'node:sqlite';
import { connect } from 'node:net';
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const [label, repo, sockA, sockB] = process.argv.slice(2);
const log = process.env.PROBE_LOG ?? '/tmp/cxh/reach.log';
const res = { label, t_ms: Date.now(), pid: process.pid, pgid: null };
try {
  const db = new DatabaseSync(`${repo}/.git/squeal/store.sqlite`, { readOnly: true });
  res.sqlite = db.prepare('select v from meta where k = ?').get('probe')?.v ?? 'no-row';
  db.close();
} catch (e) { res.sqlite = `error: ${e.message}`; }
const ping = (path) => new Promise((resolve) => {
  const s = connect(path);
  const t = setTimeout(() => { s.destroy(); resolve('timeout'); }, 500);
  s.on('connect', () => s.write(`ping ${label}\n`));
  s.on('data', (d) => { clearTimeout(t); s.end(); resolve(String(d).trim()); });
  s.on('error', (e) => { clearTimeout(t); resolve(`error: ${e.code}`); });
});
res.sockA = await ping(sockA);
res.sockB = await ping(sockB);
// Detached: new session, survives the parent's process group being killed.
const det = spawn('sleep', ['311'], { detached: true, stdio: 'ignore' });
det.unref();
// Same group: what a plain `cmd &` from a hook script would be.
const same = spawn('sleep', ['312'], { stdio: 'ignore' });
same.unref();
res.detachedPid = det.pid;
res.sameGroupPid = same.pid;
res.env = Object.fromEntries(['XDG_RUNTIME_DIR', 'TMPDIR', 'HOME', 'CODEX_THREAD_ID', 'CODEX_SESSION_ID',
  'CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED', 'PLUGIN_ROOT', 'CLAUDE_PROJECT_DIR']
  .map((k) => [k, process.env[k] ?? null]));
res.envCount = Object.keys(process.env).length;
appendFileSync(log, JSON.stringify(res) + '\n');
process.exit(0);
