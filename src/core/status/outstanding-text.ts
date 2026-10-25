import { testFileId } from "../keys/index.js";
import { waitsText } from "../retry/text.js";
import { plural, testFileText } from "../text.js";
import type {
  EpochMs,
  OutstandingGroup,
  OutstandingStanding,
  StatusSnapshot,
  TestFileRef,
} from "../types/index.js";
import { DEATH_CAUSE, deathText } from "./died.js";
import { nextStep } from "./next-step.js";
import { fromBase, reasonWords, stepText } from "./next-step-text.js";
import { ageText, holdAcrossEditsText } from "./status-detail.js";
import { stoppingNext, stoppingState } from "./stopping.js";

/*
 * Row 011-29 (011 C6 as amended 2026-10-20; `tasks/011-24/design.md` 1.1):
 * status's `Outstanding:` block, one line a group of `outstandingOf`, each
 * with the command that advances it or why none does (`nextStep`, as the
 * named class lines say it, status's own steps where a wait names none).
 */

/** How many groups the default text prints before it counts the rest (design 1.1). */
export const OUTSTANDING_GROUPS_SHOWN = 6;

/** How many paths a group's line names before "and N more". */
export const OUTSTANDING_FILES_SHOWN = 3;

export interface OutstandingTextOptions {
  /** `--full`: every group, none counted. */
  readonly all?: boolean;
  /** The directory a printed command names its paths from, relative to the root (`fromBase`). */
  readonly base?: string;
}

/**
 * `Outstanding:`, then a line per group: `  24 test files never run at
 * their inputs, nothing queued them: a, b, c and 21 more; \`squeal retry
 * <test file>...\` runs each once, ...`. Empty when nothing is outstanding.
 */
export function outstandingLines(
  s: StatusSnapshot,
  now: EpochMs,
  command: string,
  options: OutstandingTextOptions = {},
): string[] {
  const groups = groupsOf(s);
  if (groups.length === 0) return [];
  const shown = options.all === true ? groups : groups.slice(0, OUTSTANDING_GROUPS_SHOWN);
  const rest = groups.slice(shown.length);
  const files = rest.reduce((sum, g) => sum + g.files.length, 0);
  const more =
    rest.length === 0
      ? []
      : [
          `  and ${plural(files, "test file")} in ${plural(rest.length, "more group")} (\`${command} status --full\` lists every group)`,
        ];
  return [
    "Outstanding:",
    ...shown.map((g) => `  ${groupLine(g, s, now, command, options.base)}`),
    ...more,
  ];
}

/**
 * The snapshot's groups; one from before the field, or built without a
 * store, still says what its own fields do: no daemon, or the files not
 * listed yet.
 */
function groupsOf(s: StatusSnapshot): readonly OutstandingGroup[] {
  if (s.outstanding !== undefined) return s.outstanding;
  const { daemon } = s;
  if (daemon.state !== "alive" || daemon.stopping !== undefined) {
    const since = daemon.stopping?.since ?? (daemon.state === "alive" ? null : daemon.since);
    return [{ standing: { kind: "no-daemon", since, revision: s.revision }, files: [] }];
  }
  return s.testFilesListed === false ? [{ standing: { kind: "listing" }, files: [] }] : [];
}

function groupLine(
  { standing, files }: OutstandingGroup,
  s: StatusSnapshot,
  now: EpochMs,
  command: string,
  base: string | undefined,
): string {
  switch (standing.kind) {
    case "no-daemon":
      return daemonText(standing, s, command);
    case "listing":
      return `the daemon is still listing this worktree's test files; \`${command} status --wait 60000\` waits for it`;
    case "checkpoint":
      return checkpointText(s, now, command);
    case "retry":
      return retryText(standing, files, s, now);
  }
  const next = nextStep(standing, { named: false });
  const paths = files.map((f) => fromBase(base, f.path));
  const reason = reasonWords(next, paths, command);
  const step = stepText(next.step, paths, command);
  const head =
    files.length === 0
      ? reason
      : `${plural(files.length, "test file")} ${wordsOf(standing.kind, reason)}: ${shownText(files)}`;
  return step === "" ? head : `${head}; ${step}`;
}

/**
 * A reason that does not read after "N test files" says what they lack
 * first: `2 test files without a result, no dependencies are installed`.
 */
