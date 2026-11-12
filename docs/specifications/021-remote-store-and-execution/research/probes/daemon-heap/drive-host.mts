// Throwaway probe for research 021-27, question 3: D20's cold start, without a daemon.
// Runs only inside the scratch that setup.sh makes, with env.sh's HOME, XDG_* and TMPDIR.
//   tsx drive-host.mts <bundle squeal.mjs> <version> <root> <edited test file> <cycles> <warm per cycle>
// Each cycle starts one Vitest runner host process through Squeal's own proxy (source at this
// worktree's commit; the host is the copied bundle's `runner-host`), does what the daemon asks
// of a host for one edit, `warm` more times on the same host, then closes it (the process exits:
// D20's planned close). Per edit: append a comment to the test file, `invalidate`, `affected`,
// `closure` of each direct file, `run` of up to 4 direct files. One JSON line per step on stdout
// with the wall time, the load and the host's private memory. The file is restored at the end.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnRunnerHost } from "../../../../../../src/core/runner-host/channel.ts";
import { startHostProxy } from "../../../../../../src/core/runner-host/proxy.ts";
import { hostedOptions } from "../../../../../../src/core/runner-host/vitest-host.ts";

const [cli, version, root, edited, cyclesArg, warmArg] = process.argv.slice(2);
const cycles = Number(cyclesArg ?? 3);
const warm = Number(warmArg ?? 2);
const original = readFileSync(join(root, edited), "utf8");
const load1 = () => readFileSync("/proc/loadavg", "utf8").split(" ")[0];
const priv = (pid: number | null) => {
  if (pid === null) return null;
  try {
    const s = readFileSync(`/proc/${pid}/status`, "utf8");
    const kb = (k: string) => Number(new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(s)?.[1] ?? 0);
    return Math.round((kb("RssAnon") + kb("RssShmem")) / 1024);
  } catch {
    return null;
  }
};
const log = (o: Record<string, unknown>) => console.log(JSON.stringify({ t: new Date().toISOString(), load1: load1(), ...o }));
const logDir = join(process.env.TMPDIR ?? "/tmp", "drive-logs");
mkdirSync(logDir, { recursive: true });
let n = 0;

try {
  for (let c = 1; c <= cycles; c++) {
    const t0 = performance.now();
    const channel = spawnRunnerHost({ execPath: process.execPath, execArgv: [], cli }, root as never, "vitest");
    const { options, policy } = hostedOptions({ root: root as never, maxWorkers: 4, observe: () => true });
    const adapter = await startHostProxy({ channel, runner: "vitest", version, options, policy });
    const started = performance.now();
    const files = await adapter.testFiles();
    const listed = performance.now();
    log({ cycle: c, step: "start", startMs: Math.round(started - t0), listMs: Math.round(listed - started), files: files.length, hostPriv: priv(channel.pid) });
    for (let e = 0; e <= warm; e++) {
      n += 1;
      writeFileSync(join(root, edited), `${original}\n// probe 021-27 ${n}\n`);
      const a = performance.now();
      await adapter.invalidate([{ path: edited as never, kind: "change" }]);
      const b = performance.now();
      const affected = await adapter.affected([edited as never]);
      const d = performance.now();
      const direct = affected.direct.slice(0, 4);
      for (const f of direct) await adapter.closure(f);
      const k = performance.now();
      const report = await adapter.run(direct, { runId: `probe-${n}`, logDir: logDir as never, timeoutMs: 600_000 });
      const r = performance.now();
      log({
        cycle: c,
        step: e === 0 ? "cold-edit" : "warm-edit",
        invalidateMs: Math.round(b - a),
        affectedMs: Math.round(d - b),
        closureMs: Math.round(k - d),
        runMs: Math.round(r - k),
        editMs: Math.round(r - a),
        direct: affected.direct.length,
        transitive: affected.transitive.length,
        end: (report as { end?: unknown }).end,
        hostPriv: priv(channel.pid),
      });
    }
    const z = performance.now();
    await adapter.close();
    log({ cycle: c, step: "close", closeMs: Math.round(performance.now() - z) });
  }
} finally {
  writeFileSync(join(root, edited), original);
}
