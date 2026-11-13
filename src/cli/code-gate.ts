import { relative, resolve } from "node:path";
import { readPartsIn } from "../core/ci/parts.js";
import { COUNTER_VERSION } from "../core/code/count/index.js";
import {
  COVERAGE_PROVIDER_VERSION,
  COVERAGE_RECORD_VERSION,
} from "../core/code/coverage/record.js";
import { BaseRefError, changedFunctions, mergeBase } from "../core/code/gate/changed.js";
import { type CollectOptions, CollectUsageError } from "../core/code/gate/collect.js";
import { evaluate } from "../core/code/gate/evaluate.js";
import { refusedText } from "../core/code/gate/parts-refused.js";
import { type BasePolicy, loadBasePolicy } from "../core/code/gate/policy.js";
import type { EngineVersions, GateRunner, GateRunReport } from "../core/code/gate/report.js";
import type { GateAdapters } from "../core/code/gate/runners.js";
import { resolveScope } from "../core/code/gate/scope.js";
import type { ChangedSet, GateVerdict } from "../core/code/gate/types.js";
import { POLICY_FILE } from "../core/daemon/policy.js";
import { squealVersion } from "../core/daemon/version.js";
import { findWorktreeRoot } from "../core/fs/git-layout.js";
import { shellWord } from "../core/text.js";
import type { AbsolutePath, RelativePath } from "../core/types/common.js";
import { createNodeTestAdapter } from "../runners/node-test/adapter.js";
import { createVitestAdapter } from "../runners/vitest/index.js";
import { CODE_GATE_USAGE, parseGateArgs } from "./code-gate-args.js";
import { storedDurations } from "./code-gate-durations.js";
import { exceptionsOf } from "./code-gate-exceptions.js";
import { keptLogsLine, type LogRetention, runLogKeeper } from "./code-gate-log.js";
import { estimateOptions, preRunOptions } from "./code-gate-prerun.js";
import { overrunText, timed } from "./code-gate-progress.js";
import { relaunchGate, runAsChild, takeReportFd } from "./code-gate-relaunch.js";
import { collectWithStores } from "./code-gate-stored.js";
import { formatGateReport } from "./code-gate-text.js";
import type { CliIo } from "./main.js";
import { statusCommand } from "./status-command.js";

/*
 * Spec 020 D1 (row 020-05): `squeal code --base <ref>`, the one-shot gate.
 * It wires the inventory (D2), the collector (D3) and the evaluator (D5 to
 * D7) with no daemon; it reads `ci record`'s parts (D13.2) and the stores
 * (D11.7), and keeps each test file it runs to completion in the stores
 * (D17.3). It exits with the verdict: 0 pass, 1 violations, 3 incomplete,
 * 2 on a usage or setup error. Its arguments are `code-gate-args.ts`'s.
 */

/** `squeal code` runs the gate when `--base` is among its arguments. */
export const isGate = (args: readonly string[]) =>
  args.some((a) => a === "--base" || a.startsWith("--base="));

/** D1: the exit code of each verdict. */
const EXIT: Readonly<Record<GateVerdict, number>> = { pass: 0, violations: 1, incomplete: 3 };

/** The runners' adapters as the CLI gives them to the collector (D3.2). */
export const ADAPTERS: GateAdapters = {
  vitest: createVitestAdapter,
  nodeTest: createNodeTestAdapter,
};

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
    ...(changed.omitted === undefined ? {} : { omitted: changed.omitted.filter(within) }),
  };
}

const versions = (): EngineVersions => ({
  squeal: squealVersion(),
  counter: COUNTER_VERSION,
  coverageProvider: COVERAGE_PROVIDER_VERSION,
  coverageRecord: COVERAGE_RECORD_VERSION,
});

/**
 * `squeal code --base <ref> [<path>...] [--test <file>...] [--parts
 * <dir>...] [--timeout <seconds>] [--exceptions <file>] [--json]` (spec 020
 * D1, D8). Runs tests, with no daemon, for up to the budget; a file whose
 * evidence `ci record`'s parts certify here (D13.2), or with results and a
 * record at its key in the stores (D11.7), does not run. Policy problems
 * and the runners' notes go to stderr; stdout holds the report alone.
 * D14.4 (#182): with `--json` in the CLI process (`io.relaunch`), the gate
 * runs in a child whose stdout is this process's stderr, so nothing a test
 * setup or its processes write reaches stdout. The child is marked and
 * never does so again.
 */
