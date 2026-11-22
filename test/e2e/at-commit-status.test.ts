import { afterAll, describe, expect, it } from "vitest";
import { RUN_WAIT_MS, waitAgain } from "../../src/cli/status-at-report-queued.js";
import { REPO_ROOT } from "../../src/harness/build.js";
import {
  AT_E2E,
  type Bench,
  bench,
  checkoutAt,
  clone,
  git,
  report,
  SQUAWK,
  SQUAWK_PRESENT,
  SQUAWK_SKIP,
  squeal,
  sweep,
  timed,
} from "./at-commit-kit.js";

/*
 * Spec 023 Testing, end to end: `squeal status --at HEAD~1` on a copy whose
 * HEAD changes one source file and its test (D1, D3); `--run --all-missing`
 * (D7.3: it queues the files with no result in the commit daemon and in
 * this worktree's daemon, and waits for them); a second `--run` that queues
 * nothing; and plain calls that read the stored results. Row 023-41: the
 * in-call run these steps once checked is gone. The commits are named in
 * `docs/specifications/023-results-at-commit/tasks/023-09-notes.md`.
 */

interface Side {
  readonly state: string;
  readonly key?: string;
  readonly origin?: { readonly kind: string; readonly stored?: boolean };
}
interface FileRow {
  readonly path: string;
  readonly change: string;
  readonly at: Side;
  readonly now: Side;
}
/** One side of the call's part (`QueuedSide`). */
interface Queued {
  readonly files: number;
  readonly reached: boolean;
  readonly known: number;
  readonly running: number;
  readonly problem: string | null;
}
interface AtReport {
  readonly commit: string;
  readonly head: string;
  readonly dirty: boolean;
  readonly counts: Record<string, number>;
  /** Row 023-40 (D7.3): what the call queued in the daemons (`QueuedRun`); `null` without `--run`. */
  readonly run: {
    readonly mode: string;
    readonly commit: Queued & { readonly tree: string | null; readonly setup?: string | null };
    readonly now: Queued;
    readonly again: string | null;
    readonly retry: string | null;
  } | null;
  readonly files: readonly FileRow[];
}

interface Pair {
  readonly name: string;
  readonly source: string;
  /** HEAD of the copy: it changes `source` and its test `test`. */
  readonly commit: string;
  readonly test: string;
  /** The test is new at `commit`: `absent` at its parent. */
  readonly newTest: boolean;
  /** An unchanged test file whose closure holds the changed source: another key at the parent. */
  readonly affected: string;
  /** An unchanged test file outside that closure: the same key on both sides. */
  readonly unaffected: string;
}

const PAIRS: readonly Pair[] = [
  {
    name: "squeal",
    source: REPO_ROOT,
    commit: "20f03a43139ea3e99e057b32dac3db3dffbb903d",
    test: "test/store/open.test.ts",
    newTest: false,
    affected: "test/store/state-born.test.ts",
    unaffected: "test/store/paths.test.ts",
  },
  {
    name: "squawk",
    source: SQUAWK,
    commit: "8be977ad6",
    test: "packages/cezar/src/lint/active-run-write-index.test.ts",
    newTest: true,
    affected: "packages/cezar/src/lint/ast-rules-active-run.test.ts",
    unaffected: "packages/contract/src/waits.test.ts",
  },
];

const CASE_MS = 600_000;
// Made only when the suite runs (SQUEAL_E2E_AT=1): a skipped file makes no folder.
const b: Bench = AT_E2E ? bench() : ({} as Bench);
afterAll(() => {
  if (AT_E2E) sweep(b);
});

const at = (dir: string, args: readonly string[]) => {
  const r = squeal(b, dir, ["status", "--at", ...args, "--json"]);
  const parsed = report<AtReport>(r);
  const row = (path: string): FileRow => {
    const found = parsed.files.find((f) => f.path === path);
    if (!found) throw new Error(`${path} missing from the report:\n${r.stdout}`);
    return found;
  };
  return { code: r.code, report: parsed, row, text: `${r.stderr}\n${r.stdout}` };
};

