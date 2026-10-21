// Throwaway probe for research 013-05. Loaded into the research's own daemon only:
//   node --expose-gc --import <this file> <bundle>/dist/cli/squeal.mjs daemon <root>
// Acts only in the daemon process (argv "squeal.mjs daemon", no SQUEAL_DAEMON_CHILD).
// module.registerHooks sends the daemon's import of the project's vitest/dist/node.js to a
// generated module that re-exports it and wraps createVitest, so each instance is tracked by a
// WeakRef (globalThis.__vclTrack). No product code changes; the
// daemon's socket and store are not touched. Commands: a file named <cmd> in $VCL_CTL.
//   count-<label>   two full GCs in separate macrotasks, then one JSON line in $VCL_LOG:
//                   instances created, alive, heapUsed, private memory, load.
//   snap-<label>    a heap snapshot to $VCL_SNAP_DIR/<label>.heapsnapshot.
import { appendFileSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { registerHooks } from "node:module";
import { join } from "node:path";
import v8 from "node:v8";

const isDaemon =
  process.argv.some((a) => a.endsWith("squeal.mjs")) &&
  process.argv.includes("daemon") &&
  process.env.SQUEAL_DAEMON_CHILD === undefined;
const { VCL_LOG: LOG, VCL_CTL: CTL, VCL_SNAP_DIR: SNAPS } = process.env;

if (isDaemon && LOG && CTL) {
  const WRAP = "?vcl-wrap";
  registerHooks({
    resolve(specifier, context, next) {
      const r = next(specifier, context);
      if (r.url.endsWith("/vitest/dist/node.js") && !context.parentURL?.endsWith(WRAP)) {
        return { url: r.url + WRAP, format: "module", shortCircuit: true };
      }
      return r;
    },
    load(url, context, next) {
      if (!url.endsWith(WRAP)) return next(url, context);
      const target = JSON.stringify(url.slice(0, -WRAP.length));
      const source = `export * from ${target};
import { createVitest as real } from ${target};
export async function createVitest(...args) {
  const t0 = performance.now();
  const vitest = await real(...args);
  globalThis.__vclTrack?.(vitest, Math.round(performance.now() - t0));
  return vitest;
}
`;
      return { format: "module", source, shortCircuit: true };
    },
  });
  const created = [];
  globalThis.__vclTrack = (vitest, ms) => {
    created.push({ ref: new WeakRef(vitest), at: new Date().toISOString(), ms });
    write({ label: "created", n: created.length, ms });
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const mib = (n) => Math.round((n / 2 ** 20) * 10) / 10;
  const status = () => {
    const s = readFileSync("/proc/self/status", "utf8");
    const kb = (k) => Number(new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(s)?.[1] ?? 0);
    return { privMiB: mib(kb("RssAnon") * 1024), swapMiB: mib(kb("VmSwap") * 1024) };
  };
  const write = (o) =>
    appendFileSync(LOG, `${JSON.stringify({ t: new Date().toISOString(), load1: readFileSync("/proc/loadavg", "utf8").split(" ")[0], ...o })}\n`);
  const count = async (label) => {
    for (let i = 0; i < 2; i++) { await tick(); globalThis.gc({ type: "major", execution: "sync" }); }
    await tick();
    const alive = created.filter((c) => c.ref.deref() !== undefined).length;
    await tick();
    write({ label, created: created.length, alive, heapUsedMiB: mib(process.memoryUsage().heapUsed), ...status() });
  };
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    let names;
    try { names = readdirSync(CTL); } catch { return; }
    busy = true;
    for (const name of names) {
      if (name.startsWith("count-")) await count(name.slice(6));
      else if (name.startsWith("snap-")) v8.writeHeapSnapshot(join(SNAPS, `${name.slice(5)}.heapsnapshot`));
      rmSync(join(CTL, name), { force: true });
    }
    busy = false;
  }, 300).unref();
}
