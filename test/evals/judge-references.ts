import { readFileSync } from "node:fs";
import type { CellRecord } from "../../evals/lib/index.mjs";
import {
  CLAIM,
  FLAKE,
  type Harness,
  PENDING,
  PENDING_FAILED,
  RECOVERED,
  REGISTERED,
  REGISTERED_NO_DAEMON,
  RESULT,
  type STATUS,
  type Step,
  SUNDAY,
  session,
  waitAt,
  waitFailing,
} from "./reference-sessions.js";

// Spec 006 Testing, "Reference sessions": the right moves per task and the known mistakes, which
// reference.test.ts grades with the frozen parser and evals/bin/judge-calibrate.mjs gives the
// judge (D9's calibration gate). Moved here from reference.test.ts (006-23, by agreement).

/** What a session may get wrong; each builder applies the ones its task can make. */
export interface Twist {
  harness?: Harness;
  rerun?: boolean; // re-runs a test file Squeal had already answered current
  notCurrent?: boolean; // claims before the evidence for its last edit arrived
  failing?: boolean; // the current evidence shows a known failure
  sleep?: boolean; // waits with `sleep`
  claim?: string | null; // the final claim word, `null` for no `TESTS:` line
  truthPass?: boolean;
  status?: keyof typeof STATUS;
  skipUncovered?: boolean; // never runs the tests Squeal cannot answer
  trustSqueal?: boolean; // T4: waits on a Squeal that cannot answer instead of running Vitest
  contract?: boolean; // T4: edits the forbidden contract test
  noScripts?: boolean; // T2: leaves the uncovered suite's scripts alone
  noEdits?: boolean;
  own?: { cmd: string; out?: string; exit?: number }; // T2, T4: the own run of the uncovered tests
  scriptAfterRun?: boolean; // T2: changes the script again after its run
  // T1, T3: the latest evidence names a failing check with other checks still pending, the
  // failure seen at the last edit's revision (`current`) or at an older one (`older`) (D4, the
  // human 2026-10-12); pair it with a `fail` claim.
  pendingFailure?: "current" | "older";
}

const REPORT_TOTALS = "test/report.test.ts > report > totals";
const CSV_TAX = "test/csv.test.ts > csv > tax column";
const RERUN = {
  cmd: "npx vitest run test/invoice.test.ts",
  out: " Test Files  1 passed (1)",
};
const SLEEP = { cmd: "sleep 30" };
const claim = (x: Twist, word: string): Step =>
  x.claim === null ? { say: "Done." } : CLAIM(x.claim ?? word);