describe.skipIf(!AT_E2E).each(PAIRS)("status --at HEAD~1 on a copy of $name", (pair) => {
  const skip = pair.source === SQUAWK && !SQUAWK_PRESENT;
  it.skipIf(skip)(
    skip
      ? SQUAWK_SKIP
      : "reads each file's state at both sides, runs the missing ones and reads them back",
    async () => {
      await timed(`status --at, ${pair.name}`, () => {
        const dir = clone(b, pair.source, pair.name);
        checkoutAt(b, dir, pair.commit);
        const paths = [pair.test, pair.affected, pair.unaffected];
        const existing = pair.newTest ? [pair.affected, pair.unaffected] : paths;

        // 1. Nothing stored anywhere: every file is unknown, keyed at both sides.
        const first = at(dir, ["HEAD~1", ...paths]);
        expect(first.code, first.text).toBe(3);
        expect(first.report).toMatchObject({ dirty: false, counts: { unknown: 3 } });
        expect(first.report.run).toBeNull();
        expect(first.row(pair.unaffected).at.key).toBe(first.row(pair.unaffected).now.key);
        expect(first.row(pair.affected).at.key).not.toBe(first.row(pair.affected).now.key);
        if (pair.newTest) expect(first.row(pair.test).at.state).toBe("absent");
        else expect(first.row(pair.test).at.key).not.toBe(first.row(pair.test).now.key);
        for (const path of existing) expect(first.row(path).at.state, path).toBe("no result");
        for (const path of paths) expect(first.row(path).now.state, path).toBe("no result");

        // 2. --run --all-missing queues every file with no result: at the parent in its commit
        // daemon, which runs them in its own worktree, and in the working tree in this worktree's
        // daemon. The call waits for them (D7.3); a result is read at the key it was stored under.
        // A finite wait always names the call that waits again (`run.again`), even when every file
        // is known; nothing still runs and nothing needs queueing again (`retry`).
        const waitCall = waitAgain("HEAD~1", paths);
        expect(waitCall).toContain(` ${paths.join(" ")} --wait ${RUN_WAIT_MS}`);
        const parent = git(b, dir, ["rev-parse", "HEAD~1"]);
        const short = parent.slice(0, 9);
        const run = at(dir, ["HEAD~1", ...paths, "--run", "--all-missing", "--wait", "300000"]);
        expect(run.report.run, run.text).toMatchObject({
          mode: "queue",
          commit: { reached: true, files: existing.length, known: existing.length, running: 0 },
          now: { reached: true, files: paths.length, known: paths.length, running: 0 },
          again: waitCall,
          retry: null,
        });
        expect(run.report.run?.commit.tree).toEqual(expect.any(String));
        for (const path of existing) expect(run.row(path).at.state, path).toBe("pass");
        // A changed key at the parent has only the commit daemon's result. An equal key is shared
        // with the working tree: whichever valid result the store holds answers, this worktree's
        // (`own`) or the commit daemon's (`commit`); review 0.1.596 B1.
        const changed = pair.newTest ? [pair.affected] : [pair.test, pair.affected];
        for (const path of changed) expect(run.row(path).at.origin?.kind, path).toBe("commit");
        expect(run.row(pair.unaffected).at.key).toBe(run.row(pair.unaffected).now.key);
        expect(["own", "commit"]).toContain(run.row(pair.unaffected).at.origin?.kind);
        for (const path of paths) expect(run.row(path).now.state, path).toBe("pass");

        // 3. A second --run queues nothing on either side and reads every file from the store.
        const again = at(dir, ["HEAD~1", ...paths, "--run"]);
        expect(again.report.run, again.text).toMatchObject({
          mode: "queue",
          commit: { files: 0 },
          now: { files: 0 },
          again: waitCall,
          retry: null,
        });
        for (const path of existing) {
          expect(again.row(path).at.state, path).toBe("pass");
          expect(again.row(path).at.key, path).toBe(run.row(path).at.key);
          expect(again.row(path).change, path).toBe("unchanged");
        }
        for (const path of paths) {
          expect(again.row(path).now.state, path).toBe("pass");
          expect(again.row(path).now.key, path).toBe(run.row(path).now.key);
        }
        expect(again.code, again.text).toBe(pair.newTest ? 3 : 0);
        // Its text: the daemons asked, nothing to queue on either side.
        const text = squeal(b, dir, ["status", "--at", "HEAD~1", ...paths, "--run"]);
        expect(text.stderr).toContain(
          `squeal: asking the commit daemon at ${short} and this worktree's daemon\n`,
        );
        expect(text.stdout).toContain(
          `--run: no file with no result at ${short} that the change selects to run\n`,
        );
        expect(text.stdout).toContain(
          "--run, now: every test file the change selects has a result in the working tree\n",
        );

        // 4. A plain call keys the parent in a temporary checkout and reads the commit daemon's
        // results at those keys (D2): the same keys, nothing run.
        const plain = at(dir, ["HEAD~1", ...paths]);
        expect(plain.report.run).toBeNull();
        for (const path of existing) {
          expect(plain.row(path).at.key, path).toBe(again.row(path).at.key);
          expect(plain.row(path).at.state, path).toBe("pass");
        }
        expect(plain.code, plain.text).toBe(pair.newTest ? 3 : 0);

        // The daemons the calls started stop, and the commit worktree goes with its daemon.
        expect(squeal(b, dir, ["stop", "--at", parent]).code).toBe(0);
        expect(squeal(b, dir, ["stop"]).code).toBe(0);

        // 5. The keys at the parent are the ones a worktree at the parent computes: there the
        // parent is "now", read from the store at the same keys, and HEAD's results are "at".
        const later = git(b, dir, ["rev-parse", "HEAD"]);
        checkoutAt(b, dir, "HEAD~1");
        const back = at(dir, [later, ...paths]);
        for (const path of existing) {
          expect(back.row(path).now.key, path).toBe(again.row(path).at.key);
          expect(back.row(path).now.state, path).toBe("pass");
          expect(back.row(path).at.state, path).toBe("pass");
        }
        if (pair.newTest) expect(back.row(pair.test).now.state).toBe("absent");
      });
    },
    CASE_MS,
  );
});
