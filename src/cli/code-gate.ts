import { relative, resolve } from "node:path";
import { COUNTER_VERSION } from "../core/code/count/index.js";
import {
  COVERAGE_PROVIDER_VERSION,
  COVERAGE_RECORD_VERSION,
} from "../core/code/coverage/record.js";
import { BaseRefError, changedFunctions, mergeBase } from "../core/code/gate/changed.js";
import {
  CollectUsageError,
  collectEvidence,
  type GateAdapters,
} from "../core/code/gate/collect.js";
import { evaluate } from "../core/code/gate/evaluate.js";
import { loadBasePolicy } from "../core/code/gate/policy.js";
import type { EngineVersions, GateRunner, GateTimes } from "../core/code/gate/report.js";
import type { ChangedSet, GateVerdict } from "../core/code/gate/types.js";
import { POLICY_FILE } from "../core/daemon/policy.js";
import { squealVersion } from "../core/daemon/version.js";
import { findWorktreeRoot } from "../core/fs/git-layout.js";
import type { AbsolutePath, RelativePath } from "../core/types/common.js";
import type { RunnerAdapter } from "../core/types/runner.js";
import { createNodeTestAdapter } from "../runners/node-test/adapter.js";
import { createVitestAdapter } from "../runners/vitest/index.js";
import { formatGateReport } from "./code-gate-text.js";
import type { CliIo } from "./main.js";
import { statusCommand } from "./status-command.js";

/*
 * Spec 020 D1 (row 020-05): `squeal code --base <ref>`, the one-shot gate.
 * It wires the inventory (D2), the collector (D3) and the evaluator (D5 to
 * D7) with no daemon and no store, and exits with the verdict: 0 pass, 1
 * violations, 3 incomplete, 2 on a usage or setup error.
 */

export const CODE_GATE_USAGE =
  "squeal code --base <ref> [<path>...] [--test <file>...] [--timeout <seconds>] [--json]";

/** D3.4: the one budget over every run, in seconds. */
export const DEFAULT_BUDGET_SECONDS = 600;

/** D1: the exit code of each verdict. */
const EXIT: Readonly<Record<GateVerdict, number>> = { pass: 0, violations: 1, incomplete: 3 };

/** The runners' adapters as the CLI gives them to the collector (D3.2). */
const ADAPTERS: GateAdapters = { vitest: createVitestAdapter, nodeTest: createNodeTestAdapter };

export interface GateArgs {
  readonly ref: string;
  readonly paths: readonly string[];
  readonly tests: readonly string[];
  readonly budgetSeconds: number;
  readonly json: boolean;
}

/** `squeal code` runs the gate when `--base` is among its arguments. */
export const isGate = (args: readonly string[]) =>
  args.some((a) => a === "--base" || a.startsWith("--base="));

/** `--flag=value` as the flag and its value; any other argument as itself. */
function split(arg: string): [string, string | undefined] {
  const eq = arg.indexOf("=");
  return arg.startsWith("--") && eq > 0 ? [arg.slice(0, eq), arg.slice(eq + 1)] : [arg, undefined];
}

/**
 * D1's arguments. `--test` takes every argument after it up to the next
 * option, as `ci export --parts` does, so paths go before it; it may also
 * repeat. `--changed` and `--told` are usage errors with `--base`.
 */
export function parseGateArgs(args: readonly string[]): GateArgs | { readonly error: string } {
  let ref: string | null = null;
  let budget: number | null = null;
  let json = false;
  const paths: string[] = [];
  const tests: string[] = [];
  const takeValue = (i: number, inline: string | undefined) => {
    const next = args[i + 1];
    if (inline !== undefined) return { value: inline, at: i };
    return next === undefined || next.startsWith("--")
      ? { value: "", at: i }
      : { value: next, at: i + 1 };
  };
  for (let i = 0; i < args.length; i++) {
    const [flag, inline] = split(args[i] as string);
    if (flag === "--json" && inline === undefined) json = true;
    else if (flag === "--changed" || flag === "--told") {
      return {
        error: `--base does not combine with ${flag}: each chooses the functions another way`,
      };
    } else if (flag === "--base") {
      const { value, at } = takeValue(i, inline);
      if (value === "") return { error: "--base names no ref" };
      if (ref !== null) return { error: "--base is given twice" };
      ref = value;
      i = at;
    } else if (flag === "--timeout") {
      const { value, at } = takeValue(i, inline);
      if (!/^[1-9][0-9]*$/.test(value)) return { error: "--timeout takes whole seconds above 0" };
      budget = Number(value);
      i = at;
    } else if (flag === "--test") {
      const before = tests.length;
      if (inline !== undefined) tests.push(inline);
      else
        while (i + 1 < args.length && !(args[i + 1] as string).startsWith("--"))
          tests.push(args[++i] as string);
      if (tests.length === before || tests.includes("")) return { error: "--test names no file" };
    } else if (flag.startsWith("--")) return { error: `unknown option "${args[i]}"` };
    else paths.push(flag);
  }
  if (ref === null) return { error: "--base names no ref" };
  return { ref, paths, tests, budgetSeconds: budget ?? DEFAULT_BUDGET_SECONDS, json };
}

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
  const within = ({ path }: { readonly path: RelativePath }) =>
    paths.some((p) => p === "" || path === p || path.startsWith(`${p}/`));
  return {
    ...changed,
    functions: changed.functions.filter(within),
    counted: changed.counted.filter(within),
    inErrors: changed.inErrors.filter(within),
    uncounted: changed.uncounted.filter(within),
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
 * `squeal code --base <ref> [<path>...] [--test <file>...] [--timeout
 * <seconds>] [--json]` (spec 020 D1). Runs tests, with no daemon, for up to
 * the budget. Policy problems and the runners' notes go to stderr; stdout
 * holds the report alone.
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
  const tests = underRoot(root, cwd, parsed.tests);
  for (const named of [paths, tests]) {
    if ("outside" in named) return fail(`"${named.outside}" is outside the worktree ${root}`, true);
  }
  let changed: ChangedSet;
  let policy: Awaited<ReturnType<typeof loadBasePolicy>>["policy"];
  try {
    const baseCommit = await mergeBase(root, parsed.ref);
    const loaded = await loadBasePolicy(root, baseCommit);
    policy = loaded.policy;
    for (const problem of loaded.problems) {
      io.stderr(`squeal code: ${POLICY_FILE} at ${baseCommit.slice(0, 8)}: ${problem}\n`);
    }
    changed = narrow(await changedFunctions(root, parsed.ref, policy), paths as RelativePath[]);
  } catch (error) {
    if (error instanceof BaseRefError) return fail(`--base ${error.message}`);
    throw error;
  }
  const durationsMs: GateTimes["durationsMs"] & Partial<Record<GateRunner, number>> = {};
  const evidence = await collectEvidence(root, changed, {
    tests: tests as RelativePath[],
    budgetSeconds: parsed.budgetSeconds,
    adapters: timed(adapters, durationsMs),
    note: (text) => io.stderr(`squeal code: ${text}\n`),
  }).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
  if (evidence instanceof Error)
    return fail(evidence.message, evidence instanceof CollectUsageError);
  const createdAt = new Date((io.now ?? Date.now)()).toISOString();
  const report = evaluate(changed, evidence, policy, versions(), { createdAt, durationsMs });
  const json = `${statusCommand(io.env ?? process.env)} code ${[...args.map(quoted), "--json"].join(" ")}`;
  io.stdout(parsed.json ? `${JSON.stringify(report, null, 2)}\n` : formatGateReport(report, json));
  return EXIT[report.verdict];
}
