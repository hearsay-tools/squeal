// Throwaway Q2 app-server client, Cezar-shaped: spawn `codex app-server` in <procCwd>,
// initialize with experimentalApi, thread/start { cwd: <threadCwd>, ...startJson }, one turn,
// then a second turn/start with { cwd: <turn2Cwd> } (the per-turn cwd override), then stdin EOF.
// Usage: node as-cwd.mjs <procCwd> <threadCwd> <turn2Cwd> <prompt> [startJson]
// Every message is logged to $AS_LOG with a ns timestamp.
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
const [procCwd, threadCwd, turn2Cwd, prompt, startJson] = process.argv.slice(2);
const log = process.env.AS_LOG ?? '/tmp/w0c/logs/as-cwd.log';
const child = spawn('codex', ['app-server'], { cwd: procCwd, stdio: ['pipe', 'pipe', 'inherit'] });
let id = 1, buf = '', threadId, waiter;
const pending = new Map();
const rec = (dir, msg) => appendFileSync(log, JSON.stringify({ t_ns: process.hrtime.bigint().toString(), dir, msg }) + '\n');
child.stdout.on('data', (d) => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
    const msg = JSON.parse(line); rec('in', msg);
    if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method === 'turn/completed' && msg.params?.threadId === threadId) waiter?.(msg);
  }
});
const send = (method, params) => new Promise((res) => { const m = { id: id++, method, params }; pending.set(m.id, res); rec('out', m); child.stdin.write(JSON.stringify(m) + '\n'); });
const turn = async (extra) => {
  const done = new Promise((r) => { waiter = r; setTimeout(() => r('timeout'), 180000); });
  const s = await send('turn/start', { threadId, input: [{ type: 'text', text: prompt }], ...extra });
  if (s.error) throw new Error(JSON.stringify(s.error));
  const end = await done; console.log('turn', JSON.stringify(extra), JSON.stringify(end?.params?.turn?.status ?? end));
};
await send('initialize', { clientInfo: { name: 'squeal-probe', title: null, version: '0' }, capabilities: { experimentalApi: true } });
child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
const t = await send('thread/start', { cwd: threadCwd, ...(startJson ? JSON.parse(startJson) : {}) });
if (t.error) { console.error(JSON.stringify(t.error)); process.exit(1); }
threadId = t.result.thread.id; console.log('thread', threadId);
await turn({});
await turn({ cwd: turn2Cwd });
child.stdin.end();
child.on('exit', (c) => { console.log('app-server exit', c); process.exit(0); });
setTimeout(() => { child.kill('SIGTERM'); }, 15000);
