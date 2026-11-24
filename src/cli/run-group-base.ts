import { mergeBase } from "../core/code/gate/changed.js";
import { compare } from "../core/fs/compare.js";
import { runGit, splitNul } from "../core/fs/git.js";
import { readStatus } from "../core/status/snapshot.js";
import { plural } from "../core/text.js";
import type { ResolvedGroup } from "../core/types/check-groups.js";
import type { AbsolutePath, RelativePath } from "../core/types/common.js";
import { daemonSocket } from "./daemon-access.js";
import type { CliIo } from "./main.js";
import { type NarrowTaken, narrowAnswer, requestNarrow } from "./run-group-narrow.js";
import { groupVerdictLine } from "./run-group-wait.js";
import {
  lintGroupVerdictLine,
  lintRequestedText,
  requestLintGroup,
  runLintGroupCommand,
} from "./run-lint-group.js";
import { statusCommand } from "./status-command.js";
import { socketBound } from "./wait/socket.js";
import { runWait } from "./wait/wait.js";

/*
 * Spec 026 D4 (row 026-07): `squeal run <group> --base <ref> [--wait [<ms>]]
 * [--json]`, the narrow pre-PR run. The paths changed since `git merge-base
 * <ref> HEAD` (the branch's commits, staged, unstaged and untracked files
 * git does not ignore, as 020 D2) go to 019 D6's narrow run for a test
 * group; a lint group lints its pending checks, the changed files' among
 * them. The answer names the merge base, the changed paths, the selection
 * and its verdict, the group's files it left out and the paths that select
 * nothing. It never makes the group current.
 */

/** How long to wait for the scheduler to take the request without `--wait`. */
const RECORD_WAIT_MS = 10_000;

/** The paths changed since the merge base of `ref` and `HEAD`. */
export interface BaseChanges {
  readonly ref: string;
  readonly mergeBase: string;
  /** Root-relative, sorted, each once; deleted paths included. */
  readonly paths: readonly RelativePath[];
}

/**
 * `git merge-base <ref> HEAD`, then `git diff --name-only <base>` (renames
 * as a removal and an addition) and the untracked files git does not
 * ignore. Throws when `ref` names no commit or has no common commit with
 * `HEAD` (`BaseRefError`), or when git fails.
 */
