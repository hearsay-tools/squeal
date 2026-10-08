// Task 001-143 evidence, not product code. Latency of the recorder's write,
// one `appendFileSync` of a ~300-byte line, <n> times into a fresh file under
// <dir>, against the same line through one held descriptor (`writeSync`).
// Prints p50, p90, p99, max and the total in ms for each.
// Usage: node append.mjs <dir> <n>
import { appendFileSync, closeSync, mkdtempSync, openSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";
const [dir, n = "200"] = process.argv.slice(2);
const at = mkdtempSync(join(dir, "squeal143-append-"));
const line = `${JSON.stringify({ t: "/x/packages/cezar/src/artifacts/cli.test.ts", f: ["/x/packages/cezar/src/a.ts", "/x/packages/cezar/src/b.ts", "/x/packages/cezar/src/c/d/e.ts"] })}\n`.repeat(2);
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2);
  return `p50 ${q(0.5)} p90 ${q(0.9)} p99 ${q(0.99)} max ${s.at(-1).toFixed(2)} total ${s.reduce((a, b) => a + b, 0).toFixed(0)}`;
};
const time = (f) => { const t = performance.now(); f(); return performance.now() - t; };
const appends = [], writes = [];
const fd = openSync(join(at, "held.ndjson"), "a");
for (let i = 0; i < Number(n); i++) {
  appends.push(time(() => appendFileSync(join(at, "append.ndjson"), line)));
  writes.push(time(() => writeSync(fd, line)));
}
closeSync(fd);
rmSync(at, { recursive: true, force: true });
console.log(`appendFileSync ${stats(appends)}\nwriteSync      ${stats(writes)}`);
