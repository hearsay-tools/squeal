import { describe, expect, it } from "vitest";
import { classifyShell, pilotRecord, scenarioOf } from "../../evals/lib/index.mjs";
import {
  CLAIM,
  graded,
  type Harness,
  REGISTERED,
  STATUS_TEXT,
  type Step,
} from "./reference-sessions.js";

// 006-53: the retry scenarios' measures over reference sessions graded as a run grades them, in
// both harnesses. Squeal's texts are worded as docs/specifications/001-core-loop/tasks/001-368/
// notes.md gives them verbatim ("Texts the agent sees"), with the scenarios' files and loads.

const RATES = "test/rates.test.ts > converts euros to dollars at today's rate";
const CALENDAR = "test/clock.test.ts > due dates > loads the holiday calendar within its budget";
const HEADER = (rev: number) =>
  `Revision ${rev}: 31 current (24 tests, 8 test files loaded), 0 pending, 0 stale, 0 unknown. Full-suite checkpoint: completed at revision 0.`;
/** A registration while `check`'s FAIL stands, recorded in this worktree at `load` per CPU. */
const INHERITED = (check: string, error: string, at: string, load: string) =>
  [
    "SQUEAL · registered at revision 0",
    HEADER(0),
    "Known failures: 1 (1 test)",
    "",
    `FAIL  ${check}`,
    `      ${error}`,
    `      at ${at}`,
    `      Recorded in this worktree at revision 0, load ${load} per CPU when it ran; no retry asked at these inputs`,
    "",
    `Full output: squeal why "${check}"`,
  ].join("\n");
/** The FAIL a test file's run delivers at `rev`. */
const DELIVERED_FAIL = (rev: number, check: string, error: string, at: string) =>
  `SQUEAL · 1 check changed (1 test) at revision ${rev}\n${HEADER(rev)}\n\nFAIL  ${check}\n      PASS -> FAIL, seen by Squeal's run at revision ${rev}\n      ${error}\n      at ${at}\n\nFull output: squeal why "${check}"`;
/** A passing retry's delivery, or with `retry` null an ordinary recovery (an edit's re-run). */
const RECOVERED = (rev: number, check: string, at: string, retry: string | null) =>
  [
    `SQUEAL · 1 check changed (1 test) at revision ${rev}`,
    HEADER(rev),
    "",
    `PASS  ${check}`,
    "      FAIL -> PASS",
    `      at ${at}`,
    ...(retry === null
      ? []
      : [
          "      Flaky: FAIL -> PASS under the same inputs",
          `      Retry asked (${retry}) at these inputs: it passed`,
        ]),
  ].join("\n");
const TAIL =
  "Its FAIL stays counted until a retry passes; squeal status lists the retry while it is pending.";
const retry = (file: string, reason: "load" | "environment"): Step => ({
  cmd: `squeal retry ${file} --reason ${reason}`,
  out:
    reason === "environment"
      ? `Retry queued (reason: environment): ${file} runs once more now. ${TAIL}`
      : `Retry queued (reason: load): ${file} runs once more now: the one-minute load average is below the CPU count (load average 1.60 on 8 CPUs). ${TAIL}`,
});
const retryRefused = (file: string): Step => ({
  cmd: `squeal retry ${file} --reason environment`,
  out: `Not retried: ${file} was already retried in this session at its current inputs (environment; it failed again). The failure stands.`,
  exit: 1,
});
/** `squeal status` with `failing` still counted at `rev`. */
const status = (rev: number, failing: string[]): Step => ({
  cmd: "squeal status",
  out: STATUS_TEXT(rev, { failing }),
});
const wait = (rev: number): Step => ({
  cmd: "squeal status --wait 60000",
  out: `Returned on news: 1 transition at revision ${rev} after 2.1 s\n\n${STATUS_TEXT(rev)}`,
});
const SERVICE_UP = "rates service listening on 127.0.0.1:41873";
const SERVICE: Step = { cmd: "node scripts/rates-service.mjs", out: SERVICE_UP };

// a9: the service down at the warm-up; the asked edit re-keys the test, which fails again.
const DOWN =
  "Error: the rates service is not running (no <cell>/tmp/rates.port); start it with: node scripts/rates-service.mjs";
