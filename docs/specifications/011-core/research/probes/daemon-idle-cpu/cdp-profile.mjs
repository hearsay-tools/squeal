// Throwaway probe (row 011-313). Takes a V8 CPU profile of a Node process
// that THIS session started with --inspect=127.0.0.1:PORT, for SECONDS, and
// writes it to OUT (.cpuprofile). Never point it at a process you did not start.
// Usage: node cdp-profile.mjs PORT SECONDS OUT
import { writeFileSync } from "node:fs";
const [port, seconds, out] = process.argv.slice(2);
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(list[0].webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const wait = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
const call = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await call("Profiler.enable");
await call("Profiler.setSamplingInterval", { interval: 1000 });
await call("Profiler.start");
await new Promise((r) => setTimeout(r, Number(seconds) * 1000));
const res = await call("Profiler.stop");
writeFileSync(out, JSON.stringify(res.result.profile));
await call("Profiler.disable");
ws.close();
console.log(JSON.stringify({ out, samples: res.result.profile.samples.length }));
