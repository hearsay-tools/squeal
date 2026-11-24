// Throwaway probe for research 025-12 (D12), adapted from 021-27's drive-host.mts.
// Runs only on a scratch clone (a boat.dev sandbox here), never on a live worktree.
//   tsx drive-host.mts latency <cli squeal.mjs> <version> <root> <edited test file> <cycles> <warm>
//   tsx drive-host.mts memory  <cli squeal.mjs> <version> <root> <idle seconds> <file>...
// latency: per cycle, start one Vitest runner host through Squeal's own proxy (as the daemon's
//   fast instance does), list, one cold edit, `warm` warm edits of the same file, close (the
//   process exits: D20's planned close). One edit = append a comment, `invalidate`, `affected`,
//   `closure` of each direct file, `run` of up to 4 direct files.
// memory: one host started with `--expose-gc --import inside.mjs` (021-27's sampler, path in
//   DH_INSIDE), one edit of each named file twice, then samples at "after-run", after
//   `idle seconds` with no call, after a full GC, and a heap snapshot; then close.
// One JSON line per step on stdout: wall times, the 1-minute load, the host's VmRSS and its
// private memory (RssAnon + RssShmem). Every edited file is restored at the end.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { spawnRunnerHost } from "../../../../../../src/core/runner-host/channel.ts";
import { startHostProxy } from "../../../../../../src/core/runner-host/proxy.ts";
import { hostedOptions } from "../../../../../../src/core/runner-host/vitest-host.ts";

const [mode, cli, version, root, ...rest] = process.argv.slice(2);
const load1 = () => readFileSync("/proc/loadavg", "utf8").split(" ")[0];
const mem = (pid: number | null) => {
  if (pid === null) return {};
  try {
    const s = readFileSync(`/proc/${pid}/status`, "utf8");
    const kb = (k: string) => Number(new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(s)?.[1] ?? 0);
    return {
      hostRssMiB: Math.round(kb("VmRSS") / 1024),
      hostPrivMiB: Math.round((kb("RssAnon") + kb("RssShmem")) / 1024),
    };
  } catch {
    return {};
  }
};
const log = (o: Record<string, unknown>) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), load1: load1(), ...o }));
const logDir = join(process.env.TMPDIR ?? "/tmp", "drive-logs");
mkdirSync(logDir, { recursive: true });
const originals = new Map<string, string>();
let n = 0;

async function open(execArgv: string[]) {
  const t0 = performance.now();
  const channel = spawnRunnerHost({ execPath: process.execPath, execArgv, cli }, root as never, "vitest");
  // As the daemon's fast instance: this repository's exclusion, observe on, coverage off.
  const { options, policy } = hostedOptions({
    root: root as never,
    maxWorkers: 2,
    observe: () => true,
    exclude: () => ["test/e2e/**"],
  } as never);
  const adapter = await startHostProxy({ channel, runner: "vitest", version, options, policy });
  const started = performance.now();
  const files = await adapter.testFiles();
  const listed = performance.now();
  return { channel, adapter, startMs: started - t0, listMs: listed - started, files: files.length };
}

async function edit(adapter: Awaited<ReturnType<typeof open>>["adapter"], file: string) {
  if (!originals.has(file)) originals.set(file, readFileSync(join(root, file), "utf8"));
  n += 1;
  writeFileSync(join(root, file), `${originals.get(file)}\n// probe 025-12 ${n}\n`);
  const a = performance.now();
  await adapter.invalidate([{ path: file as never, kind: "change" }]);
  const b = performance.now();
  const affected = await adapter.affected([file as never]);
  const d = performance.now();
  const direct = affected.direct.slice(0, 4);
  for (const f of direct) await adapter.closure(f);
  const k = performance.now();
  const report = await adapter.run(direct, { runId: `probe-${n}`, logDir: logDir as never, timeoutMs: 600_000 });
  const r = performance.now();
  return {
    file,
    invalidateMs: Math.round(b - a),
    affectedMs: Math.round(d - b),
    closureMs: Math.round(k - d),
    runMs: Math.round(r - k),
    editMs: Math.round(r - a),
    direct: affected.direct.length,
    end: (report as { end?: unknown }).end,
  };
}

const ctl = (command: string) => {
  const dir = join(process.env.DH_CTL ?? "", "host-vitest");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, command), "");
};

try {
  if (mode === "latency") {
    const [edited, cyclesArg, warmArg] = rest;
    for (let c = 1; c <= Number(cyclesArg); c++) {
      const h = await open([]);
      log({ cycle: c, step: "start", startMs: Math.round(h.startMs), listMs: Math.round(h.listMs), files: h.files, ...mem(h.channel.pid) });
      for (let e = 0; e <= Number(warmArg); e++) {
        const result = await edit(h.adapter, edited);
        log({ cycle: c, step: e === 0 ? "cold-edit" : "warm-edit", ...result, coldTotalMs: e === 0 ? Math.round(h.startMs + h.listMs + result.editMs) : undefined, ...mem(h.channel.pid) });
      }
      const z = performance.now();
      await h.adapter.close();
      log({ cycle: c, step: "close", closeMs: Math.round(performance.now() - z) });
      await sleep(5_000);
    }
  } else if (mode === "memory") {
    const [idleArg, ...files] = rest;
    const inside = process.env.DH_INSIDE ?? "";
    if (!existsSync(inside)) throw new Error("DH_INSIDE must name inside.mjs");
    const h = await open(["--expose-gc", "--import", inside]);
    log({ step: "start", startMs: Math.round(h.startMs), files: h.files, ...mem(h.channel.pid) });
    ctl("mark-started");
    for (let round = 1; round <= 2; round++) {
      for (const file of files) log({ step: "edit", round, ...(await edit(h.adapter, file)), ...mem(h.channel.pid) });
    }
    ctl("mark-after-run");
    await sleep(2_000);
    log({ step: "after-run", ...mem(h.channel.pid) });
    await sleep(Number(idleArg) * 1000);
    ctl("mark-idle");
    await sleep(2_000);
    log({ step: "idle", idleS: Number(idleArg), ...mem(h.channel.pid) });
    ctl("gc");
    await sleep(4_000);
    log({ step: "after-gc", ...mem(h.channel.pid) });
    ctl("hs");
    // A heap snapshot of a host this size takes seconds; wait for the file to appear and settle.
    await sleep(60_000);
    log({ step: "after-snapshot", ...mem(h.channel.pid) });
    const z = performance.now();
    await h.adapter.close();
    log({ step: "close", closeMs: Math.round(performance.now() - z) });
  } else {
    throw new Error(`unknown mode ${mode}`);
  }
} finally {
  for (const [file, text] of originals) writeFileSync(join(root, file), text);
}