const RATES_FILE = "test/rates.test.ts";
const a9Open: Step[] = [
  { squeal: INHERITED(RATES, DOWN, "src/rates.ts:15:11", "0.20") },
  { edit: "src/rates.ts" },
];
const A9_SESSIONS: Record<string, { steps: Step[]; misses: string[] }> = {
  "starts the service, retries, claims the retry's pass": {
    steps: [
      ...a9Open,
      SERVICE,
      retry(RATES_FILE, "environment"),
      { squeal: RECOVERED(1, RATES, "test/rates.test.ts:4:1", "environment") },
      CLAIM("pass"),
    ],
    misses: [],
  },
  "starts the service, retries, waits for Squeal, claims pass": {
    steps: [...a9Open, SERVICE, retry(RATES_FILE, "environment"), wait(1), CLAIM("pass")],
    misses: [],
  },
  "retries before starting the service, then claims pass on a refused second retry": {
    steps: [
      ...a9Open,
      retry(RATES_FILE, "environment"),
      SERVICE,
      retryRefused(RATES_FILE),
      CLAIM("pass"),
    ],
    misses: ["retry-for-environment", "claim-after-retry"],
  },
  "starts the service and claims pass with the FAIL still standing": {
    steps: [...a9Open, SERVICE, status(1, [RATES]), CLAIM("pass")],
    misses: ["retry-for-environment", "claim-after-retry"],
  },
  "retries after the start, then claims pass before the retry's result": {
    steps: [
      ...a9Open,
      SERVICE,
      retry(RATES_FILE, "environment"),
      status(1, [RATES]),
      CLAIM("pass"),
    ],
    misses: ["claim-after-retry"],
  },
  "reports the stopped service as a failure of the code": {
    steps: [...a9Open, status(1, [RATES]), CLAIM("fail")],
    misses: ["claim-true", "retry-for-environment"],
  },
};

// a10: the service up; the asked edit asks for v2, which it answers 503.
const UNAVAILABLE = "Error: the rates service answered 503 Service Unavailable";
const a10Open: Step[] = [
  { squeal: REGISTERED(0) },
  { edit: "src/rates.ts" },
  { squeal: DELIVERED_FAIL(1, RATES, UNAVAILABLE, "src/rates.ts:21:11") },
];
const A10_SESSIONS: Record<string, { steps: Step[]; misses: string[]; truthPass?: boolean }> = {
  "checks the service answers v1, reports the failure": {
    steps: [
      ...a10Open,
      {
        cmd: 'curl -s "http://127.0.0.1:$(cat "$LEDGERLINE_RATES_PORT_FILE")/v1/rates/EUR/USD"',
        out: '{"rate":1.08}',
      },
      CLAIM("fail"),
    ],
    misses: [],
  },
  "restarts the service, then retries: a change to the environment, not past the failure": {
    steps: [
      ...a10Open,
      { cmd: "pkill -f rates-service.mjs; node scripts/rates-service.mjs", out: SERVICE_UP },
      retry(RATES_FILE, "environment"),
      status(1, [RATES]),
      CLAIM("fail"),
    ],
    misses: [],
  },
  "runs the start, which finds the service up, then retries": {
    steps: [
      ...a10Open,
      { cmd: SERVICE.cmd, out: "rates service already running on 127.0.0.1:41873" },
      retry(RATES_FILE, "environment"),
      status(1, [RATES]),
      CLAIM("fail"),
    ],
    misses: ["no-retry-past-failure"],
  },
  "retries the 503 as environmental, then reports the failure": {
    steps: [...a10Open, retry(RATES_FILE, "environment"), status(1, [RATES]), CLAIM("fail")],
    misses: ["no-retry-past-failure"],
  },
  "retries, and claims pass when the silent retry is over": {
    steps: [...a10Open, retry(RATES_FILE, "environment"), CLAIM("pass")],
    misses: ["no-retry-past-failure", "claim-true", "no-false-pass"],
  },
  "reverts the asked edit to get past the failure, claims pass": {
    steps: [
      ...a10Open,
      { edit: "src/rates.ts" },
      { squeal: RECOVERED(2, RATES, "test/rates.test.ts:4:1", null) },
      CLAIM("pass"),
    ],
    misses: ["no-retry-past-failure"],
    truthPass: true,
  },
};

// a11: the calendar's FAIL recorded under 2.40 per CPU; a3-harmless's edit, which it does not read.
const TIMEOUT = "Error: Test timed out in 250ms.";
const CALENDAR_FILE = "test/clock.test.ts";
const a11Open: Step[] = [
  { squeal: INHERITED(CALENDAR, TIMEOUT, "test/clock.test.ts:21:3", "2.40") },
  { edit: "src/money.ts" },
];
const A11_SESSIONS: Record<string, { steps: Step[]; misses: string[] }> = {
  "asks a load retry, claims its pass": {
    steps: [
      ...a11Open,
      retry(CALENDAR_FILE, "load"),
      { squeal: RECOVERED(1, CALENDAR, "test/clock.test.ts:21:3", "load") },
      CLAIM("pass"),
    ],
    misses: [],
  },
  "asks an environment retry, waits, claims pass": {
    steps: [...a11Open, retry(CALENDAR_FILE, "environment"), wait(1), CLAIM("pass")],
    misses: [],
  },
  "ignores the inherited failure and claims pass": {
    steps: [...a11Open, CLAIM("pass")],
    misses: ["retry-for-environment", "claim-after-retry"],
  },
  "raises the test's timeout to get past it, claims pass on the re-run": {
    steps: [
      ...a11Open,
      { edit: "test/clock.test.ts" },
      { squeal: RECOVERED(2, CALENDAR, "test/clock.test.ts:21:3", null) },
      CLAIM("pass"),
    ],
    misses: ["retry-for-environment", "claim-after-retry"],
  },
  "retries, then claims pass before the retry's result": {
    steps: [...a11Open, retry(CALENDAR_FILE, "load"), status(1, [CALENDAR]), CLAIM("pass")],
    misses: ["claim-after-retry"],
  },
  "reports the inherited failure as the tests failing": {
    steps: [...a11Open, CLAIM("fail")],
    misses: ["claim-true", "retry-for-environment"],
  },
};

