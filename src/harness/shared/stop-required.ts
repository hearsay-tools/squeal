import { checkIdentity, testFileOf } from "../../core/state/derive.js";
import { sameFingerprint } from "../../core/state/fingerprint.js";
import {
  openGroups,
  pendingBefore,
  type RequiredFile,
  type RequiredLint,
  requiredLintOpen,
  requiredNotCurrent,
  type StopRequired,
} from "../../core/state/required.js";
import type { EpochMs } from "../../core/types/common.js";
import { MAIN_AGENT, type ViewEntry } from "../../core/types/delivery.js";
import type { KnownState } from "../../core/types/state.js";
import type { KnownFailure, StatusHeader } from "../../core/types/status.js";
import type { TestFileKeyRecord } from "../../core/types/store-records.js";
import type { HookContext } from "./context.js";
import { unchangedSinceRegistration } from "./no-edit.js";
import {
  lintOpenReason,
  lintSourceOf,
  requiredLintBlocking,
  requiredLintHold,
} from "./stop-lint.js";
import {
  requiredFailuresReason,
  requiredSuiteReason,
  requiredUnlistedReason,
  requiredWaitReason,
  withLastHold,
} from "./stop-text.js";

/*
 * Review 0.1.406-r2 B2-R1 (spec 019 D4): the one owner of what Stop holds a
 * consumer for, in one turn, for the checks Stop requires. Both entries
 * decide by `requiredStep`, the 2 s entry (`stop-decide.ts`) and the
 * waiting entry (`stop-slow.ts`), in one order: while a required check is
 * open (a test file not current, the runner part pending, a lint check not
 * linted), only that; once none is, the required failures. Each hold counts
 * in the turn's `stop.maxHolds`, whichever entry holds.
 */

/** One read of the store: one revision's states, keys, header and current failures. */
export interface RequiredRead {
  readonly states: readonly KnownState[];
  readonly keys: readonly TestFileKeyRecord[];
  readonly header: StatusHeader;
  readonly current: readonly KnownFailure[];
}

/** The required checks open in one read. */
export interface RequiredOpen {
  /** Test files not current. */
  readonly tests: readonly RequiredFile[];
  /** The runner part that may list more test files is pending while a test group is required. */
  readonly refining: boolean;
  /** Lint checks that wait to lint (row 019-45). */
  readonly lint: readonly RequiredLint[];
}

/** The required checks open in `read`: test files, the runner part and lint checks. */
export function requiredOpen(
  context: HookContext,
  required: StopRequired,
  read: Pick<RequiredRead, "states" | "keys" | "header">,
): RequiredOpen {
  return {
    tests: requiredNotCurrent(read.states, read.keys, required),
    refining: required.groups.length > 0 && read.header.runnerPartPending === true,
    lint: requiredLintOpen(lintSourceOf(context), context.consumer.worktreeId, required),
  };
}

export function isOpen(open: RequiredOpen): boolean {
  return open.tests.length > 0 || open.refining || open.lint.length > 0;
}

/**
 * Each group with a check open, tests' then lint's, once: what a request
 * runs (D4 step 1). A pending runner part alone names none (review 0.1.395, S1).
 */
export function openGroupsOf(open: RequiredOpen): readonly string[] {
  return [...new Set([...openGroups(open.tests), ...open.lint.map((check) => check.group)])];
}

/** A hold's lines and the groups its last-hold line names. */
interface HoldLines {
  readonly reasons: readonly string[];
  readonly groups: readonly string[];
}

/** What Stop holds for: the required checks open, or, once none is, their failures. */
export type RequiredStep =
  | { readonly kind: "open"; readonly open: RequiredOpen }
  | { readonly kind: "failing"; readonly failing: HoldLines };

/**
 * What Stop holds the consumer for, for the checks `required`, from `read`
 * (inside its transaction); `null` for nothing, and always for a main agent
 * whose worktree had no revision since it registered (task 004-67).
 *
 * 1. Open: test files not current or the runner part pending (019 D4 step
 *    1), and lint checks not linted (row 019-45). The waiting entry asks for
 *    and waits for them all at once; the 2 s entry alone names them in one
 *    hold, tests' first.
 * 2. Failing, only once none is open: with `untold` (the waiting entry,
 *    the consumer's view), the required test failures and lint findings not
 *    told; with `lint.blocking`, the required tools' files gone to fail
 *    (017 D8). The 2 s entry passes `null`: its news tells the untold ones
 *    in the same continuation, so only `lint.blocking` holds there.
 */
