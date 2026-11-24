// Throwaway (026 agent37-sandboxes). Sustained CPU: 4 worker threads hash for `seconds`
// (default 60) and report MB hashed per 5 s window, plus one-thread speed first.
import { Worker } from "node:worker_threads";
const seconds = Number(process.argv[2] ?? 60);
const code = `
const { createHash } = require("node:crypto"); const { parentPort } = require("node:worker_threads");
const buf = Buffer.alloc(1 << 20, 7); let n = 0; const end = Date.now() + ${seconds * 1000};
let last = Date.now();
while (Date.now() < end) { createHash("sha256").update(buf).digest(); n++;
  if (Date.now() - last >= 5000) { parentPort.postMessage(n); n = 0; last = Date.now(); } }
parentPort.postMessage(n);`;
// one thread, 3 s
{
  const { createHash } = await import("node:crypto");
  const buf = Buffer.alloc(1 << 20, 7); let n = 0; const end = Date.now() + 3000;
  while (Date.now() < end) { createHash("sha256").update(buf).digest(); n++; }
  console.log(JSON.stringify({ check: "one-thread", mbPerS: Math.round(n / 3) }));
}
const windows = [];
await Promise.all([0, 1, 2, 3].map((i) => new Promise((resolve) => {
  const w = new Worker(code, { eval: true });
  let k = 0;
  w.on("message", (n) => { windows[k] = (windows[k] ?? 0) + n; k++; });
  w.on("exit", resolve);
})));
console.log(JSON.stringify({ check: "four-threads", mbPer5sWindows: windows }));
