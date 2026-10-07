// Throwaway probe: drive `codex app-server` over stdio the way Cezar does (initialize with
// experimentalApi, thread/start, turn/start), then try every idle-delivery channel:
// thread/inject_items, `codex queue` from another process, an async hook finishing while idle,
// and turn/steer mid-turn. Usage: node appserver-probe.mjs <repo> <log>
import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const [repo, log] = process.argv.slice(2);
writeFileSync(log, '');
const t0 = Date.now();
const rec = (dir, m) => appendFileSync(log, JSON.stringify({ ms: Date.now() - t0, dir, m }) + '\n');
const env = { ...process.env };
for (const k of Object.keys(env)) if (/^CEZ_/.test(k)) delete env[k];
const child = spawn('codex', [
  '-c', `projects."${repo}".trust_level="trusted"`,
  '-c', 'plugins."superpowers@apptension-dev".enabled=false',
  '-c', 'plugins."apptension-sdlc@apptension-dev".enabled=false',
  '-c', 'plugins."apptension-review@apptension-dev".enabled=false',
  '--dangerously-bypass-hook-trust', 'app-server'], { cwd: repo, env, stdio: ['pipe', 'pipe', 'pipe'] });
child.stderr.on('data', (d) => rec('stderr', String(d).slice(0, 2000)));
let id = 1; const pending = new Map(); const waiters = [];
const send = (method, params) => new Promise((res, rej) => {
  const m = { id: id++, method, params }; pending.set(m.id, { res, rej }); rec('out', m);
  child.stdin.write(JSON.stringify(m) + '\n');
});
createInterface({ input: child.stdout }).on('line', (line) => {
  const m = JSON.parse(line);
  if (m.id !== undefined && pending.has(m.id) && !m.method) {
    const p = pending.get(m.id); pending.delete(m.id); rec('in', m);
    return m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
  }
  if (!/Delta$|delta$|tokenUsage|rateLimits/.test(m.method ?? '')) rec('in', m);
  for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
});
const waitFor = (pred, ms) => new Promise((res) => {
  const w = { pred, res }; waiters.push(w);
  setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); res(null); } }, ms);
});
const mark = (s) => { rec('mark', s); console.log(`${Date.now() - t0}ms ${s}`); };
const turnDone = () => waitFor((m) => m.method === 'turn/completed', 180000);
const text = (t) => [{ type: 'text', text: t, text_elements: [] }];

await send('initialize', { clientInfo: { name: 'squeal-probe', title: 'probe', version: '0' }, capabilities: { experimentalApi: true } });
child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
const th = await send('thread/start', { cwd: repo, sandbox: 'danger-full-access',
  config: { bypass_hook_trust: true, projects: { [repo]: { trust_level: 'trusted' } } } });
const threadId = th.thread.id; mark(`thread ${threadId}`);

// 1. A plain turn with one shell call (also fires the async PostToolUse hook, 8 s late).
await send('turn/start', { threadId, input: text("Run this shell command and report its output verbatim: env | grep -E '^CODEX_(SESSION|THREAD)_ID'") });
await turnDone(); mark('turn 1 completed; idle');

// 2. Idle: inject a developer item without a turn; watch for any turn for 15 s (async hook lands meanwhile).
await send('thread/inject_items', { threadId, items: [{ type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'Squeal: tests/add.test.js PASS -> FAIL at revision 3 (expected 5, received 6).' }] }] });
mark('inject_items sent');
const spont = await waitFor((m) => m.method === 'turn/started', 15000);
mark(`turn started on its own while idle (inject + async hook): ${spont ? 'YES' : 'no'}`);

// 3. Idle: queue a message from another process with `codex queue`.
const qStart = Date.now();
const out = execFileSync('codex', ['queue', '--thread', threadId, '--message',
  'Reply in one line: QUEUED-OK, then the name of any test file reported to you as failing in this conversation, or NONE, then any probe nonce (ASYNC-...) you were given, or NONE.'],
  { env, encoding: 'utf8' });
mark(`codex queue returned after ${Date.now() - qStart} ms: ${out.trim()}`);
const qTurn = await waitFor((m) => m.method === 'turn/started', 40000);
mark(`queued turn started: ${qTurn ? `${Date.now() - qStart} ms after codex queue` : 'NO within 40 s'}`);
if (qTurn) { await turnDone(); mark('queued turn completed'); }

// 4. Mid-turn: start a slow turn and steer it.
const st = await send('turn/start', { threadId, input: text('Run the shell command `sleep 6; echo slept`, then reply with one line: the output, and any note you received while the command ran.') });
await waitFor((m) => m.method === 'item/started' && m.params?.item?.type === 'commandExecution', 60000);
await send('turn/steer', { threadId, expectedTurnId: st.turn.id, input: text('Note: steer nonce STEER-9020.') });
mark('turn/steer accepted');
await turnDone(); mark('turn 4 completed');

// 5. Read the stored items of the thread and end the process (SessionEnd should fire).
await send('thread/turns/list', { threadId }).catch((e) => mark(`turns/list failed ${e.message}`));
child.stdin.end();
await new Promise((r) => child.on('exit', r));
mark('app-server exited');
