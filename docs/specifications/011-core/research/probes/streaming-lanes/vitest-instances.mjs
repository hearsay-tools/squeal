// THROWAWAY probe (011-core/research/streaming-lanes.md). What one Vitest instance allows and what
// a second costs, on a scratch fixture with Vitest installed (vitest@5.0.3). Run from anywhere:
//   node vitest-instances.mjs <fixture-dir> <out.json>
// The fixture gets: test/idle-<s>-<i>.test.ts files sleeping s seconds, a globalSetup that appends
// "<pid> <instance tag> <ms>" to setups.log, vitest.config.ts with maxWorkers 4.
// A: one instance, two runTestSpecifications in one tick, and (A1) the second 300 ms later:
//    does the second wait for the first?
// B: per-file results inside one run: onTestModuleEnd times against the run's end.
// C: two instances: startup time, RSS of this process before and after, globalSetup count, and
//    whether their runs overlap.
// D: two instances alternating: tier 1 on A (three 1 s files and one 6 s), tier 2 (three 2 s
//    files) started on B once only A's straggler runs; wall time against tier 2 after tier 1.
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [dir, out] = process.argv.slice(2);
const require = createRequire(join(dir, "package.json"));
const { createVitest } = await import(pathToFileURL(require.resolve("vitest/node")).href);
const w = (p, body) => {
  mkdirSync(join(dir, p, ".."), { recursive: true });
  writeFileSync(join(dir, p), body);
};
rmSync(join(dir, "test"), { recursive: true, force: true });
const files = [];
const idle = (s, i) => {
  const p = `test/idle-${s}-${i}.test.ts`;
  w(p, `import { test } from "vitest";\ntest("idle ${s} s", async () => { await new Promise((r) => setTimeout(r, ${s * 1000})); });\n`);
  files.push(p);
  return join(dir, p);
};
w("setup.ts", `import { appendFileSync } from "node:fs";\nexport default function () { appendFileSync(${JSON.stringify(join(dir, "setups.log"))}, process.pid + " " + (process.env.TAG ?? "") + " " + Date.now() + "\\n"); }\n`);
w("vitest.config.ts", `export default { test: { include: ["test/**/*.test.ts"], globalSetup: ["./setup.ts"], maxWorkers: 4, watch: false } };\n`);
rmSync(join(dir, "setups.log"), { force: true });
const f = {
  a1: [1, 2, 3].map((i) => idle(1, i)), a6: idle(6, 1),
  b2: [1, 2, 3].map((i) => idle(2, i)),
  s: [idle(1, 9), idle(3, 9), idle(5, 9)],
};
const t0 = Date.now();
const now = () => Date.now() - t0;
const rss = () => Math.round(process.memoryUsage().rss / 2 ** 20);
const events = [];
const reporter = (tag) => ({
  onTestModuleStart: (m) => events.push({ tag, ev: "start", file: m.moduleId.split("/").pop(), at: now() }),
  onTestModuleEnd: (m) => events.push({ tag, ev: "end", file: m.moduleId.split("/").pop(), at: now() }),
  onTestRunEnd: () => events.push({ tag, ev: "run-end", at: now() }),
});
async function instance(tag) {
  const before = rss();
  const started = now();
  process.env.TAG = tag;
  const v = await createVitest("test", { root: dir, watch: false, reporters: [reporter(tag)] }, {}, {});
  return { v, tag, startupMs: now() - started, rssBefore: before, rssAfter: rss() };
}
const specs = (v, paths) => paths.map((p) => v.getRootProject().createSpecification(p));
const result = { vitest: (await import(pathToFileURL(require.resolve("vitest/package.json")).href, { with: { type: "json" } })).default.version };

// A: two calls in one tick on one instance; A1: the second 300 ms later.
const A = await instance("A");
result.instanceA = { startupMs: A.startupMs, rssBeforeMiB: A.rssBefore, rssAfterMiB: A.rssAfter };
const runA = { first: null, second: null };
const p1 = A.v.runTestSpecifications(specs(A.v, f.s)).then(() => (runA.first = now()));
const p2 = A.v.runTestSpecifications(specs(A.v, f.a1)).then(() => (runA.second = now()));
const askedAt = now();
await Promise.all([p1, p2]);
result.A = { askedBothAtMs: askedAt, firstEndMs: runA.first, secondEndMs: runA.second, events: events.splice(0) };
// A1: the second call 300 ms after the first, once the first has set its running promise.
const a1 = { first: null, second: null, askedSecond: null };
const q1 = A.v.runTestSpecifications(specs(A.v, f.s)).then(() => (a1.first = now()));
await new Promise((r) => setTimeout(r, 300));
a1.askedSecond = now();
const q2 = A.v.runTestSpecifications(specs(A.v, f.a1)).then(() => (a1.second = now()));
await Promise.all([q1, q2]);
result.A1 = { ...a1, events: events.splice(0) };
result.rssAfterRunsA = rss();

// C: a second instance beside the first.
const B = await instance("B");
result.instanceB = { startupMs: B.startupMs, rssBeforeMiB: B.rssBefore, rssAfterMiB: B.rssAfter };
const c0 = now();
await Promise.all([A.v.runTestSpecifications(specs(A.v, f.a1)), B.v.runTestSpecifications(specs(B.v, f.b2))]);
result.C = { wallMs: now() - c0, events: events.splice(0), rssAfterBoth: rss() };

// D: alternating against serial.
const d0 = now();
await A.v.runTestSpecifications(specs(A.v, [...f.a1, f.a6]));
await A.v.runTestSpecifications(specs(A.v, f.b2));
const serialMs = now() - d0;
events.splice(0);
const e0 = now();
let tier2 = null;
const tier1 = A.v.runTestSpecifications(specs(A.v, [...f.a1, f.a6]));
await new Promise((resolve) => {
  const timer = setInterval(() => {
    const ended = events.filter((e) => e.tag === "A" && e.ev === "end").length;
    if (ended >= 3) {
      clearInterval(timer);
      resolve();
    }
  }, 20);
});
tier2 = B.v.runTestSpecifications(specs(B.v, f.b2));
await Promise.all([tier1, tier2]);
result.D = { serialMs, alternatingMs: now() - e0, events: events.splice(0) };
await A.v.close();
await B.v.close();
result.setups = readFileSync(join(dir, "setups.log"), "utf8").trim().split("\n");
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ A: { asked: result.A.askedBothAtMs, first: result.A.firstEndMs, second: result.A.secondEndMs }, A1: { first: result.A1.first, askedSecond: result.A1.askedSecond, second: result.A1.second }, startup: [result.instanceA.startupMs, result.instanceB.startupMs], rss: [result.instanceA.rssBeforeMiB, result.instanceA.rssAfterMiB, result.rssAfterRunsA, result.instanceB.rssAfterMiB, result.C.rssAfterBoth], C: result.C.wallMs, D: [result.D.serialMs, result.D.alternatingMs], setups: result.setups.length }));
process.exit(0);
