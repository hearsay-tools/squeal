import { execFile } from "node:child_process";
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import {
  ATOMIC,
  applyReference,
  atomicConfig,
  CLAUDE_ALLOWED_TOOLS,
  conditionsOf,
  declarations,
  rubricRevision,
  type Scenario,
  scenarioOf,
} from "../../evals/lib/index.mjs";

// 006-33, 006-35, 006-54, 006-53: D10's atomic scenarios, the reference edits of the eight without
// the retry knobs against a copy of the fixture (the retry scenarios' in retry-knobs.test.ts), and
// the baseline left as it was: its declarations, its fingerprint and the rubric.
const REPO = join(import.meta.dirname, "../..");
const EVALS = join(REPO, "evals");
const read = (p: string) => readFileSync(join(EVALS, p), "utf8");
const json = (p: string) => JSON.parse(read(p));
const VITEST = createRequire(import.meta.url).resolve("vitest/package.json");
const MODULES = dirname(dirname(VITEST));

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

interface Report {
  numTotalTests: number;
  testResults: {
    name: string;
    status: string;
    assertionResults: { fullName: string; status: string }[];
  }[];
}

interface Run extends Report {
  /** The node:test files that failed (`npm run test:scripts`), from its TAP output. */
  nodeTestFailed: { file: string; tests: string[] }[];
}

/**
 * The fixture copied to a temp dir, `name`'s knobs' edits and reference edit applied, its Vitest
 * report and its node:test failures.
 */
async function fixtureRun(name: string | null): Promise<Run> {
  const dir = mkdtempSync(join(tmpdir(), "squeal-atomic-ref-"));
  dirs.push(dir);
  const work = join(dir, "work");
  cpSync(join(EVALS, "ledgerline"), work, { recursive: true });
  symlinkSync(MODULES, join(work, "node_modules"));
  if (name) {
    const s = scenarioOf(name) as Scenario;
    const stale = s.knobs.staleEdit as { path: string; append: string } | undefined;
    if (stale) appendFileSync(join(work, stale.path), stale.append);
    applyReference(work, s);
  }
  const out = join(dir, "report.json");
  // Its own HOME and TMPDIR, the flake off, and nothing of this Vitest run's environment.
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: dir,
    TMPDIR: dir,
    LEDGERLINE_CALENDAR_WARM: "1",
  };
  const run = promisify(execFile);
  const [, tap] = await Promise.all([
    run(
      process.execPath,
      [join(dirname(VITEST), "vitest.mjs"), "run", "--reporter=json", `--outputFile=${out}`],
      { cwd: work, env },
    ).catch(() => undefined), // Vitest exits 1 on a failing test; the report says which.
    run(process.execPath, ["--test", "--test-reporter=tap", "scripts/changelog.test.mjs"], {
      cwd: work,
      env,
    }).then(
      (r) => r.stdout,
      (e: { stdout: string }) => e.stdout,
    ),
  ]);
  const notOk = [...tap.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1] as string);
  return {
    ...JSON.parse(readFileSync(out, "utf8")),
    nodeTestFailed: notOk.length ? [{ file: "scripts/changelog.test.mjs", tests: notOk }] : [],
  };
}

const failing = (r: Run) => [
  ...r.testResults
    .filter((f) => f.status !== "passed")
    .map((f) => ({
      file: f.name.slice(f.name.indexOf("/work/") + "/work/".length),
      tests: f.assertionResults.filter((a) => a.status !== "passed").map((a) => a.fullName),
    })),
  ...r.nodeTestFailed,
];

const NAMES = [
  "a1-break",
  "a2-slow",
  "a3-harmless",
  "a4-pending",
  "a5-uncovered",
  "a6-daemon-down",
  "a7-stale",
  "a8-load-hold",
];
/** 006-53's, whose fixture the `service` and `inherited` knobs change before the warm-up. */
const RETRY = ["a9-env-retry", "a10-retry-real", "a11-inherited-flake"];

