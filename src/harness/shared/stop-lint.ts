import { codeSeenUpTo } from "../../core/delivery/code-since.js";
import { SQUEAL_COMMAND } from "../../core/delivery/index.js";
import { readLintNews } from "../../core/lint/surface/deliver.js";
import { lintSubject } from "../../core/lint/surface/format.js";
import { lintStop } from "../../core/lint/surface/report.js";
import { type LintStoreSource, lintStoreSource } from "../../core/lint/surface/source.js";
import type { RequiredLint, StopRequired } from "../../core/state/required.js";
import { listPaths, plural } from "../../core/text.js";
import type { EpochMs } from "../../core/types/index.js";
import type { LintStopFile } from "../../core/types/lint-delivery.js";
import type { HookContext } from "./context.js";
import { stopGroupWords } from "./stop-text.js";
import { listNames } from "./text.js";

/** The lint store a hook reads: the context's, else the worktree's by its own policy. */
export const lintSourceOf = (context: HookContext): LintStoreSource =>
  context.lint ?? lintStoreSource(context.commonDir, context.root);

/** The files `lint.blocking` counts at Stop (`lintStop`), those of `only` tools when given. */
function wentToFailLint(
  context: HookContext,
  only?: (file: LintStopFile) => boolean,
): readonly LintStopFile[] {
  const since = codeSeenUpTo(context.store, context.consumer);
  const evidence = lintStop(lintSourceOf(context), context.consumer.worktreeId, since);
  const files = evidence?.files ?? [];
  return only === undefined ? files : files.filter(only);
}

function blockingReason(files: readonly LintStopFile[], command: string): string[] {
  if (files.length === 0) return [];
  const named = files.map((f) =>
    f.findings === null ? f.path : `${f.path} (${plural(f.findings, "finding")})`,
  );
  return [
    `Squeal policy lint.blocking is on and ${plural(named.length, "file")} went to fail lint ` +
      `since this session started: ${listPaths(named)}. \`${command} lint --changed\` lists them.`,
  ];
}

/**
 * Spec 017 D8 Blocking: with `lint.blocking` on, Stop's completion check
 * (011 C8) also counts each file that went to `fail` in the consumer's own
 * revisions and fails at its current key, as 015 D7 does for complexity;
 * one failing at registration, pending, stale or unknown never blocks.
 * A lint failure never denies a tool call and never counts in `Known
 * failures`. No reason while lint or its key is off, or none went to fail.
 * The tools of the lint groups `required` names are left out: their
 * failures are a hold within `stop.maxHolds` (`requiredLintBlocking`,
 * review 0.1.406 B2).
 */
export function lintStopReasons(
  context: HookContext,
  command: string = SQUEAL_COMMAND,
  required: StopRequired | null = null,
): string[] {
  const other = (f: LintStopFile) => required?.lintGroupOf(f.tool ?? "eslint") == null;
  return blockingReason(wentToFailLint(context, other), command);
}

/**
 * Row 019-45 (spec 019 D4 step 3): the `lint.blocking` reason for the lint
 * groups Stop waits for, which either entry holds for while the turn's
 * holds (`stop.maxHolds`) last, once no required check is open
 * (`requiredStep`, review 0.1.406-r2 B2-R1); empty with none.
 */
export function requiredLintBlocking(
  context: HookContext,
  required: StopRequired,
  command: string = SQUEAL_COMMAND,
): string[] {
  if (required.lintGroups.length === 0) return [];
  const files = wentToFailLint(context, (f) => required.lintGroupOf(f.tool ?? "eslint") !== null);
  return blockingReason(files, command);
}

/** A lint group Stop waits for, with the checks of it named in a reason. */
interface LintGroupChecks {
  readonly group: string;
  readonly names: readonly string[];
}

/**
 * Row 019-45 (017 D8 At Stop): the files of the lint groups Stop waits for
 * whose `FAIL lint` change the consumer was not told, by group: read only,
 * the delivery after the hold tells them. Every untold change counts, not
 * only those the delivery lists (review 0.1.406 B3): another group's tool
 * may fill that list. Empty with none.
 */