export async function codeGateCommand(
  args: readonly string[],
  io: CliIo,
  adapters: GateAdapters = ADAPTERS,
): Promise<number> {
  const reportFd = takeReportFd();
  // D17.5: what runs once the report is out: written here, or sent on the child's pipe.
  const afterReport: (() => Promise<void>)[] = [];
  try {
    if (reportFd !== undefined && reportFd !== null) {
      const run = (stdout: (text: string) => void) =>
        gate(args, { ...io, stdout }, adapters, afterReport);
      return await runAsChild(reportFd, run);
    }
    if (reportFd === undefined && io.relaunch !== undefined && wantsJson(args)) {
      return await relaunchGate(io.relaunch, args, io);
    }
    return await gate(args, io, adapters, afterReport);
  } finally {
    for (const step of afterReport.splice(0)) await step();
  }
}

/** Whether `args` parse, with `--json`. */
function wantsJson(args: readonly string[]): boolean {
  const parsed = parseGateArgs(args);
  return !("error" in parsed) && parsed.json;
}

/**
 * The gate in this process: `codeGateCommand`'s work, its report written to
 * `io.stdout`. What must wait for the report goes to `afterReport` (D17.5).
 */
async function gate(
  args: readonly string[],
  io: CliIo,
  adapters: GateAdapters,
  afterReport: (() => Promise<void>)[],
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
  // D14.1: the scope at the base, and `--group`; a name no test group has there is a usage error.
  const scope = resolveScope(policy.scope, parsed.groups ?? []);
  if ("error" in scope) return fail(scope.error, true);
  const durationsMs: Partial<Record<GateRunner, number>> = {};
  // D17: the stored durations, for the estimate and the order.
  const durations = storedDurations(root);
  const note = (text: string) => io.stderr(`squeal code: ${text}\n`);
  const logs = runLogKeeper(root, { note });
  const collected = await collectWithStores(
    root,
    io.env ?? process.env,
    changed,
    {
      tests,
      budgetSeconds: parsed.budgetSeconds,
      adapters: timed(adapters, durationsMs),
      note,
      ...fromBase(policy),
      scope,
      // D15: a `prepare` command's output goes to stderr.
      output: io.stderr,
      // D14.4: the selection on stderr, after it and before the first run.
      ...preRunOptions(changed, policy, io.stderr),
      // D17.1: the estimate on stderr, after the stored lookup and before the first run.
      ...(durations === null ? {} : { durations: durations.of }),
      // Rows 020-45, 020-46: over what is left, one rerun command with a fitted --timeout.
      ...estimateOptions(parsed, io),
      // Row 020-43: a file still running past its estimate, named once on stderr.
      overran: (file) => io.stderr(overrunText(file)),
      // #197: a run with a failed or unfinished file keeps its log where a daemon keeps its runs'.
      keepLog: logs.keep,
    },
    parts,
  )
    .catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))))
    .finally(() => durations?.close());
  // D1: a configured runner that cannot start, or no coverage provider, is a setup error.
  if (collected instanceof Error) {
    return fail(collected.message, collected instanceof CollectUsageError);
  }
  // D17.5: the completed files are kept once the report is out, so a busy store never delays it.
  afterReport.push(collected.keep);
  const { evidence } = collected;
  const createdAt = new Date((io.now ?? Date.now)()).toISOString();
  const times = { createdAt, durationsMs };
  const report = evaluate(changed, evidence, policy, versions(), times, exceptions);
  const json = `${statusCommand(io.env ?? process.env)} code ${[...args.map(shellWord), "--json"].join(" ")}`;
  io.stdout(parsed.json ? `${JSON.stringify(report, null, 2)}\n` : formatGateReport(report, json));
  afterVerdict(report.runs, logs.retention(), io);
  return EXIT[report.verdict];
}

/**
 * What stderr tells after the verdict, so `--json` keeps stdout to the
 * report: why the parts did not give files they hold, one bounded line per
 * reason (row 020-49, #205); then the kept logs (#197).
 */
function afterVerdict(
  runs: readonly GateRunReport[],
  retention: LogRetention | null,
  io: CliIo,
): void {
  const refused = refusedText(runs);
  if (refused !== "") io.stderr(refused);
  const kept = keptLogsLine(runs, retention);
  if (kept !== null) io.stderr(kept);
}

/** The collector's options read at the base, as the limits are (D6). */
function fromBase(policy: BasePolicy): Pick<CollectOptions, "children" | "inputs" | "prepares"> {
  return {
    // D12.1: how the runs collect.
    children: policy.children,
    // D3.1 (row 020-35): the declared inputs select too, as the daemon re-runs them.
    ...(policy.inputs === undefined ? {} : { inputs: policy.inputs }),
    // D15: the node:test `prepare` commands.
    ...(policy.prepares === undefined ? {} : { prepares: policy.prepares }),
  };
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