export async function baseChanges(root: AbsolutePath, ref: string): Promise<BaseChanges> {
  const base = await mergeBase(root, ref);
  const [diff, untracked] = await Promise.all([
    runGit(root, ["diff", "--name-only", "--no-renames", "--ignore-submodules=all", "-z", base]),
    runGit(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  const paths = [...new Set([...splitNul(diff), ...splitNul(untracked)])].sort(compare);
  return { ref, mergeBase: base, paths: paths as RelativePath[] };
}

/** One `squeal run <group> --base <ref>`. */
export interface BaseRun {
  readonly root: AbsolutePath;
  readonly group: ResolvedGroup;
  readonly ref: string;
  /** `null` without `--wait`; `Infinity` for a bare `--wait`. */
  readonly waitMs: number | null;
  readonly json: boolean;
}

/**
 * Exit codes as `run <group> [<path>...]`: without `--wait` 0 once the
 * daemon took the request, 1 when it did not; with `--wait` 0 when the
 * selection is current with no known failure, 1 with one, 3 with no
 * verdict, also when nothing changed or nothing is selected. 2 when the
 * ref names no merge base (the git error named).
 */
export async function runBaseCommand(
  run: BaseRun,
  io: CliIo,
  usageError: (problem: string) => number,
): Promise<number> {
  const { root, group, ref, waitMs, json } = run;
  let changes: BaseChanges;
  try {
    changes = await baseChanges(root, ref);
  } catch (error) {
    return usageError(`--base ${ref}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const head = baseHead(changes);
  if (changes.paths.length === 0) {
    const code = waitMs === null ? 0 : 3;
    if (json) io.stdout(jsonLine(baseJson(group, changes, { verdict: null, code })));
    else io.stdout(`${head}: nothing to run.\n`);
    return code;
  }
  if (group.select.kind === "lint") {
    if (json) return lintJson(run, changes, io);
    io.stdout(`${head}; group ${group.name} lints its pending lint checks, these among them.\n`);
    return runLintGroupCommand({ root, group, waitMs }, io);
  }
  const asked = await requestNarrow({ root, group, paths: changes.paths, waitMs });
  if (!json) return narrowAnswer(asked, { group, waitMs, base: `${head}.\n` }, io);
  if ("problem" in asked) {
    const code = waitMs === null ? 1 : 3;
    io.stdout(jsonLine(baseJson(group, changes, { verdict: null, code, problem: asked.problem })));
    return code;
  }
  if ("pending" in asked) {
    const code = waitMs === null ? 0 : 3;
    const { requestId } = asked.pending;
    io.stdout(jsonLine(baseJson(group, changes, { verdict: null, code, pending: requestId })));
    return code;
  }
  return testJson(run, changes, asked.taken, io);
}

/** `Changes since <sha> (merge base of <ref> and HEAD): <n> changed paths`. */
function baseHead({ ref, mergeBase: base, paths }: BaseChanges): string {
  return `Changes since ${base.slice(0, 12)} (merge base of ${ref} and HEAD): ${plural(paths.length, "changed path")}`;
}

const jsonLine = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** The fields every `--json` answer carries. */
function baseJson(
  group: ResolvedGroup,
  { ref, mergeBase: base, paths }: BaseChanges,
  rest: Record<string, unknown>,
) {
  return {
    group: group.name,
    kind: group.select.kind === "lint" ? "lint" : "test",
    ref,
    mergeBase: base,
    changedPaths: paths,
    // D4.4: a narrow run never makes the group current.
    wholeGroup: false,
    ...rest,
  };
}

/** A test group's `--json` answer, after the wait with `--wait`. */
async function testJson(
  { root, group, waitMs }: BaseRun,
  changes: BaseChanges,
  taken: NarrowTaken,
  io: CliIo,
): Promise<number> {
  const { narrow, requested, covered } = taken;
  const command = statusCommand(io.env ?? process.env);
  let verdict: { line: string; code: number } | null = null;
  let code: number = waitMs === null ? 0 : 3;
  if (waitMs !== null && narrow.selected.length > 0) {
    const { socketPath, deadline, files } = taken;
    const outcome = await runWait({ wait: "group", root, socketPath, deadline, files });
    const wait = {
      root,
      socketPath,
      group: group.name,
      queued: requested.queued,
      deadline,
      line: "",
      files,
      narrow: { unmatched: narrow.unmatched },
    };
    const [line, result] = groupVerdictLine(wait, outcome, command);
    verdict = { line: `Selected test files of group ${group.name} ${line}`, code: result };
    code = result;
  }
  const states = new Map(covered?.files.map((file) => [file.testFile.path, file]) ?? []);
  const failing = waitMs === null ? null : failingFiles(root);
  const selected = narrow.selected.map((testFile) => {
    const file = states.get(testFile.path);
    const notRun = narrow.notRun.find((entry) => entry.testFile.path === testFile.path);
    return {
      path: testFile.path,
      project: testFile.project,
      // `current`: its stored or imported result counts; `queued`: this run runs it.
      state: notRun !== undefined ? "not-run" : (file?.state ?? null),
      ...(notRun === undefined ? {} : { reason: notRun.reason }),
      ...(failing === null ? {} : { failed: failing.has(testFile.path) }),
    };
  });
  const omitted = narrow.reached;
  const note =
    omitted === 0
      ? `A narrow run: group ${group.name} is not current as a whole; \`${command} run ${group.name}\` or CI runs it.`
      : `${plural(omitted, "other test file")} of group ${group.name} ${omitted === 1 ? "reads" : "read"} these paths and ${omitted === 1 ? "was" : "were"} not run here; ${omitted === 1 ? "it waits" : "they wait"} for \`${command} run ${group.name}\` or CI.`;
  const json = baseJson(group, changes, {
    revision: requested.revision,
    selected,
    current: narrow.current,
    queued: requested.queued,
    omitted,
    others: narrow.others,
    unmatched: narrow.unmatched,
    verdict,
    code,
    note,
  });
  io.stdout(jsonLine(json));
  return code;
}

/** The test paths with a known failure, from status; `null` when status cannot be read. */
function failingFiles(root: AbsolutePath): Set<string> | null {
  const status = readStatus(root);
  if (!("knownFailures" in status)) return null;
  return new Set(
    status.knownFailures.flatMap(({ check }) => ("testPath" in check ? [check.testPath] : [])),
  );
}

/** A lint group's `--json` answer: the group's pending checks, linted now. */
async function lintJson(
  { root, group, waitMs }: BaseRun,
  changes: BaseChanges,
  io: CliIo,
): Promise<number> {
  const deadline = Date.now() + (waitMs ?? RECORD_WAIT_MS);
  const socketPath = await daemonSocket(root, socketBound(deadline));
  const state = await requestLintGroup(root, socketPath, group.name, deadline);
  const note = `Group ${group.name} lints its pending lint checks, the changed paths' among them; a check current at its key keeps its result.`;
  if (typeof state === "string") {
    const code = waitMs === null ? 1 : 3;
    io.stdout(jsonLine(baseJson(group, changes, { verdict: null, code, problem: state, note })));
    return code;
  }
  const requested = { revision: state.revision, queued: state.queued };
  let verdict: { line: string; code: number } | null = null;
  if (waitMs !== null) {
    const files = { kind: "group", group: group.name } as const;
    const outcome = await runWait({ wait: "lint group", root, socketPath, deadline, files });
    const command = statusCommand(io.env ?? process.env);
    const [line, code] = lintGroupVerdictLine(outcome, group, command);
    verdict = { line: `Group ${group.name} ${line}`, code };
  }
  const code = verdict?.code ?? 0;
  const line = lintRequestedText(group.name, state).trimEnd();
  io.stdout(jsonLine(baseJson(group, changes, { ...requested, line, verdict, code, note })));
  return code;
}