export function untoldLintFails(
  context: HookContext,
  required: StopRequired,
  at: EpochMs,
): readonly LintGroupChecks[] {
  if (required.lintGroups.length === 0) return [];
  const { store, consumer } = context;
  const read = readLintNews(lintSourceOf(context), consumer, at, () =>
    codeSeenUpTo(store, consumer),
  );
  const fails = (read?.untold ?? []).flatMap((entry) => {
    const group = required.lintGroupOf(entry.tool ?? "eslint");
    const fail = entry.kind !== "fail-to-pass" && entry.kind !== "removed";
    return group !== null && fail ? [{ group, name: lintSubject(entry) }] : [];
  });
  return byGroup(fails);
}

function byGroup(checks: readonly { group: string; name: string }[]): LintGroupChecks[] {
  return [...new Set(checks.map((c) => c.group))].map((group) => ({
    group,
    names: checks.filter((c) => c.group === group).map((c) => c.name),
  }));
}

/** `open` by group, each check named as a `FAIL lint` line names it. */
function openByGroup(open: readonly RequiredLint[]): LintGroupChecks[] {
  return byGroup(
    open.map(({ group, tool, path }) => ({
      group,
      name: lintSubject(tool === "eslint" ? { path } : { path, tool }),
    })),
  );
}

/**
 * Row 019-45: the hold of a lint group at `stop` that linted with
 * findings not yet told, a line per group: "Squeal policy checks puts the
 * lint group at stop and the lint group ran at revision 3: 1 file has
 * lint findings: src/a.ts."
 */
export function lintFindingsReason(revision: number, fails: readonly LintGroupChecks[]): string {
  return fails
    .map(({ group, names }) => {
      const words = stopGroupWords(group, SQUEAL_COMMAND);
      const verb = names.length === 1 ? "has" : "have";
      return (
        `${words.policy} and ${words.ran} ran at revision ${revision}: ` +
        `${plural(names.length, "file")} ${verb} lint findings: ${listNames(names)}.`
      );
    })
    .join("\n");
}

/**
 * Row 019-45: the 2 s entry's hold for lint checks Stop requires that are
 * not linted, a line per group; with `waitedMs`, the waiting entry's at its
 * bound. The group's run command runs them now.
 */
export function lintOpenReason(
  revision: number,
  open: readonly RequiredLint[],
  command: string = SQUEAL_COMMAND,
  waitedMs?: number,
): string {
  return openByGroup(open)
    .map(({ group, names }) => {
      const words = stopGroupWords(group, command);
      const verb = names.length === 1 ? "is" : "are";
      const checks = plural(names.length, "lint check");
      const list = `${listNames(names)}.`;
      if (waitedMs === undefined) {
        return `${words.policy} and ${checks} ${verb} not linted at revision ${revision}: ${list} ${words.run} runs them and waits for their results.`;
      }
      const waited = `${(waitedMs / 1_000).toFixed(waitedMs % 1_000 === 0 ? 0 : 1)} s`;
      return `${words.policy} and after ${waited} ${checks} ${verb} still not linted at revision ${revision}: ${list} ${words.run} waits for their results.`;
    })
    .join("\n");
}

/** The waiting entry's lint reasons to hold, and the lint groups they name. */
export interface LintHold {
  readonly reasons: readonly string[];
  readonly groups: readonly string[];
}

/**
 * Row 019-45 (spec 019 D4, 017 D8): once the lint groups Stop waits for
 * are linted, the waiting entry's reasons to hold for them: their findings
 * the consumer was not told, and with `lint.blocking` their files gone to
 * fail since the session started (`requiredLintBlocking`).
 */
export function requiredLintHold(
  context: HookContext,
  required: StopRequired,
  { revision, at, command }: { revision: number; at: EpochMs; command: string | undefined },
): LintHold {
  const fails = untoldLintFails(context, required, at);
  const blocking = requiredLintBlocking(context, required, command);
  const reasons = [
    ...(fails.length === 0 ? [] : [lintFindingsReason(revision, fails)]),
    ...blocking,
  ];
  const groups = fails.map((f) => f.group);
  // `lint.blocking` names no group: every lint group Stop waits for may hold its files.
  return { reasons, groups: blocking.length === 0 ? groups : required.lintGroups };
}