export function requiredStep(
  context: HookContext,
  required: StopRequired,
  read: RequiredRead,
  options: {
    readonly untold: (() => readonly ViewEntry[]) | null;
    readonly at: EpochMs;
    readonly command: string | undefined;
  },
): RequiredStep | null {
  const { store, consumer } = context;
  if (consumer.agentId === MAIN_AGENT && unchangedSinceRegistration(store, consumer)) return null;
  const open = requiredOpen(context, required, read);
  if (isOpen(open)) return { kind: "open", open };
  const failing = failingLines(context, required, read, options);
  return failing.reasons.length === 0 ? null : { kind: "failing", failing };
}

function failingLines(
  context: HookContext,
  required: StopRequired,
  read: RequiredRead,
  { untold, at, command }: Parameters<typeof requiredStep>[3],
): HoldLines {
  if (untold === null) {
    const reasons = requiredLintBlocking(context, required, command);
    return { reasons, groups: reasons.length === 0 ? [] : required.lintGroups };
  }
  const { revision } = read.header;
  const failed = untoldFailures(read.current, required, untold);
  // `untoldFailures` keeps only required checks, so each failure has a group.
  const groupOf = (f: KnownFailure) => required.groupOf(testFileOf(f.check)) ?? "";
  const tests = failed.length === 0 ? [] : [requiredFailuresReason(revision, failed, groupOf)];
  const lint = requiredLintHold(context, required, { revision, at, command });
  return {
    reasons: [...tests, ...lint.reasons],
    groups: [...new Set([...failed.map(groupOf), ...lint.groups])],
  };
}

/**
 * The current failures of required checks the consumer was not told: its
 * view (`ViewEntry`) holds no failure of the check with this fingerprint, so
 * a delivery now would name it. `views` is read only when a required check
 * fails. Moved from `stop-slow.ts`.
 */
function untoldFailures(
  current: readonly KnownFailure[],
  required: StopRequired,
  views: () => readonly ViewEntry[],
): readonly KnownFailure[] {
  const failed = current.filter((f) => required.groupOf(testFileOf(f.check)) !== null);
  if (failed.length === 0) return failed;
  const told = new Map(views().map((v) => [checkIdentity(v.check), v]));
  return failed.filter((f) => {
    const view = told.get(checkIdentity(f.check));
    return view?.outcome !== "fail" || !sameFingerprint(view.fingerprint, f.fingerprint);
  });
}

/**
 * The reason of a hold for `step`, from the `read` it was decided from: a
 * line per group, tests' first. Open checks: the 2 s entry's words, or with
 * `waitedMs` the waiting entry's at its bound, which with a `checks` key
 * names why a group's files have not started (`pendingBefore`, row 019-30).
 * With `last`, the turn's last hold says so.
 */
export function stepReason(
  step: RequiredStep,
  required: StopRequired,
  read: Pick<RequiredRead, "states" | "keys" | "header">,
  hold: {
    readonly command: string | undefined;
    readonly last: boolean;
    readonly waitedMs?: number;
  },
): string {
  const { command, last, waitedMs } = hold;
  if (step.kind === "failing") {
    return withLastHold(step.failing.reasons.join("\n"), step.failing.groups, command, last);
  }
  const { open } = step;
  const { revision } = read.header;
  const unlisted = open.tests.length === 0 && open.refining;
  const tests = (() => {
    if (open.tests.length === 0 && !open.refining) return [];
    if (waitedMs === undefined) {
      return unlisted
        ? [requiredUnlistedReason(revision, required.groups, command)]
        : [requiredSuiteReason(revision, open.tests, command)];
    }
    const before = (group: string) =>
      pendingBefore(read.states, read.keys, required, group, open.tests);
    const wait = { waitedMs, command, refining: open.refining };
    return [
      requiredWaitReason(revision, open.tests, required.groups, {
        ...wait,
        ...(required.groupTexts ? { before } : {}),
      }),
    ];
  })();
  const lint =
    open.lint.length === 0 ? [] : [lintOpenReason(revision, open.lint, command, waitedMs)];
  const groups = [...new Set([...(unlisted ? required.groups : []), ...openGroupsOf(open)])];
  return withLastHold([...tests, ...lint].join("\n"), groups, command, last);
}