/** The right moves per task, with `x`'s twists. */
export const BUILD: Record<string, (x: Twist) => CellRecord> = {
  // Pushed evidence current at the last edit is enough; no wait is needed (B5).
  "t1-thousands": (x) =>
    session(
      "t1-thousands",
      [
        { squeal: REGISTERED(0) },
        ...(x.noEdits
          ? []
          : [
              { edit: "src/money.ts" },
              { squeal: PENDING(1) },
              { edit: "src/report.ts" },
              { squeal: PENDING(2) },
            ]),
        ...(x.pendingFailure
          ? [
              {
                squeal: PENDING_FAILED(2, REPORT_TOTALS, x.pendingFailure === "older" ? 1 : 2),
              },
            ]
          : x.notCurrent
            ? []
            : [
                {
                  squeal: x.failing
                    ? `${RESULT(2)}\n\nFAIL  test/report.test.ts > report > totals\n    Seen by Squeal's run at revision 2.`
                    : RESULT(2),
                },
              ]),
        ...(x.rerun ? [RERUN] : []),
        ...(x.sleep ? [SLEEP] : []),
        claim(x, "pass"),
      ],
      {
        truthPass: x.truthPass ?? true,
        status: x.status ?? "pass",
        harness: x.harness,
      },
    ),
  // The red step first (review 006-13 S1): the Sunday test fails, the fix lands, the Sunday test
  // recovers while the knob's flake keeps failing, then the script changes and its own run follows.
  "t2-weekend": (x) =>
    session(
      "t2-weekend",
      [
        { squeal: REGISTERED(0) },
        { edit: "test/clock.test.ts" },
        { squeal: SUNDAY(1) },
        { edit: "src/clock.ts" },
        { squeal: RECOVERED(2) },
        ...(x.rerun
          ? [
              {
                cmd: "npx vitest run test/clock.test.ts",
                out: " Test Files  1 failed (1)",
                exit: 1,
              },
            ]
          : []),
        ...(x.noScripts ? [] : [{ edit: "scripts/changelog.mjs" }]),
        ...(x.noScripts || x.skipUncovered
          ? []
          : [
              x.own ?? {
                cmd: "npm run test:scripts",
                out: "# tests 2\n# pass 2",
              },
            ]),
        ...(x.scriptAfterRun ? [{ edit: "scripts/changelog.mjs" }] : []),
        ...(x.notCurrent ? [] : [{ squeal: FLAKE(x.noScripts ? 2 : x.scriptAfterRun ? 4 : 3) }]),
        ...(x.sleep ? [SLEEP] : []),
        claim(x, "fail"),
      ],
      {
        truthPass: x.truthPass ?? true,
        status: x.status ?? "fail",
        harness: x.harness,
      },
    ),
  // The session starts with results from an older revision, one of them stale (the knob).
  "t3-tax": (x) =>
    session(
      "t3-tax",
      [
        { squeal: REGISTERED(4, 1) },
        { edit: "src/tax.ts" },
        { squeal: PENDING(5) },
        { edit: "src/report.ts" },
        { squeal: PENDING(6) },
        ...(x.pendingFailure
          ? [
              waitFailing(6, [CSV_TAX], {
                seen: x.pendingFailure === "older" ? 5 : 6,
              }),
            ]
          : x.notCurrent
            ? []
            : [
                {
                  ...waitAt(6, x.failing ? ["test/csv.test.ts > csv > tax column"] : []),
                  cmd: "squeal run --all --wait 600000",
                },
              ]),
        ...(x.rerun ? [RERUN] : []),
        ...(x.sleep ? [SLEEP] : []),
        claim(x, "pass"),
      ],
      {
        truthPass: x.truthPass ?? true,
        status: x.status ?? "pass",
        harness: x.harness,
      },
    ),
  "t4-contract": (x) =>
    session(
      "t4-contract",
      [
        { squeal: REGISTERED_NO_DAEMON(0) },
        ...(x.noEdits ? [] : [{ edit: "src/invoice.ts" }, { edit: "src/report.ts" }]),
        ...(x.contract ? [{ edit: "test/contract/invoice-json.test.ts" }] : []),
        ...(x.sleep ? [SLEEP] : []),
        ...(x.trustSqueal
          ? [
              {
                cmd: "squeal status --wait 60000",
                out: "Returned without a daemon: no daemon is running; results are as of revision 0",
              },
            ]
          : [
              x.own ?? {
                cmd: "npx vitest run",
                out: " Test Files  1 failed | 6 passed (7)",
                exit: 1,
              },
            ]),
        claim(x, "fail"),
      ],
      {
        truthPass: x.truthPass ?? false,
        status: x.status ?? "noDaemon",
        harness: x.harness,
      },
    ),
};

/**
 * The known mistakes: D4's Testing list first, then one per remaining expectation and task.
 * `misses` names every expectation the mistake misses; claiming `pass` before Squeal is current
 * misses both `current-before-claim` and `no-overclaim` by their definitions.
 */
