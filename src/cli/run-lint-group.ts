import { setTimeout as sleep } from "node:timers/promises";
import { heldUntilAsked } from "../core/daemon/check-groups.js";
import { readPolicy } from "../core/daemon/policy.js";
import { GROUP_NOT_SUPPORTED } from "../core/daemon/run-group.js";
import { resolveCommonDir, worktreeIdFor } from "../core/fs/index.js";
import { lintGroupOf, readReleased, waitsToLint } from "../core/lint/pass/commit-entry.js";
import { heldBy } from "../core/lint/pass/moment.js";
import { lintScope } from "../core/lint/pass/records.js";
import { lintStoreSource, readOrNull, withLint } from "../core/lint/surface/source.js";
import { plural } from "../core/text.js";
import type { AbsolutePath, ResolvedGroup, RunGroupResponse } from "../core/types/index.js";
import { daemonSocket } from "./daemon-access.js";
import { deadlineText } from "./group-pending.js";
import type { CliIo } from "./main.js";
import { askWithin, BEFORE_DEADLINE, socketBound } from "./run-group-wait.js";

/*
 * Spec 019 D6 for a lint group (row 019-22; agreed with the coordinator
 * 2026-11-04, request b166dde6: `run-group.ts` hands a lint group here).
 * `squeal run <group>` asks the daemon's `run-group`, which lints every
 * pending check of the group's tools now, whatever its moment. With
 * `--wait`, the lint store is read until none of them is left to lint.
 */

/** How long to wait for the scheduler to take the request without `--wait`. */
const RECORD_WAIT_MS = 10_000;
const POLL_MS = 100;
/** How often the wait reads the lint store, as `run <group> --wait` reads the store. */
const STORE_POLL_MS = 1_000;
/** Every this many polls, the wait asks whether the daemon is still there: every 5 s. */
const PING_POLLS = 5;

/** One `squeal run <lint group>`. */
export interface LintGroupRun {
  readonly root: AbsolutePath;
  readonly group: ResolvedGroup;
  /** `null` without `--wait`; `Infinity` for a bare `--wait`. */
  readonly waitMs: number | null;
}

type Requested = NonNullable<RunGroupResponse["requested"]>;

/**
 * Exit code 0 when requested, 1 when no daemon runs or the request failed.
 * With `--wait`: 0 when every lint check of the group is linted with no
 * findings, 1 with findings, 3 when Squeal has no verdict. The daemon's
 * discovery, every socket call and every sleep end by the wait's one
 * deadline, as for a test group (row 019-26, review 0.1.398 B3).
 */
export async function runLintGroupCommand(run: LintGroupRun, io: CliIo): Promise<number> {
  const { root, group, waitMs: wait } = run;
  const noVerdict = (text: string): number => {
    if (wait === null) {
      io.stderr(`squeal: ${text}\n`);
      return 1;
    }
    io.stdout(`Group ${group.name} has no verdict: ${text}\n`);
    return 3;
  };
  const deadline = Date.now() + (wait ?? RECORD_WAIT_MS);
  const socketPath = await daemonSocket(root, socketBound(deadline));
  const state = await taken(socketPath, group.name, deadline);
  if (typeof state === "string") return noVerdict(state);
  const line = requestedText(group.name, state);
  if (wait === null) {
    io.stdout(line);
    return 0;
  }
  const outcome = await linted(root, socketPath, group.name, deadline);
  const [verdict, code] = verdictLine(outcome, group);
  io.stdout(`Group ${group.name} ${verdict}\n${line}`);
  return code;
}

const PENDING = "the request is pending, and the daemon takes it once its current work allows";

/** The request, then `run-group-status` until the scheduler took it: what it queued, or why not. */
async function taken(
  socketPath: AbsolutePath,
  group: string,
  deadline: number,
): Promise<Requested | string> {
  const state = await askWithin(socketPath, { type: "run-group", group }, deadline);
  if (state === null) return "no daemon is running; start one with squeal start";
  if ("unanswered" in state) {
    return `the daemon did not answer the request to run group ${group}${state.unanswered}; it may still take it once its current work allows`;
  }
  for (let answer = state; ; ) {
    if (!answer.ok || answer.type !== "run-group") {
      const error = answer.ok ? "unexpected answer" : answer.error;
      return error.startsWith("unknown request type") ? GROUP_NOT_SUPPORTED : failed(error);
    }
    if (answer.requested !== null) return answer.requested;
    if (answer.unknown) {
      return `the daemon's policy has no group "${answer.group}" yet; it reloads squeal.config.json when it sees the file change`;
    }
    if (answer.error !== null) return failed(answer.error);
    const { requestId } = answer;
    const late = deadlineText(answer, "run the linter yourself");
    if (Date.now() > deadline) return late;
    await sleep(Math.max(0, Math.min(POLL_MS, deadline - Date.now())));
    const next = await askWithin(socketPath, { type: "run-group-status", requestId }, deadline);
    if (next === null) return "the daemon stopped before taking the request";
    if ("unanswered" in next) {
      if (next.unanswered === BEFORE_DEADLINE) return late;
      return `the daemon did not answer about request ${requestId}${next.unanswered}; ${PENDING}`;
    }
    answer = next;
  }
}

