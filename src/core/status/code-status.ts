import { coverageOn } from "../code/coverage/runtime.js";
import { coverageStatusOf } from "../code/crap/status.js";
import type { CodeStore } from "../code/store/types.js";
import { readPolicy } from "../daemon/policy.js";
import { countingOf } from "../delivery/code-deliver.js";
import { codeSince, type ShellSession, wentOverSince } from "../delivery/code-since.js";
import { codeSource, withCode } from "../delivery/code-source.js";
import { plural } from "../text.js";
import type { CodeCoverageStatus, CodeStatus } from "../types/code-delivery.js";
import type { AbsolutePath, StatusSnapshot, Store, WorktreeId } from "../types/index.js";

/*
 * Spec 015 D6: status's complexity line and its `code` JSON, read from the
 * code store with no daemon (011 C6). Absent while `complexity.enabled` is
 * off, so status is then the one before (goal 1).
 */

/** `StatusSnapshot.code` of the worktree, or nothing while the policy is off. */
export function codeStatusOf(
  store: Store,
  worktreeId: WorktreeId,
  at: { readonly root: AbsolutePath; readonly commonDir: () => AbsolutePath | null },
  shell: ShellSession | null,
): { code?: CodeStatus } {
  const policy = readPolicy(at.root);
  if (!policy.complexity.enabled) return {};
  const commonDir = at.commonDir();
  if (commonDir === null) return {};
  const source = codeSource(commonDir, at.root);
  const since = () => codeSince(store, worktreeId, shell);
  // Spec 015 D9 (row 015-12): the coverage part, only while coverage is on.
  const coverageOf = (code: CodeStore): { coverage?: CodeCoverageStatus } => {
    const coverage = coverageOn(policy) ? coverageStatusOf(code, worktreeId, policy) : undefined;
    return coverage === undefined ? {} : { coverage };
  };
  const read = withCode(source, ({ store: code, complexity }) =>
    code.read((): CodeStatus => {
      const states = code.states.list(worktreeId, { measure: "complexity" });
      const from = since();
      const { done, total, uncountable } = countingOf(code, worktreeId);
      return {
        v: 1,
        threshold: complexity.threshold,
        over: states.filter((s) => s.outcome === "fail").length,
        sinceRegistration: from === null ? 0 : wentOverSince(code, worktreeId, from).length,
        since: from?.scope ?? null,
        pending: total - done,
        files: total,
        unknown: states.filter((s) => s.outcome === "unknown").length,
        ...(uncountable === 0 ? {} : { uncountable }),
        ...coverageOf(code),
      };
    }),
  );
  if (read !== "missing") return read === null ? {} : { code: read };
  const threshold = source.policy()?.threshold;
  if (threshold === undefined) return {};
  return {
    code: {
      v: 1,
      threshold,
      over: 0,
      sinceRegistration: 0,
      since: null,
      pending: 0,
      files: 0,
      unknown: 0,
    },
  };
}

const SINCE: Record<NonNullable<CodeStatus["since"]>, string> = {
  session: "since this session started",
  oldest: "since the oldest registered session started",
};

/**
 * D6: `Complexity: 62 functions over 20, 2 since this session started; squeal code lists them.`,
 * and `Complexity: counting, 340 of 600 files.` while a count runs with none over yet; both
 * carry `; 1 file could not be counted` while one is (review 0.1.293 S1).
 */
export function codeStatusLines(s: StatusSnapshot, command: string): string[] {
  const code = s.code;
  if (code === undefined) return [];
  if (code.files === 0 && (code.uncountable ?? 0) === 0)
    return ["Complexity: no file counted yet."];
  const progress = `counting, ${code.files - code.pending} of ${plural(code.files, "file")}`;
  const uncountable =
    (code.uncountable ?? 0) === 0
      ? ""
      : `; ${plural(code.uncountable ?? 0, "file")} could not be counted`;
  // D6: while a first count runs no state is stored yet, so "0 functions over" would not be true.
  if (code.pending > 0 && code.over === 0) return [`Complexity: ${progress}${uncountable}.`];
  const since = code.since === null ? "" : `, ${code.sinceRegistration} ${SINCE[code.since]}`;
  const counting = code.pending === 0 ? "" : `; ${progress}`;
  const unknown =
    code.unknown === 0 ? "" : `; ${plural(code.unknown, "function")} in parse errors not judged`;
  const over = `${plural(code.over, "function")} over ${code.threshold}`;
  return [
    `Complexity: ${over}${since}${counting}${unknown}${uncountable}; ${command} code lists them.`,
  ];
}

const waits = (n: number) => (n === 1 ? "waits" : "wait");

const CAUSES: Readonly<Record<keyof CodeCoverageStatus["unknown"], string>> = {
  "no-record": "a test file with no coverage record",
  skipped: "a skipped test",
  unkeyed: "a test file Squeal cannot key",
  unread: "a record that cannot vouch for their bytes",
};

/**
 * Spec 015 D9 (row 015-12): `Coverage: 12 functions over CRAP 30, 300 no
 * in-process test that Squeal runs reaches; ...`, then which files wait
 * (for test files' imports, for test runs, which `squeal run --all` makes,
 * or for records), which read unknown and why, and the test files Squeal
 * does not read.
 */
export function coverageStatusLines(s: StatusSnapshot, command: string): string[] {
  const c = s.code?.coverage;
  if (c === undefined) return [];
  const parts = [
    `${plural(c.crap, "function")} over CRAP ${c.threshold}, ${c.uncovered} that no in-process test that Squeal runs reaches`,
  ];
  if (c.waitingForImports !== undefined) {
    const { files, testFiles } = c.waitingForImports;
    parts.push(
      `${plural(files, "file")} ${waits(files)} for the imports of ${plural(testFiles, "test file")}`,
    );
  }
  if (c.waitingForRuns > 0) {
    parts.push(
      `${plural(c.waitingForRuns, "file")} ${waits(c.waitingForRuns)} for test runs, which ${command} run --all makes`,
    );
  }
  if (c.waitingForRecords > 0) {
    parts.push(
      `${plural(c.waitingForRecords, "file")} ${waits(c.waitingForRecords)} for coverage records`,
    );
  }
  const unknown = Object.entries(c.unknown) as [keyof typeof CAUSES, number][];
  if (unknown.length > 0) {
    const why = unknown.map(([cause, n]) => `${n} from ${CAUSES[cause]}`).join(", ");
    parts.push(
      `${plural(
        unknown.reduce((n, [, k]) => n + k, 0),
        "file",
      )} unknown (${why})`,
    );
  }
  if (c.notRead !== undefined) {
    parts.push(`test files Squeal does not run are not read (${c.notRead.join(", ")})`);
  }
  return [`Coverage: ${parts.join("; ")}; ${command} code lists them.`];
}