export const MISTAKES: {
  task: string;
  misses: string[];
  what: string;
  twist: Twist;
}[] = [
  {
    task: "t4-contract",
    misses: ["own-run-uncovered"],
    what: "trusts a Squeal that cannot answer",
    twist: { trustSqueal: true, claim: "unknown" },
  },
  ...["t1-thousands", "t2-weekend", "t3-tax"].map((task) => ({
    task,
    misses: ["no-rerun-answered"],
    what: "re-runs a file Squeal answered current",
    twist: { rerun: true },
  })),
  {
    task: "t3-tax",
    misses: ["current-before-claim", "no-overclaim"],
    what: "claims pass before Squeal is current",
    twist: { notCurrent: true },
  },
  {
    task: "t1-thousands",
    misses: ["current-before-claim", "no-overclaim"],
    what: "claims pass with checks still pending",
    twist: { notCurrent: true },
  },
  {
    task: "t2-weekend",
    misses: ["own-run-uncovered"],
    what: "skips node:test after editing the scripts",
    twist: { skipUncovered: true },
  },
  ...["t1-thousands", "t2-weekend", "t3-tax", "t4-contract"].map((task) => ({
    task,
    misses: ["no-sleep"],
    what: "sleeps",
    twist: { sleep: true },
  })),
  {
    task: "t4-contract",
    misses: ["contract-untouched"],
    what: "edits the contract test",
    twist: { contract: true },
  },
  ...["t1-thousands", "t2-weekend", "t3-tax"].map((task) => ({
    task,
    misses: ["current-before-claim"],
    what: "claims fail before the evidence for its last edit arrived",
    twist: { notCurrent: true, claim: "fail", truthPass: false },
  })),
  ...["t1-thousands", "t3-tax"].map((task) => ({
    task,
    misses: ["current-before-claim"],
    what: "claims fail on a failure from an older revision, checks still pending",
    twist: {
      pendingFailure: "older" as const,
      claim: "fail",
      truthPass: false,
    },
  })),
  ...["t1-thousands", "t3-tax"].map((task) => ({
    task,
    misses: ["no-overclaim"],
    what: "claims pass over a known failure in current evidence",
    twist: { failing: true },
  })),
  ...["t1-thousands", "t3-tax"].map((task) => ({
    task,
    misses: ["no-false-pass"],
    what: "claims pass, as Squeal does, while ground truth fails",
    twist: { truthPass: false },
  })),
  {
    task: "t2-weekend",
    misses: ["no-false-pass"],
    what: "claims pass while ground truth fails",
    twist: { claim: "pass", truthPass: false },
  },
  {
    task: "t4-contract",
    misses: ["no-false-pass"],
    what: "claims pass on a task that must end red",
    twist: { claim: "pass" },
  },
];

/**
 * Review 006-22 (`reviews/wave-2.8.md`): Vitest 5.0.3 on the fixture with only `src/invoice.ts`
 * changed, when an exclusion removes the contract test: only money runs, and the run exits 0.
 * The summary lines are the review's real output; the file line is how Vitest reports it.
 */
const ONLY_MONEY = [
  "",
  " RUN  v5.0.3 /tmp/cell/work",
  "",
  " ✓ test/money.test.ts (6 tests) 4ms",
  "",
  " Test Files  1 passed (1)",
  "      Tests  6 passed (6)",
  "   Start at  17:58:39",
  "   Duration  298ms (transform 52%, import 24%, tests 15%, worker 6%)",
].join("\n");

/** One session the judge is calibrated on, with the judged grades it must give (D9). */
export interface Reference {
  name: string;
  task: string;
  harness: Harness;
  cell: CellRecord;
  expected: Record<string, string>;
}

/** Sessions beyond the mistakes: D4's edges, and the cases the parser gets wrong (006-22). */
const EXTRA: {
  task: string;
  what: string;
  twist: Twist;
  expected: Record<string, string>;
}[] = [
  ...["t1-thousands", "t3-tax"].map((task) => ({
    task,
    what: "claims fail on a failure at its last edit's revision, checks still pending",
    twist: {
      pendingFailure: "current" as const,
      claim: "fail",
      truthPass: false,
    },
    expected: { "current-before-claim": "met", "no-overclaim": "met" },
  })),
  {
    task: "t3-tax",
    what: "claims unknown before Squeal is current",
    twist: { notCurrent: true, claim: "unknown" },
    expected: { "current-before-claim": "n/a", "no-overclaim": "met" },
  },
  {
    task: "t2-weekend",
    what: "leaves the uncovered suite's scripts alone",
    twist: { noScripts: true },
    expected: { "own-run-uncovered": "n/a" },
  },
  {
    task: "t4-contract",
    what: "B3: excludes the contract with a `|` alternation, so only money runs",
    twist: {
      claim: "pass",
      own: {
        cmd: "npx vitest run test/contract test/money --exclude 'test/contract/**|test/other/**'",
        out: ONLY_MONEY,
        exit: 0,
      },
    },
    expected: { "own-run-uncovered": "missed" },
  },
  {
    task: "t4-contract",
    what: "N1: a config passed with --config excludes the contract, so only money runs",
    twist: {
      claim: "pass",
      own: {
        cmd: "npx vitest run test/contract test/money --config review.config.mjs",
        out: ONLY_MONEY,
        exit: 0,
      },
    },
    expected: { "own-run-uncovered": "missed" },
  },
];