function wordsOf(kind: OutstandingStanding["kind"], reason: string): string {
  switch (kind) {
    case "no-install":
    case "setup-failed":
    case "runner":
      return `without a result, ${reason}`;
    case "no-result":
      return reason.startsWith("no result: ")
        ? `without a result: ${reason.slice("no result: ".length)}`
        : reason;
    case "unlisted":
      return `queued, ${reason}`;
    default:
      return reason;
  }
}

/** `a, b, c and 21 more`: the project, when there is one, leads the path. */
function shownText(files: readonly TestFileRef[]): string {
  const shown = files.slice(0, OUTSTANDING_FILES_SHOWN).map(testFileText).join(", ");
  const more = files.length - OUTSTANDING_FILES_SHOWN;
  return more > 0 ? `${shown} and ${more} more` : shown;
}

/**
 * C15's no-daemon reason and `start`, with a daemon that died without
 * shutting down named after it (task 001-263), and a held `squeal stop`
 * (task 011-08), which no hook ends before the next edit.
 */
function daemonText(
  standing: Extract<OutstandingStanding, { kind: "no-daemon" }>,
  s: StatusSnapshot,
  command: string,
): string {
  // Row 011-34: a stopping daemon names the handoff, and past its bound what finishes it.
  if (s.daemon.stopping !== undefined) {
    const { stopping } = s.daemon;
    return `the daemon is ${stoppingState(stopping)}; results are as of revision ${standing.revision}; ${stoppingNext(stopping, command)}`;
  }
  const next = nextStep(standing, { named: false });
  const reason = reasonWords(next, [], command);
  const start = stepText(next.step, [], command);
  if (s.daemon.state === "alive") return `${reason}; ${start}`;
  if (s.daemon.stopped === true) {
    return `${reason}; stopped by request (\`${command} stop\`): a hook starts one at the next edit, or ${start}. ${holdAcrossEditsText(command)}`;
  }
  if (s.daemon.died === undefined) return `${reason}; ${start}`;
  return `${reason}; it ${deathText(s.daemon.died)}; ${start}. ${DEATH_CAUSE}`;
}

/** Task 001-217's checkpoint in progress, with what it has done. */
function checkpointText(s: StatusSnapshot, now: EpochMs, command: string): string {
  const checkpoint = s.checkpoint;
  if (checkpoint === undefined) return "a checkpoint in progress";
  const what =
    checkpoint.kind === "run-all"
      ? `\`run --all\` requested at revision ${checkpoint.revision}`
      : `the baseline from revision ${checkpoint.revision}`;
  const done = `${checkpoint.done} of ${plural(checkpoint.total, "test file")} done`;
  return `a checkpoint in progress: ${what}, started ${ageText(now - checkpoint.startedAt)} ago: ${done}; \`${command} run --all --wait\` waits for it`;
}

/**
 * Spec 001 D6 (001-368): a retry asked and not ended, and what it waits
 * for, with the load now; its FAIL, when it has one, is among the known
 * failures above. Row 011-27: a file with no result runs at once, so its
 * reason, given or not, says nothing. Row 011-213: a `load` one says how
 * long the gate has been closed, the earliest of the group's files.
 */
function retryText(
  standing: Extract<OutstandingStanding, { kind: "retry" }>,
  files: readonly TestFileRef[],
  s: StatusSnapshot,
  now: EpochMs,
): string {
  const asked = standing.noResult ? "no result at its inputs" : standing.reason;
  const load = {
    oneMinute: s.pendingRetries?.loadAverage ?? null,
    cpus: s.pendingRetries?.cpus ?? 1,
  };
  const reason = standing.noResult ? "environment" : standing.reason;
  const where = standing.elsewhere ? ", queued by another worktree's daemon" : "";
  const gate = { since: gateClosedSince(s, files), now };
  return `${plural(files.length, "test file")} with a pending retry (${asked}): ${shownText(files)}; ${waitsText(reason, load, standing.runningSince, gate)}${where}`;
}

/** The earliest time a daemon met the load gate closed on one of `files`' retries; `null` when none did. */
function gateClosedSince(s: StatusSnapshot, files: readonly TestFileRef[]): EpochMs | null {
  const ids = new Set(files.map(testFileId));
  const times = (s.pendingRetries?.retries ?? []).flatMap((r) =>
    r.gateClosedAt !== undefined && ids.has(testFileId(r.testFile)) ? [r.gateClosedAt] : [],
  );
  return times.length === 0 ? null : Math.min(...times);
}
