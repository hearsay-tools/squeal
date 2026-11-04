import { setTimeout as sleep } from "node:timers/promises";
import { requestDaemon } from "../core/daemon/client.js";
import { noDaemonCode } from "../core/daemon/ensure.js";
import { readPolicy } from "../core/daemon/policy.js";
import { GROUP_NOT_SUPPORTED } from "../core/daemon/run-group.js";
import { resolveCommonDir, worktreeIdFor } from "../core/fs/index.js";
import { heldForCommit, lintGroupOf, readReleased } from "../core/lint/pass/commit-entry.js";
import { lintScope } from "../core/lint/pass/records.js";
import { lintStoreSource, readOrNull, withLint } from "../core/lint/surface/source.js";
import { plural } from "../core/text.js";
import type {
  AbsolutePath,
  DaemonRequest,
  DaemonResponse,
  ResolvedGroup,
  RunGroupResponse,
} from "../core/types/index.js";
import { CLI_SOCKET_TIMEOUT_MS, daemonSocket } from "./daemon-access.js";
import type { CliIo } from "./main.js";

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
 * findings, 1 with findings, 3 when Squeal has no verdict. Every socket
 * call is bounded by what is left of the wait.
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
  const socketPath = await daemonSocket(root);
  const state = await taken(socketPath, group.name, deadline);
  if (typeof state === "string") return noVerdict(state);
  const line = requestedText(group.name, state);
  if (wait === null) {
    io.stdout(line);
    return 0;
  }
  const outcome = await linted(root, socketPath, group.name, deadline);
  const [verdict, code] = verdictLine(outcome);
  io.stdout(`Group ${group.name} ${verdict}\n${line}`);
  return code;
}

/** A socket request bounded by `deadline`: `null` when no daemon listens, a reason when none answered. */
async function ask(
  socketPath: AbsolutePath,
  request: DaemonRequest,
  deadline: number,
): Promise<DaemonResponse | null | string> {
  const left = Math.max(1, Math.min(CLI_SOCKET_TIMEOUT_MS, deadline - Date.now()));
  try {
    return await requestDaemon(socketPath, request, left);
  } catch (error) {
    if (noDaemonCode(error) !== null) return null;
    return `the daemon did not answer (${error instanceof Error ? error.message : String(error)})`;
  }
}

/** The request, then `run-group-status` until the scheduler took it: what it queued, or why not. */
async function taken(
  socketPath: AbsolutePath,
  group: string,
  deadline: number,
): Promise<Requested | string> {
  let state = await ask(socketPath, { type: "run-group", group }, deadline);
  for (;;) {
    if (state === null) return "no daemon is running; start one with squeal start";
    if (typeof state === "string") return state;
    if (!state.ok || state.type !== "run-group") {
      const error = state.ok ? "unexpected answer" : state.error;
      return error.startsWith("unknown request type") ? GROUP_NOT_SUPPORTED : failed(error);
    }
    if (state.requested !== null) return state.requested;
    if (state.unknown) {
      return `the daemon's policy has no group "${state.group}" yet; it reloads squeal.config.json when it sees the file change`;
    }
    if (state.error !== null) return failed(state.error);
    if (Date.now() > deadline) {
      return `the deadline passed before the daemon took request ${state.requestId}`;
    }
    await sleep(POLL_MS);
    state = await ask(
      socketPath,
      { type: "run-group-status", requestId: state.requestId },
      deadline,
    );
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
  /** Pending checks the pass lints: their tool is not held for a commit, or their path is released. */
  readonly linting: number;
  /** Pending checks that wait for a commit: an edit came after the request. */
  readonly held: number;
  readonly unknown: number;
}

type LintOutcome =
  | { readonly kind: "ended" | "deadline"; readonly counts: LintCounts }
  | { readonly kind: "off" | "unread" | "stopped" };

/** Reads the lint store until nothing of the group is left to lint, the deadline, or the daemon went. */
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
      const pong = await ask(socketPath, { type: "ping" }, deadline);
      if (pong === null || typeof pong === "string") return { kind: "stopped" };
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
      const released = heldForCommit(policy, tool)
        ? readReleased(store.meta, lintScope(id, tool))
        : null;
      for (const state of store.states.list(id, { tool })) {
        counts.files += 1;
        if (state.outcome === "fail") counts.failing += 1;
        else if (state.outcome === "unknown") counts.unknown += 1;
        else if (state.outcome !== "pending") continue;
        else if (released === null || released.has(state.check.path)) counts.linting += 1;
        else counts.held += 1;
      }
    }
    return counts;
  });
  return readOrNull(read) ?? "unread";
}

/** The verdict after `Group <name> `, and the exit code. */
function verdictLine(outcome: LintOutcome): [string, 0 | 1 | 3] {
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
        return none(
          `${plural(held, "lint check")} changed after the request and ${held === 1 ? "waits" : "wait"} for a commit`,
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