const failed = (error: string) => `squeal run <group> failed: ${error}`;

function requestedText(group: string, { revision, queued }: Requested): string {
  if (queued === 0) {
    return `No lint checks of group ${group} to lint at revision ${revision}: none is pending.\n`;
  }
  return `Group ${group} requested at revision ${revision}: ${plural(queued, "lint check")} queued; they lint now.\n`;
}

/** The group's lint checks as the lint store has them. */
interface LintCounts {
  readonly files: number;
  readonly failing: number;
  /** Checks that wait to lint (`waitsToLint`) and the pass lints: their tool's group is not held until asked, or their path is released. */
  readonly linting: number;
  /** Checks that wait to lint and wait for a commit or, at `manual`, a request: they changed after the request. */
  readonly held: number;
  readonly unknown: number;
}

type LintOutcome =
  | { readonly kind: "ended" | "deadline"; readonly counts: LintCounts }
  | { readonly kind: "off" | "unread" | "stopped" };

/**
 * Reads the lint store until nothing of the group is left to lint, the
 * deadline, or the daemon went. A ping with no answer is a busy daemon,
 * not a stopped one: the store still decides, as for a test group.
 */
async function linted(
  root: AbsolutePath,
  socketPath: AbsolutePath,
  group: string,
  deadline: number,
): Promise<LintOutcome> {
  for (let polls = 0; ; polls++) {
    const counts = readGroup(root, group);
    if (typeof counts === "string") return { kind: counts };
    const late = Date.now() >= deadline;
    if (counts.linting === 0 || late) return { kind: late ? "deadline" : "ended", counts };
    if (polls % PING_POLLS === PING_POLLS - 1) {
      const pong = await askWithin(socketPath, { type: "ping" }, deadline);
      if (pong === null) return { kind: "stopped" };
    }
    await sleep(Math.max(0, Math.min(STORE_POLL_MS, deadline - Date.now())));
  }
}

/** One read of the group's lint checks; why not, when lint is off or its store cannot be read. */
function readGroup(root: AbsolutePath, group: string): LintCounts | "off" | "unread" {
  const policy = readPolicy(root);
  const commonDir = resolveCommonDir(root);
  if (!policy.lint.enabled || commonDir === null) return "off";
  const id = worktreeIdFor(root);
  const tools = policy.lint.tools.filter((tool) => lintGroupOf(policy, tool)?.name === group);
  const read = withLint(lintStoreSource(commonDir, root), ({ store }) => {
    const counts = { files: 0, failing: 0, linting: 0, held: 0, unknown: 0 };
    for (const tool of tools) {
      // At `commit` and `manual` (row 019-47) only a release lints a check: one edited after it waits.
      const at = heldBy(policy, tool)?.at;
      const released =
        at !== undefined && heldUntilAsked(at)
          ? readReleased(store.meta, lintScope(id, tool))
          : null;
      for (const state of store.states.list(id, { tool })) {
        counts.files += 1;
        // A stale check's outcome is an old one: it is no verdict until linted again (review 0.1.398 B1).
        if (waitsToLint(state)) {
          if (released === null || released.has(state.check.path)) counts.linting += 1;
          else counts.held += 1;
        } else if (state.outcome === "fail") counts.failing += 1;
        else if (state.outcome === "unknown") counts.unknown += 1;
      }
    }
    return counts;
  });
  return readOrNull(read) ?? "unread";
}

/** The verdict after `Group <name> `, and the exit code. */
function verdictLine(outcome: LintOutcome, group: ResolvedGroup): [string, 0 | 1 | 3] {
  const none = (why: string): [string, 3] => [`has no verdict: ${why}`, 3];
  switch (outcome.kind) {
    case "off":
      return none("lint is off: lint.enabled is false in squeal.config.json");
    case "unread":
      return none("the lint store cannot be read");
    case "stopped":
      return none("the daemon stopped before the group's lint checks were linted");
    case "deadline":
      return none(
        `the deadline passed with ${plural(outcome.counts.linting, "lint check")} pending; the group goes on in the daemon`,
      );
    case "ended": {
      const { files, failing, held, unknown } = outcome.counts;
      if (files === 0) return none("the group has no lint checks");
      if (held > 0) {
        const next = group.at === "manual" ? `another \`squeal run ${group.name}\`` : "a commit";
        return none(
          `${plural(held, "lint check")} changed after the request and ${held === 1 ? "waits" : "wait"} for ${next}`,
        );
      }
      if (unknown > 0) return none(`${plural(unknown, "lint check")} could not be linted`);
      if (failing > 0) {
        return [
          `completed: lint findings in ${failing} of ${plural(files, "file")}; \`squeal lint\` lists them`,
          1,
        ];
      }
      return [`completed: no lint findings in ${plural(files, "file")}`, 0];
    }
  }
}