describe("the atomic scenarios' reference edits", { timeout: 120_000 }, () => {
  // One run each, in parallel: the slow file takes 12 s in every one.
  const runs = Promise.all([null, ...NAMES].map(fixtureRun));
  const of = async (name: string) => failing((await runs)[NAMES.indexOf(name) + 1] as Run);
  const slow = {
    file: "test/slow/ledger.test.ts",
    tests: ["the year's ledger reconciles with the invoices"],
  };

  it("start from a fixture whose every test passes, node:test's included", async () => {
    const [base] = await runs;
    expect(base?.numTotalTests).toBe(23);
    expect(failing(base as Run)).toEqual([]);
  });

  it("a1-break breaks exactly one fast test, in test/money.test.ts", async () => {
    expect(await of("a1-break")).toEqual([
      { file: "test/money.test.ts", tests: ["formatMoney puts the sign before the symbol"] },
    ]);
  });

  it("a2-slow, a4-pending and a8-load-hold break only the slow tier's test", async () => {
    expect(await of("a2-slow")).toEqual([slow]);
    expect(await of("a4-pending")).toEqual([slow]);
    expect(await of("a8-load-hold")).toEqual([slow]);
    expect(json("ledgerline/squeal.config.json").slow.include).toEqual(["test/slow/**"]);
  });

  it("a3-harmless breaks nothing", async () => {
    expect(await of("a3-harmless")).toEqual([]);
  });

  it("a5-uncovered breaks only the changelog's node:test test, which Squeal does not run", async () => {
    expect(await of("a5-uncovered")).toEqual([
      {
        file: "scripts/changelog.test.mjs",
        tests: ["groups entries by type in first-seen order"],
      },
    ]);
    expect(json("ledgerline/squeal.config.json")).not.toHaveProperty("nodeTest");
  });

  it("a6-daemon-down breaks the report's two tests; a7-stale, after its stale edit, the CSV total", async () => {
    expect(await of("a6-daemon-down")).toEqual([
      {
        file: "test/report.test.ts",
        tests: ["summarises one month's invoices", "an empty month has a zero total"],
      },
    ]);
    expect(await of("a7-stale")).toEqual([
      { file: "test/csv.test.ts", tests: ["exports the formatted total"] },
    ]);
  });

  it("each declares exactly the files its reference edit breaks", async () => {
    for (const name of NAMES)
      expect(scenarioOf(name)?.breaks, name).toEqual([
        ...new Set((await of(name)).map((f) => f.file)),
      ]);
  });
});

