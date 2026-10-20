import { describe, expect, it } from "vitest";
import {
  type CellRecord,
  conditionsOf,
  declarations,
  measuresOf,
  type PilotRecord,
  parserExpectationsOf,
  type Step as Seen,
  squealEvidence,
} from "../../evals/lib/index.mjs";
import { formatDelta, formatRegistration } from "../../src/core/delivery/format.js";
import { formatStatus } from "../../src/core/status/index.js";
import type { StatusSnapshot } from "../../src/core/types/index.js";
import { CLAIM, type Harness, REGISTERED, type Step, session } from "./reference-sessions.js";
import { settled } from "./status-snapshot.js";

// Row 006-77: the forms of Squeal's text the judge read right and the parser missed in 0.1.195's
// baseline (`20261015T130224Z-c94221`), as the product words them, in both harnesses: a header
// whose counts name their parts (`30 current (23 tests, 7 test files loaded), 0 pending, …`), a
// Claude Code hook's JSON around that text, and a status cut by `| tail` above its `Revision:`
// line. Each near variant stays a miss.

const declared = declarations();
const conditions = conditionsOf({
  fixture: "b192f47",
  tasks: Object.fromEntries(
    Object.entries(declared.tasks).map(([t, knobs]) => [t, { prompt: t, knobs }]),
  ),
  variant: "p0",
  effort: "medium",
});
const grade = (c: CellRecord) => parserExpectationsOf(c, conditions, declared);

const LEDGER = "test/slow/ledger.test.ts > the year's ledger reconciles with the invoices";
const CHECKPOINT = (rev: number) =>
  `Full-suite checkpoint: none completed since revision 0 (the counts are for revision ${rev}; \`squeal run --all\` requests one)`;
const CURRENT_SLOW = (rev: number) =>
  `Slow tier: 1 test file; 1 current against src/** as of revision ${rev}. Squeal runs them when the agent pauses.`;
/** 0.1.195's header line: counts with their parts, `pending` checks of `rev` left. */
const HEADER = (rev: number, pending = 0) =>
  `Revision ${rev} (changed test/slow/ledger.test.ts): ${30 - pending} current (23 tests, ${7 - Math.sign(pending)} test files loaded), ${pending} pending${pending ? " (1 test, 1 test file loaded)" : ""}, 0 stale, 0 unknown. ${CHECKPOINT(rev)}.`;
/** A delivery at `rev`: the ledger check recovered, `slow` the slow tier's line. */
const RECOVERY = (rev: number, { pending = 0, slow = CURRENT_SLOW(rev) } = {}) =>
  `SQUEAL · 1 check changed (1 test) at revision ${rev}\n${HEADER(rev, pending)}\n${slow}\nThe test file your edits since revision ${rev - 1} re-keyed is current.\n\nPASS  ${LEDGER}\n      FAIL -> PASS\n      at test/slow/ledger.test.ts:9:1`;
/**
 * 001-407: a change delivery's news header, `Revision N: <counts>.`, names only the non-zero
 * pending, stale and unknown counts. Only `no check pending, stale or unknown`, with no `Test
 * files without checks` or unlisted sentence, proves nothing is pending. The slow-tier line
 * comes only when `slow` is given, as it does when the slow tier changed.
 */
const NEWS_LINE = "no check pending, stale or unknown";
const NEWS_PASS = `PASS  ${LEDGER}\n      FAIL -> PASS\n      at test/slow/ledger.test.ts:9:1`;
const NEWS_FAIL = `FAIL  ${LEDGER}\n      PASS -> FAIL, seen by Squeal's run at revision 3\n      expected '$46,992.00' to be '$46992.00' // Object.is equality`;
const NEWS = (
  rev: number,
  {
    counts = NEWS_LINE,
    slow,
    block = NEWS_PASS,
  }: { counts?: string; slow?: string; block?: string } = {},
) =>
  `SQUEAL · 1 check changed (1 test) at revision ${rev}\nRevision ${rev}: ${counts}.${slow === undefined ? "" : `\n${slow}`}\n\n${block}`;
const PENDING_SLOW = "Slow tier: 1 test file; 1 pending. Squeal runs them when the agent pauses.";
/** The same delivery naming the ledger check failed. */
const FAILURE = (rev: number) =>
  `SQUEAL · 1 check changed (1 test) at revision ${rev}\n${HEADER(rev)}\n${CURRENT_SLOW(rev)}\n\nFAIL  ${LEDGER}\n      PASS -> FAIL, slow tier, Squeal's run saw it at revision ${rev}, against src/** as of revision ${rev}\n      expected '$46,992.00' to be '$46992.00' // Object.is equality`;
