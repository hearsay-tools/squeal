import { relative, resolve } from "node:path";
import { COUNTER_VERSION } from "../core/code/count/index.js";
import {
  COVERAGE_PROVIDER_VERSION,
  COVERAGE_RECORD_VERSION,
} from "../core/code/coverage/record.js";
import { BaseRefError, changedFunctions, mergeBase } from "../core/code/gate/changed.js";
import { CollectUsageError, type GateAdapters } from "../core/code/gate/collect.js";
import { evaluate } from "../core/code/gate/evaluate.js";
import { readPartsIn } from "../core/code/gate/parts.js";
import { type BasePolicy, loadBasePolicy } from "../core/code/gate/policy.js";
import type { EngineVersions, GateRunner } from "../core/code/gate/report.js";
import type { ChangedSet, GateVerdict } from "../core/code/gate/types.js";
import { POLICY_FILE } from "../core/daemon/policy.js";
import { squealVersion } from "../core/daemon/version.js";
import { findWorktreeRoot } from "../core/fs/git-layout.js";
import type { AbsolutePath, RelativePath } from "../core/types/common.js";
import type { RunnerAdapter } from "../core/types/runner.js";
import { createNodeTestAdapter } from "../runners/node-test/adapter.js";
import { createVitestAdapter } from "../runners/vitest/index.js";
import { CODE_GATE_USAGE, parseGateArgs } from "./code-gate-args.js";
import { exceptionsOf } from "./code-gate-exceptions.js";
import { collectWithStores } from "./code-gate-stored.js";
import { formatGateReport } from "./code-gate-text.js";
import type { CliIo } from "./main.js";
import { statusCommand } from "./status-command.js";

/*
 * Spec 020 D1 (row 020-05): `squeal code --base <ref>`, the one-shot gate.
 * It wires the inventory (D2), the collector (D3) and the evaluator (D5 to
 * D7) with no daemon; it reads `ci record`'s parts (D13.2) and the stores
 * (D11.7) and never writes them. It exits with the verdict: 0 pass, 1
 * violations, 3 incomplete, 2 on a usage or setup error. Its arguments are
 * `code-gate-args.ts`'s.
 */

/** `squeal code` runs the gate when `--base` is among its arguments. */
export const isGate = (args: readonly string[]) =>
  args.some((a) => a === "--base" || a.startsWith("--base="));

/** D1: the exit code of each verdict. */
const EXIT: Readonly<Record<GateVerdict, number>> = { pass: 0, violations: 1, incomplete: 3 };

/** The runners' adapters as the CLI gives them to the collector (D3.2). */
const ADAPTERS: GateAdapters = { vitest: createVitestAdapter, nodeTest: createNodeTestAdapter };

/** Each path relative to `root`, or the first that is outside it. */
function underRoot(
  root: AbsolutePath,
  cwd: string,
  paths: readonly string[],
): RelativePath[] | { readonly outside: string } {
  const relatives = paths.map((p) => relative(root, resolve(cwd, p)));
  const outside = relatives.findIndex((p) => p === ".." || p.startsWith("../"));
  return outside < 0 ? relatives : { outside: paths[outside] as string };
}

/** D1: the paths narrow the changed set to those files or directories; none keeps all. */
export function narrow(changed: ChangedSet, paths: readonly RelativePath[]): ChangedSet {
  if (paths.length === 0) return changed;
  const inside = (path: RelativePath) =>
    paths.some((p) => p === "" || path === p || path.startsWith(`${p}/`));
  const within = ({ path }: { readonly path: RelativePath }) => inside(path);
  return {
    ...changed,
    paths: changed.paths.filter(inside),
    functions: changed.functions.filter(within),
    counted: changed.counted.filter(within),
    inErrors: changed.inErrors.filter(within),
    uncounted: changed.uncounted.filter(within),
    ...(changed.baseCounted === undefined
      ? {}
      : { baseCounted: changed.baseCounted.filter(within) }),
  };
}

/** The adapters, each runner's `run` timed into `durations` (D7's run durations). */
function timed(
  adapters: GateAdapters,
  durations: Partial<Record<GateRunner, number>>,
): GateAdapters {
  const wrap = (runner: GateRunner, adapter: RunnerAdapter): RunnerAdapter =>
    new Proxy(adapter, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key, target);
        if (typeof value !== "function") return value;
        if (key !== "run") return value.bind(target);
        return async (...args: Parameters<RunnerAdapter["run"]>) => {
          const started = performance.now();
          try {
            return await target.run(...args);
          } finally {
            const ms = Math.round(performance.now() - started);
            durations[runner] = (durations[runner] ?? 0) + ms;
          }
        };
      },
    });
  return {
    vitest: async (options) => wrap("vitest", await adapters.vitest(options)),
    nodeTest: async (project, options) =>
      wrap("node-test", await adapters.nodeTest(project, options)),
  };
}