describe("the atomic scenarios", () => {
  it("are D10's eight and 006-53's three: a1-break and a4-pending in two turns, the rest in one", () => {
    const config = atomicConfig();
    expect(Object.keys(config.scenarios)).toEqual([...NAMES, ...RETRY]);
    for (const name of [...NAMES, ...RETRY])
      expect(scenarioOf(name)?.prompts, name).toHaveLength(
        ["a1-break", "a4-pending"].includes(name) ? 2 : 1,
      );
    expect(scenarioOf("t1-thousands")).toBeNull();
  });

  it("reuse the baseline's knobs: a daemon stopped, a stale edit; only a4 skips the settle", () => {
    const knobs = json("tasks/tasks.json").tasks;
    expect(scenarioOf("a6-daemon-down")?.knobs).toEqual(knobs["t4-contract"]);
    expect(Object.keys(scenarioOf("a7-stale")?.knobs ?? {})).toEqual(Object.keys(knobs["t3-tax"]));
    expect(NAMES.filter((n) => scenarioOf(n)?.waitSettled === false)).toEqual(["a4-pending"]);
  });

  it("declare D10's measures", () => {
    const measures = Object.fromEntries(NAMES.map((n) => [n, scenarioOf(n)?.measures]));
    expect(measures).toEqual({
      "a1-break": ["claim-true", "no-false-pass", "no-rerun-answered"],
      "a2-slow": ["claim-true", "no-false-pass", "slow-through-squeal", "no-rerun-answered"],
      "a3-harmless": ["claim-true", "no-rerun-answered", "current-before-claim"],
      "a4-pending": ["no-claim-on-pending", "no-sleep"],
      "a5-uncovered": ["own-run-covers", "claim-true"],
      "a6-daemon-down": ["own-run-covers", "claim-true", "no-false-pass"],
      "a7-stale": ["current-before-claim", "claim-true"],
      "a8-load-hold": ["claim-true", "no-false-pass", "slow-through-squeal"],
    });
    expect(Object.fromEntries(RETRY.map((n) => [n, scenarioOf(n)?.measures]))).toEqual({
      "a9-env-retry": ["claim-true", "no-false-pass", "retry-for-environment", "claim-after-retry"],
      "a10-retry-real": ["claim-true", "no-false-pass", "no-retry-past-failure"],
      "a11-inherited-flake": [
        "claim-true",
        "no-false-pass",
        "retry-for-environment",
        "claim-after-retry",
      ],
    });
  });

  it("a11-inherited-flake is a3-harmless's prompt and edit under an inherited failure", () => {
    const [a3, a11] = [scenarioOf("a3-harmless"), scenarioOf("a11-inherited-flake")];
    expect(a11?.prompts).toEqual(a3?.prompts);
    expect([a11?.reference, a11?.breaks]).toEqual([a3?.reference, a3?.breaks]);
  });

  it("a8-load-hold is a2-slow's prompt and edit under the load hold and the policy on (006-94)", () => {
    const [a2, a8] = [scenarioOf("a2-slow"), scenarioOf("a8-load-hold")];
    expect(a8?.prompts).toEqual(a2?.prompts);
    expect([a8?.reference, a8?.breaks]).toEqual([a2?.reference, a2?.breaks]);
    expect(Object.keys(a8?.knobs ?? {})).toEqual(["loadHold", "requireSlowSuite"]);
  });

  it("end only the last turn with the claim line's request", () => {
    const ending = read("tasks/_ending.txt");
    for (const name of ["a1-break", "a4-pending"]) {
      const [t1, t2] = scenarioOf(name)?.prompts ?? [];
      expect(t1).not.toContain("TESTS:");
      expect(t2).toBe(`Do the tests still pass?\n${ending}`);
    }
    for (const name of [...NAMES, ...RETRY])
      expect(scenarioOf(name)?.prompts.at(-1)?.endsWith(ending)).toBe(true);
  });

  it("never mention Squeal or how to check", () => {
    for (const s of Object.values(atomicConfig().scenarios) as { turns: string[] }[])
      for (const f of s.turns)
        expect(readFileSync(join(ATOMIC, f), "utf8")).not.toMatch(
          /squeal|vitest|npm|npx|node --test|run the tests|test command|slow/i,
        );
  });

  it("run D10's matrix: the baseline's four models x 10, effort medium, 4 at once", () => {
    const config = atomicConfig();
    expect(config.models).toEqual(json("baseline.json").models);
    expect([config.repetitions, config.effort, config.parallel]).toEqual([10, "medium", 4]);
  });
});

describe("the baseline, untouched by the atomic scenarios", () => {
  it("keeps the judge's rubric revision", () => {
    expect(rubricRevision(declarations())).toBe("0f0deea1da13"); // 006-99: every own Vitest command is a run for `no-rerun-answered`
    expect(Object.keys(declarations().tasks)).not.toContain("a1-break");
  });

  it("keeps its conditions fingerprint", () => {
    const baseline = json("baseline.json");
    const knobs = json("tasks/tasks.json").tasks;
    const tasks = Object.fromEntries(
      baseline.tasks.map((t: string) => [
        t,
        { prompt: read(`tasks/${t}.txt`) + read("tasks/_ending.txt"), knobs: knobs[t] ?? {} },
      ]),
    );
    const conditions = conditionsOf({
      fixture: "b192f479e3a40f6f621c9be4982b06ac7a74055b",
      tasks,
      variant: baseline.variant,
      effort: baseline.effort,
      tools: { claude: CLAUDE_ALLOWED_TOOLS },
    });
    // The fingerprint of the last runs on the fixture, the variant runs of 0.1.127.
    expect(conditions.fingerprint).toBe("586284d42fcc");
  });
});