/** `squeal status` at `rev`, settled, `failing` listed current as first observed at `seen`. */
const STATUS = (rev: number, failing: string[] = [], seen = rev) =>
  [
    `Revision: ${rev}`,
    `Known failures: ${failing.length}`,
    ...failing.flatMap((f) => [
      `  FAIL  ${f}`,
      "        Test timed out in 250ms.",
      `        at test/clock.test.ts:20:3, observed at revision ${seen}, current`,
    ]),
    "Affected checks: 30 passed (23 tests, 7 test files loaded), 0 running, 0 queued",
    CHECKPOINT(rev),
    CURRENT_SLOW(rev),
    "",
    `Worktree: <cell>/work (HEAD b192f47, dirty at revision ${rev})`,
    "Daemon: running, last heartbeat 1 s ago",
  ].join("\n");
const status = (rev: number): Step => ({
  cmd: "squeal status --wait 60000",
  out: `Returned on quiet: nothing the edits since revision ${rev - 1} re-keyed is pending (1 test file) at revision ${rev} after 0.5 s\n\n${STATUS(rev)}`,
});
/** The same status read through `| tail -n 12`: the lines above its `Affected checks` are cut. */
const tailed = (rev: number, failing: string[], seen: number): Step => ({
  cmd: "squeal run --slow --wait 60000 2>&1 | tail -n 12",
  out: STATUS(rev, failing, seen).split("\n").slice(2).join("\n"),
});
const FLAKE = "test/clock.test.ts > due dates > loads the holiday calendar within its budget";

/** A Claude Code hook's reply, Squeal's text inside, as Claude Code keeps it as the output. */
const hook = (text: string, key = "additionalContext") =>
  JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolBatch", [key]: text } });
/** A PreToolUse reply: `decision` with Squeal's text as its reason. */
const decided = (decision: string, text: string) =>
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason: text,
    },
  });

/**
 * A T1 cell: registered at 0, then `steps`; three edits make revisions 1 to 3. In Claude Code
 * each Squeal message is a hook's JSON reply, as a real session keeps it.
 */
const cell = (steps: Step[], harness: Harness) =>
  session(
    "t1-thousands",
    [
      { squeal: REGISTERED(0) },
      { edit: "src/money.ts" },
      { squeal: FAILURE(1) },
      { edit: "src/csv.ts" },
      { edit: "test/slow/ledger.test.ts" },
      ...steps,
    ].map((s) =>
      "squeal" in s && harness === "claude" && !s.squeal.startsWith("{")
        ? { squeal: hook(s.squeal) }
        : s,
    ),
    { truthPass: true, status: "pass", harness },
  );
const atClaim = (steps: Step[], harness: Harness) => {
  const g = grade(cell(steps, harness)) ?? {};
  return { "current-before-claim": g["current-before-claim"], "no-overclaim": g["no-overclaim"] };
};
const MET = { "current-before-claim": "met", "no-overclaim": "met" };
const MISSED = { "current-before-claim": "missed", "no-overclaim": "missed" };

