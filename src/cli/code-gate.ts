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

/** The arguments read so far. */
interface Draft {
  ref: string | null;
  budget: number | null;
  json: boolean;
  readonly paths: string[];
  readonly tests: string[];
}

/** The options that take one value: each stores it, or says why it cannot. */
const VALUED: Readonly<Record<string, (value: string, into: Draft) => string | null>> = {
  "--base": (value, into) => {
    if (value === "") return "--base names no ref";
    if (into.ref !== null) return "--base is given twice";
    into.ref = value;
    return null;
  },
  "--timeout": (value, into) => {
    if (!/^[1-9][0-9]*$/.test(value)) return "--timeout takes whole seconds above 0";
    into.budget = Number(value);
    return null;
  },
};

/** Squeal's `--test`, which takes the arguments after it up to the next option. */
const TEST = "--test";

/** The values after `args[i]` up to the next option, at most `most`; and the index of the last. */
function valuesAfter(args: readonly string[], i: number, most: number) {
  let at = i;
  while (at - i < most && at + 1 < args.length && !(args[at + 1] as string).startsWith("--")) at++;
  return { values: args.slice(i + 1, at + 1), at };
}

/**
 * D1's arguments. `--test` takes every argument after it up to the next
 * option, as `ci export --parts` does, so paths go before it; it may also
 * repeat. `--changed` and `--told` are usage errors with `--base`.
 */
export function parseGateArgs(args: readonly string[]): GateArgs | { readonly error: string } {
  const draft: Draft = { ref: null, budget: null, json: false, paths: [], tests: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    const [flag, inline] = split(arg);
    const valued = VALUED[flag];
    if (flag === "--changed" || flag === "--told") {
      return {
        error: `--base does not combine with ${flag}: each chooses the functions another way`,
      };
    } else if (arg === "--json") draft.json = true;
    else if (valued !== undefined || flag === TEST) {
      const taken =
        inline === undefined
          ? valuesAfter(args, i, valued === undefined ? Infinity : 1)
          : { values: [inline], at: i };
      const error =
        valued === undefined
          ? testFiles(taken.values, draft)
          : valued(taken.values[0] ?? "", draft);
      if (error !== null) return { error };
      i = taken.at;
    } else if (arg.startsWith("--")) return { error: `unknown option "${arg}"` };
    else draft.paths.push(arg);
  }
  const { ref, budget, json, paths, tests } = draft;
  if (ref === null) return { error: "--base names no ref" };
  return { ref, paths, tests, budgetSeconds: budget ?? DEFAULT_BUDGET_SECONDS, json };
}

/** Stores `--test`'s files, or says why it cannot. */
function testFiles(files: readonly string[], into: Draft): string | null {
  if (files.length === 0 || files.includes("")) return "--test names no file";
  into.tests.push(...files);
  return null;
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
  if ("outside" in paths) return fail(`"${paths.outside}" is outside the worktree ${root}`, true);
  const tests = underRoot(root, cwd, parsed.tests);
  if ("outside" in tests) return fail(`"${tests.outside}" is outside the worktree ${root}`, true);
  const inventory = await inventoryOf(root, parsed.ref, paths, io);
  if ("error" in inventory) return fail(inventory.error);
  const { changed, policy } = inventory;
  const durationsMs: Partial<Record<GateRunner, number>> = {};
  const evidence = await collectEvidence(root, changed, {
    tests,
    budgetSeconds: parsed.budgetSeconds,
    adapters: timed(adapters, durationsMs),
    note: (text) => io.stderr(`squeal code: ${text}\n`),
  }).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
  // D1: a configured runner that cannot start, or no coverage provider, is a setup error.
  if (evidence instanceof Error) {
    return fail(evidence.message, evidence instanceof CollectUsageError);
  }
  const createdAt = new Date((io.now ?? Date.now)()).toISOString();
  const report = evaluate(changed, evidence, policy, versions(), { createdAt, durationsMs });
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
