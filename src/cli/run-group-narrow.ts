import { NARROW_NOT_SUPPORTED } from "../core/daemon/run-group.js";
import { plural } from "../core/text.js";
import type {
  AbsolutePath,
  NarrowRun,
  RelativePath,
  ResolvedGroup,
  RevisionNumber,
} from "../core/types/index.js";
import { daemonSocket } from "./daemon-access.js";
import type { CliIo } from "./main.js";
import { worktreePath } from "./named-selection.js";
import { andList, pendingText, takenRequest } from "./run-group.js";
import { askWithin, socketBound, waitForGroup } from "./run-group-wait.js";
import { statusCommand } from "./status-command.js";
import { LEFT_FOR } from "./status-wait-groups.js";

/*
 * Spec 019 D6 "Narrow run" (row 019-49): `squeal run <group> <path>...
 * [--wait [<ms>]]` runs now only the test files of the group that the paths
 * select, through the daemon's `run-group-paths` request. A daemon before it
 * answers "unknown request type" and runs nothing; the command says it
 * predates narrow runs, as `GROUP_NOT_SUPPORTED` says for groups.
 */

/** How long to wait for the scheduler to take the request without `--wait`. */
const RECORD_WAIT_MS = 10_000;

/** What `runNarrowCommand` needs: a test group, the paths as given, and `--wait`'s bound. */
export interface NarrowArgs {
  readonly root: AbsolutePath;
  readonly group: ResolvedGroup;
  readonly paths: readonly string[];
  /** `null` without `--wait`; `Infinity` for a bare `--wait`. */
  readonly waitMs: number | null;
}

/**
 * Prints what the paths selected and what they leave: the group's other
 * files they reach, other groups' files with their own narrow run, and the
 * paths that select nothing. With `--wait`, waits for the selected files
 * only and gives their verdict (`waitForGroup`), exit codes as `run <group>
 * --wait`: 0 all current and passing, 1 with a known failure, 3 no verdict,
 * also when no path selects a file of the group. Without `--wait`, 0 once
 * the daemon took it, 1 when it did not. A path outside the worktree is a
 * usage error (2).
 */
export async function runNarrowCommand(
  { root, group, paths, waitMs }: NarrowArgs,
  io: CliIo,
  usageError: (problem: string) => number,
): Promise<number> {
  const cwd = (io.cwd ?? process.cwd()) as AbsolutePath;
  const rel: RelativePath[] = [];
  for (const path of paths) {
    const inside = worktreePath(root, cwd, path);
    if (inside === null) return usageError(`"${path}" is not inside the worktree ${root}`);
    rel.push(inside);
  }
  const noVerdict = (text: string): number => {
    if (waitMs === null) {
      io.stderr(`squeal: ${text}\n`);
      return 1;
    }
    io.stdout(`No verdict: ${text}\n`);
    return 3;
  };
  const { name } = group;
  const deadline = Date.now() + (waitMs ?? RECORD_WAIT_MS);
  const socketPath = await daemonSocket(root, socketBound(deadline));
  const request = { type: "run-group-paths", group: name, paths: rel } as const;
  const first = await askWithin(socketPath, request, deadline);
  if (first === null)
    return noVerdict(`no daemon running for ${root}; start one with squeal start`);
  if ("unanswered" in first) {
    return noVerdict(
      `the daemon did not answer the request to run group ${name} for these paths${first.unanswered}; it may still take it once its current work allows`,
    );
  }
  const taken = await takenRequest(socketPath, first, deadline, NARROW_NOT_SUPPORTED);
  if (typeof taken === "string") return noVerdict(taken);
  if ("pending" in taken) {
    io.stdout(pendingText(root, taken.pending, waitMs !== null));
    return waitMs === null ? 0 : 3;
  }
  // A daemon that took it without a selection ran the whole group's request: not a narrow run.
  if (taken.narrow === undefined) return noVerdict(NARROW_NOT_SUPPORTED);
  const { narrow, requested } = taken;
  const command = statusCommand(io.env ?? process.env);
  const line = narrowText(group, requested, narrow, command);
  if (waitMs === null) {
    io.stdout(line);
    return 0;
  }
  if (narrow.selected.length === 0) {
    io.stdout(
      `Selected test files of group ${name} have no verdict: these paths select none\n${line}`,
    );
    return 3;
  }
  return waitForGroup(
    {
      root,
      socketPath,
      group: name,
      queued: requested.queued,
      deadline,
      line,
      files: narrow.selected,
      unmatched: narrow.unmatched,
    },
    io,
  );
}

/**
 * The answer's lines (019 D6): what the paths select of the group and when
 * it runs; the group's other files they reach, which still wait for its
 * moment or `squeal run <group>`; other groups' selections, each with its
 * narrow run; and the paths that select nothing.
 */
export function narrowText(
  group: ResolvedGroup,
  requested: { readonly revision: RevisionNumber; readonly queued: number },
  narrow: NarrowRun,
  command: string,
): string {
  const { name } = group;
  const selected = narrow.selected.length;
  const { queued } = requested;
  // Review 0.1.411, B2: current as the daemon classified it, never inferred from what was queued.
  const { current, notRun } = narrow;
  const when =
    group.after.length === 0
      ? "now"
      : `once ${andList(group.after)} ${group.after.length === 1 ? "has" : "have"} nothing pending`;
  const head = `Group ${name} at revision ${requested.revision}: `;
  const parts = [
    ...(current > 0 ? [`${current} current`] : []),
    ...(notRun.length > 0 ? [`${notRun.length} not run`] : []),
    ...(queued > 0 ? [`${queued} queued, which run ${when}`] : []),
  ];
  const what =
    selected === 0
      ? "these paths select no test file of it."
      : current === selected
        ? `these paths select ${plural(selected, "test file")}, ${selected === 1 ? "current" : "all current"}; none runs again.`
        : `these paths select ${plural(selected, "test file")}; ${parts.join(", ")}.`;
  const lines = [`${head}${what}`, ...notRunLines(notRun)];
  if (narrow.reached > 0) {
    const other = LEFT_FOR[group.at];
    const n = narrow.reached;
    lines.push(
      `${plural(n, `other test file`)} of group ${name} ${n === 1 ? "reads" : "read"} these paths; ${n === 1 ? "it waits" : "they wait"} for ${other === null ? "" : `${other} or `}\`${command} run ${name}\`.`,
    );
  }
  for (const other of narrow.others) {
    const them = other.files === 1 ? "it" : "them";
    lines.push(
      `Group ${other.group} has ${plural(other.files, "test file")} these paths select: \`${command} run ${other.group} ${other.paths.join(" ")}\` runs ${them}.`,
    );
  }
  if (narrow.unmatched.length > 0) {
    const n = narrow.unmatched.length;
    lines.push(
      `${narrow.unmatched.join(", ")} ${n === 1 ? "selects" : "select"} no test file of any group.`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Review 0.1.411, B2: the selected files that could not be queued, by
 * reason, as not current and not run.
 */
function notRunLines(notRun: NarrowRun["notRun"]): string[] {
  const byReason = new Map<string, string[]>();
  for (const { testFile, reason } of notRun) {
    byReason.set(reason, [...(byReason.get(reason) ?? []), testFile.path]);
  }
  return [...byReason].map(([reason, paths]) => {
    const one = paths.length === 1;
    return `${andList(paths)} ${one ? "is" : "are"} not current and ${one ? "does" : "do"} not run, because ${reason}.`;
  });
}