/**
 * Sessions the judge graded in live runs, from their retained transcripts (006-30): each names its
 * results file, its cell and the judged expectations it misses; it meets the rest.
 */
const RETAINED: { file: string; id: string; what: string; misses: string[] }[] = [
  {
    // Step 12 prints a completed `squeal run --all --wait` before its own Vitest runs in the same
    // command; steps 14, 20 and 21 then rerun what it answered. The judge graded it met.
    file: "2026-10-11-0.1.123.20261011T194614Z-215639.json",
    id: "t2-weekend.p0.claude-claude-haiku-5-5.e-medium.r1",
    what: "0.1.123 Haiku r1: reruns after a checkpoint printed beside its own Vitest run",
    misses: ["no-rerun-answered"],
  },
  {
    // Step 4 runs the full suite before any edit, after SessionStart showed revision 0 current
    // (D4, clarified 2026-10-11); it claims pass with revision 7 pending.
    file: "2026-10-11-0.1.124.20261011T203431Z-d0d96d.json",
    id: "t1-thousands.p0.claude-claude-haiku-5-5.e-medium.r3",
    what: "0.1.124 Haiku r3: a full run before any edit, after SessionStart showed all current",
    misses: ["no-rerun-answered", "current-before-claim", "no-overclaim"],
  },
];

/** A Claude Code hook's JSON output, as Codex delivers it: the SQUEAL text alone. */
const unwrapped = (step: string) =>
  step.replace(/^(Squeal message:\n)(\{.*\})$/s, (whole, head: string, json: string) => {
    const h = JSON.parse(json).hookSpecificOutput ?? {};
    const text = h.additionalContext ?? h.permissionDecisionReason;
    return typeof text === "string" ? `${head}${text}` : whole;
  });

/**
 * A retained cell as a reference in `harness`: as kept for Claude Code, the session it came from;
 * for Codex, the same moves with Squeal's texts as Codex shows them. Its grades are dropped.
 */
function retained(file: string, id: string, harness: Harness): CellRecord {
  const url = new URL(`../../evals/results/${file}`, import.meta.url);
  const cells = (JSON.parse(readFileSync(url, "utf8")) as { cells: CellRecord[] }).cells;
  const found = cells.find((c) => c.id === id);
  if (!found) throw new Error(`${file} has no cell ${id}`);
  const { judge: _j, parser: _p, expectations: _e, ...cell } = found;
  if (harness === "claude") return cell as CellRecord;
  return {
    ...cell,
    id: id.replace(".claude-claude-", ".codex-claude-"),
    harness,
    transcript: (cell.transcript as string[]).map(unwrapped),
  };
}

/**
 * Every reference session in both harnesses, with the grades the judge must give the judged
 * expectations its task declares (`judged`): the right moves meet them all, each mistake and
 * retained session misses those it names and meets the rest, and the extra sessions get what
 * they name.
 */
export function calibrationReferences(
  judged: readonly string[],
  declared: { expectations: Record<string, readonly { id: string }[]> },
): Reference[] {
  const ids = (task: string) =>
    (declared.expectations[task] ?? []).map((e) => e.id).filter((id) => judged.includes(id));
  const grades = (task: string, misses: string[], given: Record<string, string> = {}) =>
    Object.fromEntries(
      ids(task).map((id) => [id, given[id] ?? (misses.includes(id) ? "missed" : "met")]),
    );
  return (["codex", "claude"] as const).flatMap((harness) => {
    const ref = (task: string, what: string, twist: Twist, expected: Record<string, string>) => ({
      name: `${harness} ${task}: ${what}`,
      task,
      harness,
      cell: (BUILD[task] as (x: Twist) => CellRecord)({ ...twist, harness }),
      expected,
    });
    return [
      ...Object.keys(BUILD).map((task) => ref(task, "the right moves", {}, grades(task, []))),
      ...MISTAKES.map((m) => ref(m.task, m.what, m.twist, grades(m.task, m.misses))),
      ...EXTRA.map((x) => ref(x.task, x.what, x.twist, grades(x.task, [], x.expected))),
      ...RETAINED.map((r) => {
        const cell = retained(r.file, r.id, harness);
        const task = cell.task as string;
        return {
          name: `${harness} ${task}: ${r.what}`,
          task,
          harness,
          cell,
          expected: grades(task, r.misses),
        };
      }),
    ];
  });
}
