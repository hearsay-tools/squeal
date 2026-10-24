import { toKnownFailure } from "../../core/state/index.js";
import { shortCommit } from "../../core/status/format-status.js";
import { formatCheck } from "../../core/status/index.js";
import { atText } from "../../core/status/test-frame.js";
import { plural } from "../../core/text.js";
import type {
  KnownState,
  RevisionNumber,
  TestFileRef,
  WorktreeId,
} from "../../core/types/index.js";

/** Test files a reason names one by one; past this many it names their directories. */
const NAMED_FILES = 10;

/** What a test-command deny says it answers with. */
export interface TestCommandAnswer {
  readonly revision: RevisionNumber;
  /** The files the command runs, every one current. */
  readonly files: readonly TestFileRef[];
  /** The known states of those files' checks, every one current. */
  readonly states: readonly KnownState[];
  /** A worktree's root, by id, to name where an inherited result came from. */
  readonly rootOf: (worktreeId: WorktreeId) => string | null;
}

/**
 * Spec 005 D8: the deny's reason, factual as 001 D6 asks. The command did
 * not run; the files it runs, the revision, what passed, every known failure
 * among them in full, how many results are inherited and from where; what it
 * does not cover; that the command runs if issued again. It names only the
 * command's files.
 */
export function testCommandReason(answer: TestCommandAnswer): string {
  const { revision, files, states } = answer;
  const failures = states.flatMap((s) => toKnownFailure(s, revision) ?? []);
  const passed = states.filter((s) => s.outcome === "pass").length;
  const skipped = states.filter((s) => s.outcome === "skip").length;
  const counts = [
    `${plural(passed, "check")} passed`,
    ...(skipped > 0 ? [`${skipped} skipped`] : []),
    failures.length === 0 ? "no known failures" : plural(failures.length, "known failure"),
    inheritedText(answer),
  ];
  const lines = [
    `The command did not run. Squeal holds current results at revision ${revision} for the ` +
      `${plural(files.length, "test file")} it runs (${filesText(files)}): ${counts.join(", ")}.`,
    ...failures.flatMap((f) => [
      `  FAIL  ${formatCheck(f.check)}`,
      ...(f.summary === "" ? [] : [`        ${f.summary}`]),
      ...(f.location === null ? [] : [`        ${atText(f.location, undefined)}`]),
    ]),
    "Squeal does not cover typecheck, build, or test suites it is not configured for. " +
      "Run the command again to run it anyway; it will not be stopped again this session.",
  ];
  return lines.join("\n");
}

/** The files by path up to `NAMED_FILES`, else their directories with a count each. */
function filesText(files: readonly TestFileRef[]): string {
  if (files.length <= NAMED_FILES) return files.map((f) => f.path).join(", ");
  const byDir = new Map<string, number>();
  for (const { path } of files) {
    const at = path.lastIndexOf("/");
    const dir = at === -1 ? "./" : path.slice(0, at + 1);
    byDir.set(dir, (byDir.get(dir) ?? 0) + 1);
  }
  return [...byDir].map(([dir, count]) => `${dir} (${count})`).join(", ");
}

/** `none inherited`, or how many and from which worktree at which commit. */
function inheritedText({ states, rootOf }: TestCommandAnswer): string {
  const sources = new Map<string, number>();
  for (const { origin } of states) {
    if (origin?.kind !== "inherited") continue;
    const from = `${rootOf(origin.worktreeId) ?? origin.worktreeId} at ${shortCommit(origin.commit)}`;
    sources.set(from, (sources.get(from) ?? 0) + 1);
  }
  if (sources.size === 0) return "none inherited";
  const total = [...sources.values()].reduce((a, b) => a + b, 0);
  const from = [...sources].map(([source, count]) => `${count} from ${source}`).join(", ");
  return `${total} inherited (${from})`;
}
