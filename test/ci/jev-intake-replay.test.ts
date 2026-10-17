import { describe, expect, it } from "vitest";
import {
  boardTruth,
  COMMAND,
  type Corpus,
  candidatesAt,
  DUPLICATES,
  evaluate,
  type RecordedAnswer,
  render,
  score,
  specAreas,
} from "../../.github/scripts/jev-intake-replay.cjs";
import type { JevAnswer } from "../../.github/scripts/jev-issue-intake.cjs";

// Lines in the board's own formats, including ones that must not count.
const board = `
Decided 2026-10-17 by the human: gh-3 to 004-65; gh-6 to 005-67; gh-7 and gh-8 to 011-01; gh-14 and gh-17 to 011-03 (promotion allowed).
Round 2: gh-31 to 011-15; gh-12 to 004-66, after 011-01; gh-4 held.
Round 4: gh-23 and gh-24 folded into 011-03's design; gh-40 to 001-500.
`;

function issue(number: number, created_at: string, closed_at: string | null = null) {
  return { number, title: `Issue ${number}`, body: "", labels: [], created_at, closed_at };
}

// #5 closed before #29 and #30 were opened; #6 and #7 stayed open.
const corpus: Corpus = {
  repo: "hearsay-tools/squeal",
  fetchedAt: "2026-10-17T20:00:00Z",
  issues: [
    issue(5, "2026-10-16T18:27:00Z", "2026-10-16T21:06:00Z"),
    issue(6, "2026-10-16T19:15:00Z"),
    issue(7, "2026-10-16T19:16:00Z"),
    issue(29, "2026-10-17T10:56:00Z"),
    issue(30, "2026-10-17T10:59:00Z"),
    issue(31, "2026-10-17T11:24:00Z"),
  ],
};

function choice(picked: string, p: number, rest: Record<string, number> = {}): JevAnswer {
  return { type: "choice", choice: picked, probabilities: { ...rest, [picked]: p } };
}
function noul(p: number): JevAnswer {
  return { type: "noul", noul: p };
}
function recorded(
  area: [string, number],
  duplicate: JevAnswer,
  recheck: RecordedAnswer["recheck"] = null,
): RecordedAnswer {
  return {
    model: "jev-1.13.0",
    answers: { duplicate, main_area: choice(...area), type: choice("bug", 0.9) },
    recheck,
  };
}

// Recorded Jev answers in the API's shape: a right close (#30), a right
// "possibly the same" comment (#29), a wrong close (#31), a wrong area (#7),
// and a recheck below the shortlist threshold that must not count (#6).
const answers: Record<number, RecordedAnswer> = {
  5: recorded(["area-core", 0.3], choice("none", 0.99)),
  6: recorded(["area-adoption", 0.8], choice("none", 0.6, { "#5": 0.3 }), {
    numbers: [5],
    answers: { duplicate: choice("#5", 0.99), "same_work:#5": noul(0.99) },
  }),
  7: recorded(["area-runner", 0.7], choice("none", 0.9)),
  29: recorded(["area-adoption", 0.6], choice("#5", 0.8, { "#6": 0.1 }), {
    numbers: [5, 6],
    answers: {
      duplicate: choice("#5", 0.85),
      "same_work:#5": noul(0.5),
      "same_work:#6": noul(0.1),
    },
  }),
  30: recorded(["area-adoption", 0.6], choice("#6", 0.9, { "#7": 0.05 }), {
    numbers: [6, 7],
    answers: {
      duplicate: choice("#6", 0.9),
      "same_work:#6": noul(0.6),
      "same_work:#7": noul(0.1),
    },
  }),
  31: recorded(["area-core", 0.9], choice("#7", 0.7), {
    numbers: [7],
    answers: { duplicate: choice("#7", 0.95), "same_work:#7": noul(0.9) },
  }),
};

