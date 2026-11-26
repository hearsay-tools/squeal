// Throwaway probe (row 025-14). The cases and seeded store of
// test/harness/latency.test.ts, run against one or more hook dists, the
// dists interleaved run by run so they share the machine's noise.
// Run: timeout 600 pnpm exec vitest run --config <this dir>/vitest.probe.config.ts
// Env:
//   PROBE_DISTS      name=dir,name=dir (default committed=plugins/claude-code/dist)
//   PROBE_RUNS       runs per case and dist (default 20)
//   PROBE_CASES      regex over case names (default all)
//   PROBE_NODE_ARGS  JSON array of extra node arguments; {dist} {case} {run} are replaced
//   PROBE_ENV        JSON object of extra environment; same placeholders
//   PROBE_NO_CHECK   1: check only the exit code (stripped phase copies print nothing)
//   PROBE_STDOUT     JSON file for every run's stdout (output parity between dists)
//   PROBE_OUT        JSON file for the samples (default $TMPDIR/hook-runs.json)
import { writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { testCommandDeniedMetaKey } from "../../../../../../../src/core/delivery/test-command-denied.js";
import { writeTurn } from "../../../../../../../src/core/delivery/turn.js";
import { omittedTestFilesMetaKey } from "../../../../../../../src/core/scheduler/omitted-test-files.js";
import { PLUGIN_DIST } from "../../../../../../../src/harness/claude-code/build.js";
import { liveSocket, runNode, runtimeDir } from "../../../../../../../test/harness/bundle-helpers.js";
import { recorded, type SquealRepo, squealRepo } from "../../../../../../../test/harness/helpers.js";
import { check, result } from "../../../../../../../test/state/helpers.js";

function seeded(): SquealRepo {
  const r = squealRepo();
  const results = [];
  for (let f = 0; f < 50; f++) {
    const file = { project: "", path: `src/m${f}.test.ts` };
    r.store.testFileKeys.upsertMany([
      { worktreeId: r.worktreeId, testFile: file, key: `k${f}`, revision: 1, pending: null },
    ]);
    for (let c = 0; c < 10; c++) {
      results.push(
        result(check(`m${f} > case ${c}`, file), "pass", { key: `k${f}`, worktreeId: r.worktreeId }),
      );
    }
  }
  r.apply(r.pass(), ...results);
  return r;
}

interface Case {
  readonly hook: string;
  readonly name?: string;
  readonly input: string;
  readonly overrides?: object;
  readonly env?: Readonly<Record<string, string>>;
  readonly before?: (r: SquealRepo, run: number) => void;
}
const flip = (r: SquealRepo, run: number) => r.apply(run % 2 === 0 ? r.fail() : r.pass());
const CASES: readonly Case[] = [
  { hook: "session-start", input: "session-start" },
  { hook: "post-tool-batch", input: "post-tool-batch", before: flip },
  { hook: "pre-tool-use", input: "pre-tool-use", before: flip },
  {
    hook: "pre-tool-use",
    name: "pre-tool-use-bash-silent",
    input: "pre-tool-use",
    overrides: { tool_name: "Bash", tool_input: { command: "sleep 15" } },
    before: (r) => r.store.transaction(() => writeTurn(r.store, r.consumer(), null)),
  },
  {
    hook: "pre-tool-use",
    name: "pre-tool-use-denied",
    input: "pre-tool-use",
    overrides: { tool_name: "Bash", tool_input: { command: "npx vitest run" } },
    before: (r) => {
      r.policy({ testCommand: { denyWhenCurrent: true } });
      r.store.meta.delete(testCommandDeniedMetaKey(r.worktreeId));
      r.store.meta.set(omittedTestFilesMetaKey(r.worktreeId), "0");
    },
  },
  { hook: "stop", input: "stop", before: flip },
  { hook: "stop", name: "stop-silent", input: "stop" },
  { hook: "user-prompt-submit", input: "user-prompt-submit", before: flip },
  { hook: "user-prompt-submit", name: "user-prompt-submit-silent", input: "user-prompt-submit" },
  {
    hook: "session-end",
    input: "session-end",
    before: (r) => r.store.consumers.register(r.consumer(), Date.now()),
  },
  { hook: "waiter", input: "stop", env: { CLAUDE_CODE_SESSION_ATTENDED: "0", CLAUDE_CODE_ENTRYPOINT: "sdk-cli" } },
];

const fill = (s: string, v: Record<string, string>) =>
  s.replace(/\{(dist|case|run)\}/g, (_, k: string) => v[k] ?? "");

it("runs the hook cases", async () => {
  const dists = (process.env.PROBE_DISTS ?? `committed=${PLUGIN_DIST}`).split(",").map((d) => {
    const [name, dir] = d.split("=");
    return { name: name as string, dir: dir as string };
  });
  const runs = Number(process.env.PROBE_RUNS ?? 20);
  const only = new RegExp(process.env.PROBE_CASES ?? ".");
  const args = JSON.parse(process.env.PROBE_NODE_ARGS ?? "[]") as string[];
  const extraEnv = JSON.parse(process.env.PROBE_ENV ?? "{}") as Record<string, string>;
  const r = seeded();
  const dir = runtimeDir();
  await liveSocket(join(dir, `squeal-${r.worktreeId}.sock`));
  const warm = await runNode(
    ["--disable-warning=ExperimentalWarning", join(dists[0]?.dir as string, "session-start.mjs")],
    recorded("session-start", r.root),
    { XDG_RUNTIME_DIR: dir },
  );
  expect(warm.code).toBe(0);
  const out: Record<string, Record<string, number[]>> = {};
  const loads: number[] = [loadavg()[0] ?? 0];
  const stdouts: Record<string, string[]> = {};
  // A transition before every run of every dist: the flip follows one sequence across dists.
  let seq = 0;
  for (const c of CASES) {
    const name = c.name ?? c.hook;
    if (!only.test(name)) continue;
    for (let run = 0; run < runs; run++) {
      for (const d of dists) {
        c.before?.(r, seq++);
        const v = { dist: d.name, case: name, run: String(run) };
        const env = Object.fromEntries(Object.entries(extraEnv).map(([k, x]) => [k, fill(x, v)]));
        const res = await runNode(
          [
            "--disable-warning=ExperimentalWarning",
            ...args.map((a) => fill(a, v)),
            join(d.dir, `${c.hook}.mjs`),
          ],
          recorded(c.input, r.root, c.overrides),
          { XDG_RUNTIME_DIR: dir, ...c.env, ...env },
        );
        expect(res.code, `${name}@${d.name}: ${res.stderr}`).toBe(0);
        if (process.env.PROBE_NO_CHECK === "1") {
          // Stripped copies: only the exit code.
        } else if (name.endsWith("silent")) expect(res.stdout, name).toBe("");
        else if (name.endsWith("denied")) expect(res.stdout, name).toContain('"deny"');
        ((out[name] ??= {})[d.name] ??= []).push(res.ms);
        (stdouts[`${name}@${d.name}`] ??= []).push(res.stderr === "" ? res.stdout : `${res.stdout}\nSTDERR ${res.stderr}`);
      }
    }
    loads.push(loadavg()[0] ?? 0);
  }
  const file = process.env.PROBE_OUT ?? join(process.env.TMPDIR ?? "/tmp", "hook-runs.json");
  writeFileSync(file, JSON.stringify({ node: process.version, loads, samples: out }, null, 1));
  if (process.env.PROBE_STDOUT) writeFileSync(process.env.PROBE_STDOUT, JSON.stringify(stdouts, null, 1));
  const q = (xs: number[], p: number) => {
    const s = [...xs].sort((a, b) => a - b);
    return Math.round(s[Math.ceil(s.length * p) - 1] ?? Number.NaN);
  };
  const rows = Object.entries(out).flatMap(([c, byDist]) =>
    Object.entries(byDist).map(([d, xs]) => ({ case: c, dist: d, p50: q(xs, 0.5), p95: q(xs, 0.95) })),
  );
  console.log(`load ${loads.map((l) => l.toFixed(1)).join(" ")}`);
  console.table(rows);
});
