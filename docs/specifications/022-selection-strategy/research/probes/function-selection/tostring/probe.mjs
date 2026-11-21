// Throwaway (Q3a): can a worker-side wrapper of Function.prototype.toString,
// installed where Squeal's coverage provider runs (with an inspector session
// already open for coverage), tell which project functions had their text
// read, and at what cost? Plain Node, not inside provider.mjs.
//   node probe.mjs
import { Session } from "node:inspector/promises";
import { loadavg } from "node:os";
import vm from "node:vm";
import util from "node:util";
import { Worker } from "node:worker_threads";
const session = new Session();
session.connect();
await session.post("Profiler.enable");
await session.post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });

const cachedBefore = Function.prototype.toString; // a library that kept the original before the wrapper
// ---- the wrapper
const original = Function.prototype.toString;
const seen = [];
globalThis.__seen = seen;
const wrapper = { toString() { if (typeof this === "function" && seen.length < 10000) seen.push(this); return Reflect.apply(original, this, arguments); } }.toString;
Object.defineProperty(Function.prototype, "toString", { value: wrapper, writable: true, configurable: true });

const m = await import("./subject.mjs");
const ways = {
  "fn.toString()": () => m.hidden.toString(),
  "String(fn)": () => String(m.arrow),
  "template `${fn}`": () => `${m.K}`,
  'fn + ""': () => m.hidden + "",
  "Function.prototype.toString.call(fn)": () => Function.prototype.toString.call(m.hidden),
  "original kept before the wrapper": () => cachedBefore.call(m.arrow),
  "other realm (vm) toString": () => vm.runInNewContext("Function.prototype.toString")["call"](m.K),
  "util.inspect(fn)": () => util.inspect(m.hidden),
  "worker eval of the text": async () => { const w = new Worker(`require("node:worker_threads").parentPort.postMessage((${m.hidden})())`, { eval: true }); const r = await new Promise((ok) => w.once("message", ok)); await w.terminate(); return r; },
};
const result = {};
for (const [name, f] of Object.entries(ways)) {
  const n = seen.length;
  const text = await f();
  result[name] = { sawText: String(text).includes("return") || String(text).includes("class K"), wrapperSaw: seen.length > n };
}
// map what the wrapper saw to scripts, through [[FunctionLocation]] and the coverage payload's script ids
const t = performance.now();
const { result: arr } = await session.post("Runtime.evaluate", { expression: "globalThis.__seen" });
const { result: elems } = await session.post("Runtime.getProperties", { objectId: arr.objectId, ownProperties: true });
const urls = new Map((await session.post("Profiler.takePreciseCoverage")).result.map((s) => [s.scriptId, s.url]));
const located = [];
for (const e of elems.filter((x) => /^\d+$/.test(x.name))) {
  const { internalProperties } = await session.post("Runtime.getProperties", { objectId: e.value.objectId, ownProperties: true });
  const loc = internalProperties?.find((p) => p.name === "[[FunctionLocation]]")?.value?.value;
  located.push(loc ? `${urls.get(loc.scriptId)?.split("/").pop()}:${loc.lineNumber + 1}` : "no location");
}
const lookupMs = performance.now() - t;
// cost of the wrapper per call, 1e6 calls on a small function
const bench = (label) => { const s = performance.now(); let n = 0; for (let i = 0; i < 1e6; i++) n += m.arrow.toString().length; return [label, +(performance.now() - s).toFixed(1), n]; };
Object.defineProperty(Function.prototype, "toString", { value: original, writable: true, configurable: true });
const plain = bench("original");
Object.defineProperty(Function.prototype, "toString", { value: wrapper, writable: true, configurable: true });
seen.length = 10000; // full: the wrapper's check only
const wrapped = bench("wrapper (list full)");
seen.length = 0;
const wrappedPush = (() => { const s = performance.now(); for (let i = 0; i < 1e4; i++) m.arrow.toString(); return ["wrapper (pushing), 1e4 calls", +(performance.now() - s).toFixed(1)]; })();
// side effect a test can see
const visible = { "wrapper.name": Function.prototype.toString.name, "toString of toString": Function.prototype.toString.toString().slice(0, 40) };
console.log(JSON.stringify({ node: process.version, load: loadavg()[0], result, located, lookupMs: +lookupMs.toFixed(2), seenCount: elems.length, bench: [plain, wrapped, wrappedPush], visible }, null, 1));
process.exit(0);