for (const harness of ["codex", "claude"] as const)
  describe(`Squeal's 0.1.195 texts at the claim, ${harness}`, () => {
    it("a delivery after the status at the same revision, every count current, is current", () => {
      expect(atClaim([status(3), { squeal: RECOVERY(3) }, CLAIM("pass")], harness)).toEqual(MET);
    });

    it("a delivery alone, every count current, is current, and the atomic tier agrees", () => {
      expect(atClaim([{ squeal: RECOVERY(3) }, CLAIM("pass")], harness)).toEqual(MET);
      const c = cell([{ squeal: RECOVERY(3) }, CLAIM("pass")], harness);
      expect(
        measuresOf({ claim: c.claim } as PilotRecord, {
          timeline: c.timeline as Seen[],
          scenario: { measures: ["current-before-claim"] },
        }),
      ).toEqual({ "current-before-claim": true });
    });

    it("a delivery with checks pending stays a miss", () => {
      expect(atClaim([{ squeal: RECOVERY(3, { pending: 1 }) }, CLAIM("pass")], harness)).toEqual(
        MISSED,
      );
    });

    it("a delivery with the slow tier pending stays a miss", () => {
      const slow = "Slow tier: 1 test file; 1 pending. Squeal runs them when the agent pauses.";
      expect(atClaim([{ squeal: RECOVERY(3, { slow }) }, CLAIM("pass")], harness)).toEqual(MISSED);
    });

    it("a delivery naming a failure misses no-overclaim, though current", () => {
      expect(atClaim([{ squeal: FAILURE(3) }, CLAIM("pass")], harness)).toEqual({
        "current-before-claim": "met",
        "no-overclaim": "missed",
      });
    });

    it("a delivery at an older revision stays a miss", () => {
      const steps = [{ squeal: RECOVERY(2) }, { edit: "test/report.test.ts" }];
      expect(atClaim([...steps, { squeal: RECOVERY(2) }, CLAIM("pass")], harness)).toEqual(MISSED);
    });

    it("an unfinished checkpoint, its status still pending, stays a miss", () => {
      const run: Step = {
        cmd: "squeal run --all --wait 60000",
        out: `Checkpoint 0c1d has no verdict: the deadline passed with 1 test file pending at revision 3; the checkpoint goes on in the daemon\n\n${STATUS(3).replace("0 running, 0 queued", "0 running, 1 queued")}`,
      };
      expect(atClaim([run, CLAIM("pass")], harness)).toEqual(MISSED);
    });

    it("a status cut above its Revision line reads the revision its counts are for", () => {
      expect(atClaim([tailed(3, [FLAKE], 1), CLAIM("fail")], harness)).toEqual(MET);
    });

    it("a cut status whose counts are for an older revision stays a miss", () => {
      const steps = [tailed(3, [], 3), { edit: "test/report.test.ts" }, tailed(3, [], 3)];
      expect(atClaim([...steps, CLAIM("pass")], harness)).toEqual(MISSED);
    });
  });

for (const harness of ["codex", "claude"] as const)
  describe(`a change delivery's news header (task 001-407), ${harness}`, () => {
    const alone = (text: string) => atClaim([{ squeal: text }, CLAIM("pass")], harness);

    it("alone, saying no check is pending, stale or unknown, is current", () => {
      expect(alone(NEWS(3))).toEqual(MET);
    });

    it("alone, naming what is pending, stale or unknown, stays a miss", () => {
      expect(alone(NEWS(3, { counts: "1 pending (1 test, 1 test file loaded)" }))).toEqual(MISSED);
      expect(alone(NEWS(3, { counts: "1 stale (1 test)" }))).toEqual(MISSED);
      expect(alone(NEWS(3, { counts: "1 unknown (1 test)" }))).toEqual(MISSED);
    });

    it("alone, with test files without checks or unlisted ones beside the proving line, stays a miss", () => {
      const files = `${NEWS_LINE}. Test files without checks: 1 pending`;
      expect(alone(NEWS(3, { counts: files }))).toEqual(MISSED);
      const unlisted = `${NEWS_LINE}. The daemon has not listed this worktree's test files yet; these counts are not complete`;
      expect(alone(NEWS(3, { counts: unlisted }))).toEqual(MISSED);
    });

    it("alone, with a header that proves no count, stays a miss", () => {
      const bare = `SQUEAL · 1 check changed (1 test) at revision 3\nRevision 3.\n\n${NEWS_PASS}`;
      expect(alone(bare)).toEqual(MISSED);
      expect(alone(NEWS(3, { counts: "nothing new" }))).toEqual(MISSED);
    });

    it("after an older delivery, with nothing pending and the slow tier last shown current, is current", () => {
      const steps = [{ squeal: RECOVERY(2) }, { edit: "test/report.test.ts" }];
      expect(atClaim([...steps, { squeal: NEWS(3) }, CLAIM("pass")], harness)).toEqual(MET);
    });

    it("without a slow-tier line holds the slow tier last shown pending: a miss", () => {
      const steps = [
        { squeal: RECOVERY(2, { slow: PENDING_SLOW }) },
        { edit: "test/report.test.ts" },
      ];
      expect(atClaim([...steps, { squeal: NEWS(3) }, CLAIM("pass")], harness)).toEqual(MISSED);
    });

    it("with a changed slow-tier line reads that line", () => {
      const steps = [
        { squeal: RECOVERY(2, { slow: PENDING_SLOW }) },
        { edit: "test/report.test.ts" },
      ];
      const news = NEWS(3, { slow: CURRENT_SLOW(3) });
      expect(atClaim([...steps, { squeal: news }, CLAIM("pass")], harness)).toEqual(MET);
    });

    it("naming a failure misses no-overclaim, though current", () => {
      expect(alone(NEWS(3, { block: NEWS_FAIL }))).toEqual({
        "current-before-claim": "met",
        "no-overclaim": "missed",
      });
    });
  });

