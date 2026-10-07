// Throwaway Q3b: trust one plugin's hooks through Codex's own app-server API, the same
// config/batchWrite edit Codex makes for workspace plugins (app-server/src/effective_plugin_change.rs).
// hooks/list -> config/batchWrite { keyPath: hooks.state."<key>".trusted_hash = currentHash } -> hooks/list.
// Usage: node as-trust.mjs <cwd> <pluginId>
import { spawn } from 'node:child_process';
const [cwd, pluginId] = process.argv.slice(2);
const child = spawn('codex', ['app-server'], { cwd, stdio: ['pipe', 'pipe', 'inherit'] });
let id = 1, buf = ''; const pending = new Map();
child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1);
  if (!l.trim()) continue; const m = JSON.parse(l); if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } });
const send = (method, params) => new Promise((r) => { const m = { id: id++, method, params }; pending.set(m.id, r); child.stdin.write(JSON.stringify(m) + '\n'); });
const mine = async () => (await send('hooks/list', { cwds: [cwd] })).result.data[0].hooks.filter((h) => h.pluginId === pluginId);
await send('initialize', { clientInfo: { name: 'squeal-probe', title: null, version: '0' } });
child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
const before = await mine();
console.log('before:', before.map((h) => `${h.eventName}=${h.trustStatus}`).join(' '));
const edits = before.filter((h) => h.trustStatus !== 'trusted')
  .map((h) => ({ keyPath: `hooks.state."${h.key}".trusted_hash`, value: h.currentHash, mergeStrategy: 'replace' }));
const w = await send('config/batchWrite', { edits, reloadUserConfig: true });
console.log('batchWrite:', JSON.stringify(w.result ?? w.error).replace(process.env.CODEX_HOME, '$CODEX_HOME'));
console.log('after: ', (await mine()).map((h) => `${h.eventName}=${h.trustStatus}`).join(' '));
child.kill('SIGTERM'); setTimeout(() => process.exit(0), 300);
