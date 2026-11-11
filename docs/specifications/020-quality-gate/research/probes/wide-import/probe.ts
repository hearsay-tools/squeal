// Throwaway probe (row 020-17). Runs the worktree's own `squeal code --base`
// (codeGateCommand, from src/ through tsx) on a fixture, with each adapter
// method timed on one timeline. ORDER=path (today) | loaders (smallest loader
// set of a changed path first; the hub, loaded by all, last) reorders the
// files handed to `run`. Prints one JSON line: phases, counts, verdict.
// Usage: ORDER=path TIMEOUT=600 tsx probe.ts <fixture-root> <base-ref>
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { loadavg } from "node:os";
import { codeGateCommand } from "../../../../../../src/cli/code-gate.ts";
import { createNodeTestAdapter } from "../../../../../../src/runners/node-test/adapter.ts";
import { createVitestAdapter } from "../../../../../../src/runners/vitest/index.ts";
import type { RunnerAdapter } from "../../../../../../src/core/types/runner.ts";

const [root, base] = process.argv.slice(2) as [string, string];
const order = process.env.ORDER ?? "path";
const timeout = process.env.TIMEOUT ?? "600";
const t0 = performance.now();
const at = () => Math.round(performance.now() - t0);
const events: { t: number; e: string; ms?: number; n?: number }[] = [];
const totals: Record<string, { calls: number; ms: number }> = {};
const changed = execFileSync("git", ["-C", root, "diff", "--name-only", base, "HEAD"]).toString().trim().split("\n");

async function reorder(adapter: RunnerAdapter, files: Parameters<RunnerAdapter["run"]>[0]) {
  if (order === "path") return files;
  const started = performance.now();
  const loaders = new Map<string, string[]>();
  for (const ref of files) {
    const closure = await adapter.closure(ref).catch(() => null);
    for (const p of changed) if (closure === null || closure.paths.has(p as never)) {
      loaders.set(p, [...(loaders.get(p) ?? []), ref.path]);
    }
  }
  const paths = [...loaders.entries()].sort((a, b) => a[1].length - b[1].length);
  const rank = new Map<string, number>();
  for (const [, refs] of paths) for (const r of refs) if (!rank.has(r)) rank.set(r, rank.size);
  const out = [...files].sort((a, b) => (rank.get(a.path) ?? 1e9) - (rank.get(b.path) ?? 1e9));
  events.push({ t: at(), e: "reorder", ms: Math.round(performance.now() - started), n: out.length });
  return out;
}

function timed(kind: string, adapter: RunnerAdapter): RunnerAdapter {
  return new Proxy(adapter, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      const name = `${kind}.${String(key)}`;
      return async (...args: unknown[]) => {
        if (key === "run") args[0] = await reorder(target, args[0] as never);
        const s = performance.now();
        if (key !== "closure") events.push({ t: at(), e: `${name}:start`, n: Array.isArray(args[0]) ? args[0].length : undefined });
        try {
          return await (value as (...a: unknown[]) => unknown).apply(target, args);
        } finally {
          const ms = performance.now() - s;
          totals[name] = { calls: (totals[name]?.calls ?? 0) + 1, ms: (totals[name]?.ms ?? 0) + ms };
          if (key !== "closure") events.push({ t: at(), e: `${name}:end`, ms: Math.round(ms) });
        }
      };
    },
  });
}

const load = loadavg()[0];
let stdout = "";
const code = await codeGateCommand(["--base", base, "--json", "--timeout", timeout], {
  cwd: root,
  env: { ...process.env },
  stdout: (s: string) => { stdout += s; },
  stderr: (s: string) => { events.push({ t: at(), e: `stderr: ${s.trim().slice(0, 160)}` }); },
} as never, {
  vitest: async (o) => { events.push({ t: at(), e: "vitest.open:start" }); const a = timed("vitest", await createVitestAdapter(o as never)); events.push({ t: at(), e: "vitest.open:end" }); return a; },
  nodeTest: async (p, o) => timed("node-test", await createNodeTestAdapter(p as never, o as never)),
});
const report = JSON.parse(stdout);
let starts: string[] = [];
try { starts = readFileSync(`${root}/order.log`, "utf8").trim().split("\n").filter((l) => l.includes(" start ")).map((l) => l.split(" ")[2]!); } catch {}
const run = report.runs?.[0] ?? {};
const byPath: Record<string, Record<string, number>> = {};
for (const f of report.functions) { (byPath[f.path] ??= {})[f.state] = (byPath[f.path]?.[f.state] ?? 0) + 1; }
console.log(JSON.stringify({
  order, timeout: Number(timeout), loadAtStart: load, loadAtEnd: loadavg()[0], exit: code, totalMs: at(),
  verdict: report.verdict, counts: report.counts, byPath,
  selected: run.selected?.length, completed: run.completed?.length, notFinished: run.notFinished?.length, runDurationMs: run.durationMs, budget: report.budget,
  totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, { calls: v.calls, ms: Math.round(v.ms) }])),
  events, firstStarts: starts.slice(0, 12), lastStarts: starts.slice(-5), startedFiles: starts.length,
}));
