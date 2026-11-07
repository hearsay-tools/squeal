import { SQUEAL_COMMAND } from "../../core/delivery/format.js";
import { formatCheck } from "../../core/state/check-name.js";
import { runnerPartText } from "../../core/state/header.js";
import type { PendingBefore } from "../../core/state/required.js";
import { openGroups, type RequiredFile } from "../../core/state/required.js";
import { plural } from "../../core/text.js";
import type { TestFileRef } from "../../core/types/keys.js";
import { SLOW_GROUP } from "../../core/types/scheduler.js";
import type { KnownFailure } from "../../core/types/status.js";
import { listNames } from "./text.js";

/*
 * Stop's block and hold reasons for the groups it waits for (spec 004 D7,
 * D9; 019 D4, D6), moved from `text.ts` by row 019-30. Wording is factual,
 * never imperative (spec 001 D6).
 */

/**
 * How a Stop reason names a group Stop waits for (spec 019 D4's last
 * paragraph, D6; row 019-23): the default `slow` group in today's words,
 * `stop.requireSlowSuite` and `run --slow --wait` (004 D7, D9); a
 * configured group at `stop` by its name and `run <group> --wait`.
 */
interface StopGroupWords {
  /** The policy that makes Stop wait, as the reason's first words. */
  readonly policy: string;
  /** One of the group's test files. */
  readonly file: string;
  /** The command that runs the group and waits for it, quoted. */
  readonly run: string;
  /** What ran: the slow tier, or the group. */
  readonly ran: string;
}

export function stopGroupWords(group: string, command: string): StopGroupWords {
  if (group === SLOW_GROUP) {
    return {
      policy: "Squeal policy stop.requireSlowSuite is on",
      file: "slow test file",
      run: `\`${command} run --slow --wait\``,
      ran: "the slow tier",
    };
  }
  return {
    policy: `Squeal policy checks puts the ${group} group at stop`,
    file: `${group} test file`,
    run: `\`${command} run ${group} --wait\``,
    ran: `the ${group} group`,
  };
}

/**
 * Spec 004 D7: the block reason of `stop.requireSlowSuite`, naming the slow
 * test files not current at `revision` and that `run --slow --wait` runs them
 * and waits for them (001-282). Spec 019 D4: for a configured `group` at
 * `stop`, its files and `run <group> --wait` (row 019-23). `command` is how
 * the reason names the CLI.
 */
export function slowSuiteReason(
  revision: number,
  files: readonly TestFileRef[],
  command: string = SQUEAL_COMMAND,
  group: string = SLOW_GROUP,
): string {
  const words = stopGroupWords(group, command);
  const verb = files.length === 1 ? "is" : "are";
  return (
    `${words.policy} and ${plural(files.length, words.file)} ` +
    `${verb} not current at revision ${revision}: ${listNames(files.map((f) => f.path))}. ` +
    `${words.run} runs them and waits for their results.`
  );
}

/**
 * Spec 004 D9 as amended 2026-10-12: the block of a Stop that waited
 * `waitedMs` for its slow files and found `files` still not current, or
 * with `refining` the runner part of `revision` still pending (task 001-295).
 * Spec 019 D4: the same for a configured `group` at `stop` (row 019-23).
 */
export function slowWaitReason(
  revision: number,
  files: readonly TestFileRef[],
  waitedMs: number,
  command: string = SQUEAL_COMMAND,
  refining = false,
  group: string = SLOW_GROUP,
  before: readonly PendingBefore[] = [],
): string {
  const words = stopGroupWords(group, command);
  const after = `${words.policy} and after ${seconds(waitedMs)} `;
  const wait = `${words.run} waits for their results.`;
  // Task 001-295 (review wave 13am, B2): an unfinished listing may still add the group's files.
  const unlisted = `${runnerPartText(revision)} is still pending: ${words.file}s it adds are not listed yet.`;
  if (files.length === 0) return `${after}${unlisted} ${wait}`;
  const verb = files.length === 1 ? "is" : "are";
  const more = refining ? ` ${unlisted.charAt(0).toUpperCase()}${unlisted.slice(1)}` : "";
  return (
    `${after}${plural(files.length, words.file)} ${verb} still not current at revision ${revision}: ` +
    `${listNames(files.map((f) => f.path))}.${notStartedText(before)}${more} ${wait}`
  );
}

/**
 * Row 019-30 (lessons P5, option a): why the files a Stop waited for have
 * not started, as a sentence after their list: ` They have not started:
 * they run after the unit group, which has 872 test files pending.` Empty
 * with no group named.
 */
function notStartedText(before: readonly PendingBefore[]): string {
  if (before.length === 0) return "";
  const names = before.map((b) => b.group);
  const counts = before.map((b) => String(b.pending));
  const files = before.length === 1 && before[0]?.pending === 1 ? "test file" : "test files";
  const which = before.length === 1 ? "which has" : "which have";
  return (
    ` They have not started: they run after ${groupsText(names)}, ` +
    `${which} ${andList(counts)} ${files} pending.`
  );
}