const versions = (): EngineVersions => ({
  squeal: squealVersion(),
  counter: COUNTER_VERSION,
  coverageProvider: COVERAGE_PROVIDER_VERSION,
  coverageRecord: COVERAGE_RECORD_VERSION,
});

/** An argument as a POSIX shell reads it back. */
const quoted = (arg: string) =>
  /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`;

/**
 * `squeal code --base <ref> [<path>...] [--test <file>...] [--parts
 * <dir>...] [--timeout <seconds>] [--exceptions <file>] [--json]` (spec 020
 * D1, D8). Runs tests, with no daemon, for up to the budget; a file whose
 * evidence `ci record`'s parts certify here (D13.2), or with results and a
 * record at its key in the stores (D11.7), does not run. Policy problems
 * and the runners' notes go to stderr; stdout holds the report alone.
 */
export async function codeGateCommand(
  args: readonly string[],
  io: CliIo,
  adapters: GateAdapters = ADAPTERS,
): Promise<number> {
  const fail = (text: string, usage = false) => {
    io.stderr(`squeal code: ${text}\n${usage ? `\nUsage: ${CODE_GATE_USAGE}\n` : ""}`);
    return 2;
  };
  const parsed = parseGateArgs(args);
  if ("error" in parsed) return fail(parsed.error, true);
  const cwd = io.cwd ?? process.cwd();
  const root = findWorktreeRoot(cwd);
  if (root === null) return fail(`${cwd} is not inside a git worktree`);
  const paths = underRoot(root, cwd, parsed.paths);
  if ("outside" in paths) return fail(`"${paths.outside}" is outside the worktree ${root}`, true);
  const tests = underRoot(root, cwd, parsed.tests);
  if ("outside" in tests) return fail(`"${tests.outside}" is outside the worktree ${root}`, true);
  const exceptions = await exceptionsOf(cwd, parsed.exceptions);
  if (exceptions !== undefined && "error" in exceptions) return fail(exceptions.error);
  // D13.2: a parts directory that is missing, empty or holds a part that does not read is a setup error.
  const parts = readPartsIn((parsed.parts ?? []).map((dir) => resolve(cwd, dir)));
  if (typeof parts === "string") return fail(parts);
  const inventory = await inventoryOf(root, parsed.ref, paths, io);
  if ("error" in inventory) return fail(inventory.error);
  const { changed, policy } = inventory;
  const durationsMs: Partial<Record<GateRunner, number>> = {};
  const evidence = await collectWithStores(
    root,
    io.env ?? process.env,
    changed,
    {
      tests,
      budgetSeconds: parsed.budgetSeconds,
      adapters: timed(adapters, durationsMs),
      note: (text) => io.stderr(`squeal code: ${text}\n`),
      // D12.1: how the runs collect is the base's, as the limits are.
      children: policy.children,
    },
    parts,
  ).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
  // D1: a configured runner that cannot start, or no coverage provider, is a setup error.
  if (evidence instanceof Error) {
    return fail(evidence.message, evidence instanceof CollectUsageError);
  }
  const createdAt = new Date((io.now ?? Date.now)()).toISOString();
  const times = { createdAt, durationsMs };
  const report = evaluate(changed, evidence, policy, versions(), times, exceptions);
  const json = `${statusCommand(io.env ?? process.env)} code ${[...args.map(quoted), "--json"].join(" ")}`;
  io.stdout(parsed.json ? `${JSON.stringify(report, null, 2)}\n` : formatGateReport(report, json));
  return EXIT[report.verdict];
}

/**
 * D2 and D6: the policy at the merge base, its problems told on stderr, and
 * the changed functions narrowed to `paths`; or why `ref` gives none.
 */
async function inventoryOf(
  root: AbsolutePath,
  ref: string,
  paths: readonly RelativePath[],
  io: CliIo,
): Promise<
  { readonly changed: ChangedSet; readonly policy: BasePolicy } | { readonly error: string }
> {
  try {
    const baseCommit = await mergeBase(root, ref);
    const { policy, problems } = await loadBasePolicy(root, baseCommit);
    for (const problem of problems) {
      io.stderr(`squeal code: ${POLICY_FILE} at ${baseCommit.slice(0, 8)}: ${problem}\n`);
    }
    return { changed: narrow(await changedFunctions(root, ref, policy), paths), policy };
  } catch (error) {
    if (error instanceof BaseRefError) return { error: `--base ${error.message}` };
    throw error;
  }
}
