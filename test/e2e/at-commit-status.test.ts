import { afterAll, describe, expect, it } from "vitest";
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
 * HEAD changes one source file and its test (D1, D3), `--run` (D4), and a
 * second call that reads the stored results with no run. The commits are named
 * in `docs/specifications/023-results-at-commit/tasks/023-09-notes.md`.
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
interface AtReport {
  readonly commit: string;
  readonly head: string;
  readonly dirty: boolean;
  readonly counts: Record<string, number>;
  readonly run?: { readonly selected: number; readonly ran: number; readonly stored: number };
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

        // 2. The current side: HEAD's keys are the clean working tree's, so a run at HEAD fills them.
        const head = at(dir, ["HEAD", ...paths, "--run", "--all-missing"]);
        expect(head.report.run, head.text).toMatchObject({ selected: 3, ran: 3, stored: 3 });
        for (const path of paths) {
          expect(head.row(path).at.key, path).toBe(head.row(path).now.key);
          expect(head.row(path).at.state, path).toBe("pass");
        }

        // 3. --run at the parent runs what the diff selects and has no result; the rest is read.
        const run = at(dir, ["HEAD~1", ...paths, "--run"]);
        const ran = pair.newTest ? 1 : 2;
        expect(run.report.run, run.text).toMatchObject({ selected: ran, ran });
        expect(run.report.run?.stored).toBe(ran);
        for (const path of existing) expect(run.row(path).at.state, path).toBe("pass");
        expect(run.row(pair.unaffected).at.origin?.kind).not.toBe("run");

        // 4. A second call reads every file from the store and runs nothing.
        const again = at(dir, ["HEAD~1", ...paths, "--run"]);
        expect(again.report.run, again.text).toMatchObject({ selected: 0, ran: 0 });
        for (const path of existing) {
          expect(again.row(path).at.state, path).toBe("pass");
          expect(again.row(path).at.origin?.kind, path).not.toBe("run");
          expect(again.row(path).change, path).toBe("unchanged");
          expect(again.row(path).now.state, path).toBe("pass");
        }
        expect(again.code, again.text).toBe(pair.newTest ? 3 : 0);

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