/**
 * Row 019-30 (lessons P6): the line of a hold that spends the turn's last
 * one, after its reasons, naming the command of each group it held for:
 * "This is Stop's last hold this turn: no later Stop in it waits for the
 * e2e group, and `squeal run e2e --wait` runs it and waits for its
 * results."
 */
export function lastHoldText(groups: readonly string[], command: string = SQUEAL_COMMAND): string {
  const words = groups.map((group) => stopGroupWords(group, command));
  const one = words.length === 1;
  const runs = `${andList(words.map((w) => w.run))} ${one ? "runs it" : "run them"}`;
  return (
    `This is Stop's last hold this turn: no later Stop in it waits for ` +
    `${andList(words.map((w) => w.ran))}, and ${runs} and ${one ? "waits" : "wait"} for ` +
    `${one ? "its" : "their"} results.`
  );
}

/** `reason`, and with `last` the line of the turn's last hold for `groups` (row 019-30). */
export function withLastHold(
  reason: string,
  groups: readonly string[],
  command: string | undefined,
  last: boolean,
): string {
  return last ? `${reason}\n${lastHoldText(groups, command)}` : reason;
}

/** `the unit group`, `the unit and api groups`. */
function groupsText(names: readonly string[]): string {
  return `the ${andList(names)} ${names.length === 1 ? "group" : "groups"}`;
}

/** `a`, `a and b`, `a, b and c`. */
function andList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/**
 * Spec 004 D9 as amended 2026-10-12: the block of a Stop whose slow files,
 * waited for, became current at `revision` with `failures`. Spec 019 D4: a
 * configured `group` at `stop` is named as the one that ran (row 019-23).
 */
export function slowFailuresReason(
  revision: number,
  failures: readonly KnownFailure[],
  group: string = SLOW_GROUP,
): string {
  const words = stopGroupWords(group, SQUEAL_COMMAND);
  const verb = failures.length === 1 ? "fails" : "fail";
  return (
    `${words.policy} and ${words.ran} ran at revision ${revision}: ` +
    `${plural(failures.length, "check")} ${verb}: ${listNames(failures.map((f) => formatCheck(f.check)))}.`
  );
}

/**
 * Row 019-23 (spec 019 D4): the 2 s entry's block for the required files
 * not current, a line per group in the order of its first file.
 */
export function requiredSuiteReason(
  revision: number,
  open: readonly RequiredFile[],
  command?: string,
): string {
  return openGroups(open)
    .map((group) => slowSuiteReason(revision, filesOf(open, group), command, group))
    .join("\n");
}

/**
 * Review 0.1.406-r2 B2-R1: the 2 s entry's hold while the runner part of
 * `revision` is pending and no required file is open, a line per group Stop
 * waits for (`groups`): it may add files to any of them.
 */
export function requiredUnlistedReason(
  revision: number,
  groups: readonly string[],
  command: string = SQUEAL_COMMAND,
): string {
  return groups
    .map((group) => {
      const words = stopGroupWords(group, command);
      return (
        `${words.policy} and ${runnerPartText(revision)} is still pending: ` +
        `${words.file}s it adds are not listed yet. ${words.run} runs them and waits for their results.`
      );
    })
    .join("\n");
}

/**
 * Row 019-23: the waiting entry's block at its bound, a line per group with
 * a required file not current. With none, only the runner part pending, a
 * line per group Stop waits for (`groups`): it may add files to any of them.
 */
export function requiredWaitReason(
  revision: number,
  open: readonly RequiredFile[],
  groups: readonly string[],
  wait: {
    readonly waitedMs: number;
    readonly command: string | undefined;
    readonly refining: boolean;
    /** Row 019-30: the groups a group follows that have files pending (`pendingBefore`). */
    readonly before?: (group: string) => readonly PendingBefore[];
  },
): string {
  return (open.length === 0 ? groups : openGroups(open))
    .map((group) =>
      slowWaitReason(
        revision,
        filesOf(open, group),
        wait.waitedMs,
        wait.command,
        wait.refining,
        group,
        wait.before?.(group),
      ),
    )
    .join("\n");
}

/**
 * Row 019-23: the waiting entry's block on required checks that failed, a
 * line per group in the order of its first failure. `groupOf` gives a
 * required check's group.
 */
export function requiredFailuresReason(
  revision: number,
  failed: readonly KnownFailure[],
  groupOf: (failure: KnownFailure) => string,
): string {
  return [...new Set(failed.map(groupOf))]
    .map((group) =>
      slowFailuresReason(
        revision,
        failed.filter((f) => groupOf(f) === group),
        group,
      ),
    )
    .join("\n");
}

function filesOf(open: readonly RequiredFile[], group: string): TestFileRef[] {
  return open.filter((file) => file.group === group).map((file) => file.ref);
}

/** Seconds, with a tenth unless whole, as a wait is named. */
function seconds(ms: number): string {
  return `${(ms / 1_000).toFixed(ms % 1_000 === 0 ? 0 : 1)} s`;
}