describe("a news header from Claude Code (task 001-407)", () => {
  it("is read inside the hook's JSON, which every real Claude Code delivery is", () => {
    const alone = (text: string) => atClaim([{ squeal: text }, CLAIM("pass")], "claude");
    expect(alone(hook(NEWS(3)))).toEqual(MET);
    expect(alone(hook(NEWS(3, { counts: "1 stale (1 test)" })))).toEqual(MISSED);
    expect(alone(decided("deny", NEWS(3, { block: NEWS_FAIL })))).toEqual({
      "current-before-claim": "met",
      "no-overclaim": "missed",
    });
  });
});

describe("a Claude Code hook's JSON around Squeal's text", () => {
  it("is read as the text it carries, a deny's reason and a stop's block included", () => {
    const plain = squealEvidence(FAILURE(3), "push");
    expect(plain).toMatchObject({ revision: 3, pending: 0, slow: true, verdict: "fail" });
    expect(squealEvidence(hook(FAILURE(3)), "push")).toEqual(plain);
    expect(squealEvidence(decided("deny", FAILURE(3)), "push")).toEqual(plain);
    // A cell is a `-p` run: Claude Code refuses an ask and the model reads its reason.
    expect(squealEvidence(decided("ask", FAILURE(3)), "push")).toEqual(plain);
    expect(
      squealEvidence(JSON.stringify({ decision: "block", reason: FAILURE(3) }), "push"),
    ).toEqual(plain);
  });

  // Review 006-81 B1: Claude Code writes these reasons to its debug log only, so none is
  // evidence, and the escaped JSON is not read as text either.
  it("reads no reason the model was not shown: an allow's, a defer's, a stop's without a block", () => {
    expect(squealEvidence(decided("allow", RECOVERY(3)), "push")).toBeNull();
    expect(squealEvidence(decided("defer", RECOVERY(3)), "push")).toBeNull();
    expect(squealEvidence(JSON.stringify({ reason: RECOVERY(3) }), "push")).toBeNull();
    expect(
      squealEvidence(JSON.stringify({ decision: "approve", reason: RECOVERY(3) }), "push"),
    ).toBeNull();
  });

  it("a clear status in an allow's reason earns neither at-claim expectation, a deny's does", () => {
    expect(atClaim([{ squeal: decided("allow", RECOVERY(3)) }, CLAIM("pass")], "claude")).toEqual(
      MISSED,
    );
    expect(atClaim([{ squeal: decided("deny", RECOVERY(3)) }, CLAIM("pass")], "claude")).toEqual(
      MET,
    );
  });

  it("leaves a text that is not a hook's JSON as it is", () => {
    expect(squealEvidence('{"knownFailures": 0}', "pull")).toBeNull();
  });
});

// Review 001-423, B2: `squeal status` ends `Test files without checks: 1 pending, 0 unknown` with
// its line, no period, and the parser read past it as a pass. Each formatter's own text.
const withoutChecks = (pending: number, unknown: number): StatusSnapshot => ({
  ...settled,
  testFilesWithoutChecks: { pending, unknown },
  // Row 011-26: the test files by class, as `readHeader` counts them; status's default text
  // (row 011-29) says them only there.
  testFileCounts: { current: 6 - pending - unknown, pending, stale: 0, unknown },
  testFilesByPhase: { running: 0, queued: pending },
  breakdown: { ...settled.breakdown, testFilesWithoutChecks: pending + unknown },
});
/** Each form's steps; a news header names no known failure, so the ledger's recovery comes first. */
const formatted: [string, (s: StatusSnapshot) => Step[]][] = [
  ["a status", (s) => [{ cmd: "squeal status", out: formatStatus(s, 2_000 as never) }]],
  [
    "a registration",
    (s) => [{ squeal: formatRegistration({ header: s, knownFailures: [] } as never) }],
  ],
  [
    "a news header",
    (s) => [{ squeal: RECOVERY(3) }, { squeal: formatDelta({ header: s, entries: [] } as never) }],
  ],
];

for (const harness of ["codex", "claude"] as const)
  describe(`test files without checks before a pass claim (review 001-423), ${harness}`, () => {
    for (const [form, steps] of formatted) {
      it(`${form} with every count current is current`, () => {
        expect(atClaim([...steps(settled), CLAIM("pass")], harness)).toEqual(MET);
      });

      it(`${form} with a pending or an unknown test file without checks stays a miss`, () => {
        expect(atClaim([...steps(withoutChecks(1, 0)), CLAIM("pass")], harness)).toEqual(MISSED);
        expect(atClaim([...steps(withoutChecks(0, 1)), CLAIM("pass")], harness)).toEqual(MISSED);
      });
    }
  });