describe("the replay's truth", () => {
  it("maps spec numbers to areas from the code-owned area list", () => {
    const areas = specAreas();
    expect(Object.fromEntries(areas)).toEqual({
      "011": "area-core",
      "004": "area-slow-suites",
      "005": "area-adoption",
      "002": "area-harness",
      "008": "area-harness",
      "009": "area-harness",
      "012": "area-harness",
      "003": "area-runner",
      "007": "area-runner",
      "013": "area-runner",
      "006": "area-evals",
      "010": "area-ci",
    });
    expect(() => specAreas({ a: "Spec 011", b: "Spec 011" })).toThrow(/two areas/);
  });

  it("reads the board's gh-N to NNN-MM lines, lists included, and nothing else", () => {
    const truth = boardTruth(board);
    const flat = Object.fromEntries([...truth].map(([number, set]) => [number, [...set]]));
    expect(flat).toEqual({
      3: ["area-slow-suites"],
      6: ["area-adoption"],
      7: ["area-core"],
      8: ["area-core"],
      14: ["area-core"],
      17: ["area-core"],
      31: ["area-core"],
      12: ["area-slow-suites"],
    });
  });

  it("records the board's two duplicate verdicts and no other", () => {
    expect(DUPLICATES).toEqual({ 30: 6, 29: 5 });
  });

  it("rebuilds each issue's candidates as of its opening, closed ones flagged", () => {
    const at29 = candidatesAt(corpus, corpus.issues[3] ?? issue(0, ""));
    expect(at29.map(({ number, open }) => [number, open])).toEqual([
      [6, true],
      [7, true],
      [5, false],
    ]);
  });
});

describe("the replay's scoring, offline on recorded answers", () => {
  const rows = evaluate({ corpus, answers, truth: boardTruth(board) });

  it("derives each outcome through the applicator, with closing on", () => {
    const outcomes = Object.fromEntries(
      rows.map((row) => [row.number, [row.expected, row.outcome]]),
    );
    expect(outcomes).toEqual({
      5: ["none", "none"],
      6: ["none", "none"],
      7: ["none", "none"],
      29: ["comment #5", "comment #5"],
      30: ["close #6", "close #6"],
      31: ["none", "close #7"],
    });
  });

  it("counts areas against the board and every close and comment against its verdicts", () => {
    expect(score(rows)).toEqual({
      issues: 6,
      routed: 3,
      areaRight: 2,
      areaWrong: 1,
      areaNone: 0,
      closes: ["#30 close #6", "#31 close #7"],
      wrongAreas: ["#7 area-runner (board area-core)"],
      rightCloses: 1,
      wrongCloses: [31],
      rightComments: 1,
      wrongComments: [],
      missed: [],
    });
  });

  it("counts a board duplicate Jev did not catch as missed", () => {
    const quiet = { ...answers, 30: recorded(["area-adoption", 0.6], choice("none", 0.9)) };
    expect(score(evaluate({ corpus, answers: quiet, truth: boardTruth(board) })).missed).toEqual([
      30,
    ]);
  });

  it("writes every close and every wrong area into the report", () => {
    const text = render({ corpus, rows, model: "jev-1.13.0", command: COMMAND("/tmp/x") });
    expect(text).toMatch(/Every close it would make: #30 close #6; #31 close #7\./);
    expect(text).toMatch(/Wrong areas against the board: #7 area-runner \(board area-core\)\./);
    expect(text).toMatch(/wrong closes: #31\./);
    expect(text).toMatch(/\| #31 \| area-core \| area-core \| bug \| none \| close #7 \|/);
  });

  it("marks the report pending, with the exact command, when no answers are recorded", () => {
    const text = render({ corpus, rows: [], model: "", command: COMMAND("/tmp/x") });
    expect(text).toMatch(/Pending: no Jev answers are recorded/);
    expect(text).toContain("node .github/scripts/jev-intake-replay.cjs ask --dir /tmp/x");
  });
});
