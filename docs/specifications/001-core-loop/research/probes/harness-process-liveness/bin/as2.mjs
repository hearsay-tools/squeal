// Throwaway: `codex app-server` (argv after `--`), two threads one turn each in one process,
// then SIGKILL the npm wrapper only and report whether the native server lives on.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
const sep = process.argv.indexOf('--');
const [cwd] = process.argv.slice(2, sep);
const child = spawn('codex', ['app-server', ...process.argv.slice(sep + 1)], { cwd, stdio: ['pipe', 'pipe', 'inherit'] });
let id = 1; const pending = new Map(); let buf = ''; const waiters = [];
child.stdout.on('data', (d) => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method === 'turn/completed') waiters.forEach((w) => w(msg));
  }
});
const send = (method, params) => new Promise((res) => { const m = { id: id++, method, params }; pending.set(m.id, res); child.stdin.write(JSON.stringify(m) + '\n'); });
await send('initialize', { clientInfo: { name: 'hpl-probe', title: null, version: '0' } });
child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
for (const n of [1, 2]) {
  const t = await send('thread/start', { cwd, config: { bypass_hook_trust: true } });
  const threadId = t.result.thread.id;
  const done = new Promise((r) => waiters.push((m) => m.params?.threadId === threadId && r()));
  await send('turn/start', { threadId, input: [{ type: 'text', text: `Run \`echo thread${n}\` in the shell, then reply done.` }] });
  await Promise.race([done, new Promise((r) => setTimeout(r, 180000))]);
  console.log('thread', n, threadId, 'done');
}
const kids = readFileSync(`/proc/${child.pid}/task/${child.pid}/children`, 'utf8').trim().split(/\s+/).map(Number);
console.log('wrapper', child.pid, 'native', kids);
process.kill(child.pid, 'SIGKILL');
await new Promise((r) => setTimeout(r, 3000));
const alive = (p) => { try { process.kill(p, 0); return true; } catch { return false; } };
for (const k of kids) {
  let ppid = '?'; try { ppid = readFileSync(`/proc/${k}/stat`, 'utf8').split(') ')[1].split(' ')[1]; } catch {}
  console.log('after wrapper SIGKILL: native', k, 'alive', alive(k), 'ppid', ppid);
}
child.stdin.end();
await new Promise((r) => setTimeout(r, 3000));
for (const k of kids) console.log('after stdin EOF: native', k, 'alive', alive(k));
process.exit(0);
