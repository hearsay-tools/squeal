import type { KeyInputs } from "../lint/pass/keys.js";
import type { RelativePath } from "../types/common.js";
import type { FileHash } from "../types/keys.js";
import type { LintKnownState, LintTool } from "../types/lint.js";
import type { CommitLintCounts, CommitLintToolCounts } from "./report.js";

/*
 * Spec 019 D5 step 2 for lint: the pure count of a commit's lint checks,
 * from what the lint store says (`LintView`) and what the commit says
 * (`CommitSide`). `lint.ts` reads the store for it.
 */

/** What the lint store says of one worktree's lint checks, for one commit. */
export interface LintView {
  readonly states: readonly LintKnownState[];
  /** True for a whole-program check: its key reads every program file (017 D5). */
  wholeProgram(state: LintKnownState): boolean;
  /**
   * Row 019-28: true when the whole-program keys of the check's tool hold
   * the bytes of `path`: a module file or one the tool lints (`holdsBlob`
   * with the extensions its program recorded).
   */
  segmentHolds(state: LintKnownState, path: RelativePath): boolean;
  /** The findings of a check's judged result; `null` when that result is not stored. */
  findings(state: LintKnownState): number | null;
  /**
   * What the keys of the check's tool were made of beside each file's own
   * bytes (row 019-21); `null` when the lint pass recorded none for its
   * cursor.
   */
  inputs(state: LintKnownState): KeyInputs | null;
}

/** What the commit says beside its blobs. */
export interface CommitSide {
  readonly committed: ReadonlyMap<RelativePath, FileHash>;
  /**
   * Row 019-28: the paths the commit changed (`changedPaths`); only the
   * checks of those the commit holds count.
   */
  readonly changed: ReadonlySet<RelativePath>;
  /** The paths whose working-tree file is not the commit's (`differingPaths`). */
  readonly differing: ReadonlySet<RelativePath>;
  /**
   * True when one of `differing` is an environment input of the worktree's
   * tests (`environmentDiffers`): an installed lockfile and its patches are
   * among them, and they move the install fingerprint a lint key may hold.
   */
  readonly environment: boolean;
}

/** Whether keys made of `inputs` are the commit's: each blob is the committed one. */
function commitsInputs(inputs: KeyInputs | null, side: CommitSide): boolean {
  if (inputs === null || (inputs.installed && side.environment)) return false;
  return inputs.files.every(([path, blob]) => (side.committed.get(path) ?? null) === blob);
}

/**
 * Row 019-13 slice 2 (spec 019 D5 step 2), file-local only, with row 019-21
 * (review 0.1.396 B2): a lint check is the commit's when it is judged, not
 * stale and not `unknown`, at the committed blob of its file, and the
 * config files and their closure its tool's keys were made of are each the
 * committed blob (`LintView.inputs`); its findings then count. Inputs not
 * recorded are no evidence. A whole-program check is not determined while
 * a path whose bytes its keys hold (`segmentHolds`) differs between the
 * commit and the working tree; with none, the program is the commit's. A
 * check pending at a file that does not differ, under the commit's inputs,
 * is still running; any other check is not determined, as is a failure
 * whose findings are not stored. Row 019-28 (lessons P4): only the checks
 * of the files the commit changed and holds count (`CommitSide.changed`).
 */
export function lintCounts(view: LintView, side: CommitSide): CommitLintCounts {
  return lintTally(view, side, () => false).counts;
}

/** The counts of one report's lint checks, and those it counts as running. */
export interface LintTally {
  readonly counts: CommitLintCounts;
  readonly running: readonly LintKnownState[];
}

/**
 * `lintCounts`, and the checks counted as running. A pending check that
 * waits for a commit or a request none gave it (`held`, row 019-22) runs
 * for no one: it is not determined.
 */