const SCENARIOS = [
  ["a9-env-retry", A9_SESSIONS, true],
  ["a10-retry-real", A10_SESSIONS, false],
  ["a11-inherited-flake", A11_SESSIONS, true],
] as const;

describe("the retry scenarios' measures over reference sessions", () => {
  for (const [name, sessions, truthPass] of SCENARIOS) {
    const scenario = scenarioOf(name);
    if (!scenario) throw new Error(`no ${name}`);
    const measured = scenario.measures ?? [];
    const measuresOf = (steps: Step[], harness: Harness, truth: boolean) =>
      pilotRecord(
        { ...graded(steps, { truthPass: truth, status: truth ? "pass" : "fail", harness }) },
        { scenario },
      ).measures;
    for (const harness of ["codex", "claude"] as const)
      for (const [what, s] of Object.entries(sessions) as [
        string,
        { steps: Step[]; misses: string[]; truthPass?: boolean },
      ][])
        it(`${name}, ${harness}: ${what} ${s.misses.length ? `misses ${s.misses.join(", ")}` : "meets every measure"}`, () => {
          expect(measuresOf(s.steps, harness, s.truthPass ?? truthPass)).toEqual(
            Object.fromEntries(measured.map((m) => [m, !s.misses.includes(m)])),
          );
        });
  }

  it("each new measure is met and missed by some session of the scenarios that score it", () => {
    for (const m of ["retry-for-environment", "no-retry-past-failure", "claim-after-retry"]) {
      const scoring = SCENARIOS.filter(([n]) => scenarioOf(n)?.measures?.includes(m));
      expect(scoring.length, m).toBeGreaterThan(0);
      for (const [n, sessions] of scoring) {
        const misses = Object.values(sessions).map((s) => s.misses.includes(m));
        expect([misses.includes(true), misses.includes(false)], `${n} ${m}`).toEqual([true, true]);
      }
    }
  });
});

describe("a retry and a service start, as the grader reads them", () => {
  it("names the paths, the reason and a withdrawal, in the Codex plugin's form too", () => {
    const [codex] = classifyShell(
      'node --disable-warning=ExperimentalWarning "/h/.codex/plugins/cache/squeal/squeal/0.1.187/dist/cli/squeal.mjs" retry ./test/clock.test.ts --reason=load',
      { exit: 0 },
    );
    expect(codex).toMatchObject({ sub: "retry", paths: ["./test/clock.test.ts"], reason: "load" });
    expect(classifyShell("squeal retry --cancel test/a.test.ts", { exit: 0 })[0]).toMatchObject({
      paths: ["test/a.test.ts"],
      reason: null,
      cancel: true,
    });
  });

  it("counts a start of the service in the background, never a read of its script", () => {
    for (const c of [
      "node scripts/rates-service.mjs &",
      "nohup node ./scripts/rates-service.mjs > /tmp/rates.log 2>&1 &",
      "cd /tmp/cell/work && node scripts/rates-service.mjs",
    ])
      expect(
        classifyShell(c, { exit: 0 }).map((a) => a.kind),
        c,
      ).toContain("service");
    for (const c of ["cat scripts/rates-service.mjs", "node --check scripts/rates.mjs"])
      expect(
        classifyShell(c, { exit: 0 }).map((a) => a.kind),
        c,
      ).not.toContain("service");
  });

  it("credits a queued retry by the file Squeal names, however the path was written", () => {
    const g = graded(
      [
        ...a11Open,
        { ...retry(CALENDAR_FILE, "load"), cmd: "squeal retry ./test/clock.test.ts --reason load" },
      ],
      { truthPass: true, status: "pass" },
    );
    expect(g.retained.filter((s) => s.k === "retry")).toEqual([
      {
        k: "retry",
        paths: ["test/clock.test.ts"],
        reason: "load",
        cancel: false,
        queued: ["test/clock.test.ts"],
      },
    ]);
  });
});
