// Throwaway app-server probe client (copied from ../codex-hooks/bin/as.mjs). Spawns `codex app-server` (extra argv after
// `--` go to it, e.g. -c overrides), speaks newline JSON-RPC, logs every message
// with a ns timestamp to $AS_LOG, and runs one mode:
//   hooks-list <cwd>
//   turn <cwd> <prompt> [threadStartJSON] [interruptAfterMs]
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
const sep = process.argv.indexOf('--');
const mine = sep < 0 ? process.argv.slice(2) : process.argv.slice(2, sep);
const extra = sep < 0 ? [] : process.argv.slice(sep + 1);
const [mode, cwd, prompt, startJson, interruptMs] = mine;
const log = process.env.AS_LOG ?? '/tmp/w0c/logs/as.log';

const ns = () => (BigInt(Date.now()) * 1000000n).toString();
const child = spawn('codex', ['app-server', ...extra], { cwd, stdio: ['pipe', 'pipe', 'inherit'] });
let id = 1; const pending = new Map(); let buf = '';
const rec = (dir, msg) => appendFileSync(log, JSON.stringify({ t_ns: ns(), dir, msg }) + '\n');
child.stdout.on('data', (d) => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
    const msg = JSON.parse(line); rec('in', msg);
    if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) onNote(msg);
  }
});
const send = (method, params) => new Promise((res) => { const m = { id: id++, method, params }; pending.set(m.id, res); rec('out', m); child.stdin.write(JSON.stringify(m) + '\n'); });
const notify = (method, params) => { const m = { method, params }; rec('out', m); child.stdin.write(JSON.stringify(m) + '\n'); };
let done; const finished = new Promise((r) => (done = r));
let threadId, turnId;
function onNote(msg) {
  if (msg.method === 'turn/started') turnId = msg.params?.turn?.id;
  if (msg.method === 'turn/completed' && msg.params?.threadId === threadId) done(msg);
}
const quit = (code) => { child.kill('SIGTERM'); setTimeout(() => process.exit(code), 300); };
await send('initialize', { clientInfo: { name: 'squeal-probe', title: null, version: '0' } });
notify('initialized', {});
if (mode === 'hooks-list') {
  const r = await send('hooks/list', { cwds: [cwd] });
  console.log(JSON.stringify(r.result ?? r.error, null, 1)); quit(0);
} else if (mode === 'turn') {
  const extraStart = startJson ? JSON.parse(startJson) : {};
  const t = await send('thread/start', { cwd, ...extraStart });
  if (t.error) { console.error(JSON.stringify(t.error)); quit(1); }
  threadId = t.result.thread.id; console.log('thread', threadId);
  const s = await send('turn/start', { threadId, input: [{ type: 'text', text: prompt }] });
  if (s.error) { console.error(JSON.stringify(s.error)); quit(1); }
  if (interruptMs) setTimeout(() => { send('turn/interrupt', { threadId, turnId }).then((r) => console.log('interrupt', JSON.stringify(r))); }, Number(interruptMs));
  const end = await Promise.race([finished, new Promise((r) => setTimeout(() => r('timeout'), 240000))]);
  console.log('end', JSON.stringify(end?.params?.turn?.status ?? end));
  quit(0);
}