export function lintTally(
  view: LintView,
  side: CommitSide,
  held: (state: LintKnownState) => boolean,
): LintTally {
  const { committed, differing, changed } = side;
  const counts = { findings: 0, notDetermined: 0, running: 0 };
  const tools = new Map<LintTool, Tally>();
  const running: LintKnownState[] = [];
  const verdicts = new Map<KeyInputs | null, boolean>();
  const ownInputs = (state: LintKnownState) => {
    const inputs = view.inputs(state);
    let verdict = verdicts.get(inputs);
    if (verdict === undefined) {
      verdict = commitsInputs(inputs, side);
      verdicts.set(inputs, verdict);
    }
    return verdict;
  };
  const programs = new Map<LintKnownState["check"]["tool"], boolean>();
  const programDiffers = (state: LintKnownState) => {
    const { tool } = state.check;
    let verdict = programs.get(tool);
    if (verdict === undefined) {
      verdict = [...differing].some((path) => view.segmentHolds(state, path));
      programs.set(tool, verdict);
    }
    return verdict;
  };
  for (const state of view.states) {
    const { path } = state.check;
    if (!changed.has(path) || !committed.has(path)) continue;
    const tool = tallyOf(tools, state.check.tool);
    tool.files += 1;
    if (state.outcome === "pending" && !differing.has(path) && ownInputs(state) && !held(state)) {
      counts.running += 1;
      tool.running += 1;
      running.push(state);
      continue;
    }
    const judged = state.judged;
    const own =
      judged !== null &&
      !state.stale &&
      state.outcome !== "unknown" &&
      state.outcome !== "pending" &&
      judged.blob === (committed.get(path) ?? null) &&
      ownInputs(state);
    const found = own && judged.outcome === "fail" ? view.findings(state) : 0;
    if (!own || (view.wholeProgram(state) && programDiffers(state)) || found === null) {
      counts.notDetermined += 1;
      tool.notDetermined += 1;
      continue;
    }
    counts.findings += found;
    tool.findings += found;
  }
  const checked = [...tools.values()].sort((a, b) => (a.tool < b.tool ? -1 : 1));
  return { counts: { ...counts, tools: checked }, running };
}

type Tally = { -readonly [K in keyof CommitLintToolCounts]: CommitLintToolCounts[K] };

/** The tally of `tool` in `tools`, made empty on first use. */
function tallyOf(tools: Map<LintTool, Tally>, tool: LintTool): Tally {
  let own = tools.get(tool);
  if (own === undefined) {
    own = { tool, files: 0, findings: 0, notDetermined: 0, running: 0 };
    tools.set(tool, own);
  }
  return own;
}

/**
 * Review 0.1.570 B1: per tool of `behind` (its pass has not keyed the
 * report's revision), the paths the commit changed and holds with no check
 * of that tool. The pass has not said whether it lints them.
 */
export function unlistedPaths(
  states: readonly LintKnownState[],
  side: CommitSide,
  behind: readonly LintTool[],
): Map<LintTool, RelativePath[]> {
  const unlisted = new Map<LintTool, RelativePath[]>();
  for (const tool of behind) {
    const known = new Set(states.filter((s) => s.check.tool === tool).map((s) => s.check.path));
    const paths = [...side.changed].filter((p) => side.committed.has(p) && !known.has(p)).sort();
    if (paths.length > 0) unlisted.set(tool, paths);
  }
  return unlisted;
}

/** `counts` with each tool's `unlisted` count; a tool with none counted gains a part. */
export function withUnlisted(
  counts: CommitLintCounts,
  unlisted: ReadonlyMap<LintTool, readonly RelativePath[]>,
): CommitLintCounts {
  if (unlisted.size === 0) return counts;
  const tools = new Map((counts.tools ?? []).map((t) => [t.tool, t] as const));
  for (const [tool, paths] of unlisted) {
    const own = tools.get(tool) ?? { tool, files: 0, findings: 0, notDetermined: 0, running: 0 };
    tools.set(tool, { ...own, unlisted: paths.length });
  }
  const sorted = [...tools.values()].sort((a, b) => (a.tool < b.tool ? -1 : 1));
  return { ...counts, tools: sorted };
}
