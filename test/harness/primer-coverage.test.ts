import { describe, expect, it } from "vitest";
import type { PolicyFile } from "../../src/core/types/index.js";
import { CONTEXT_CAP_CHARS, capContext } from "../../src/harness/codex/output.js";
import { VITEST_ONLY } from "../../src/harness/shared/coverage.js";
import { PRIMER, PRIMER_CAP_CHARS, primer, REVISION } from "../../src/harness/shared/primer.js";
import {
  CODEX,
  HARNESSES,
  NOT_COVERED,
  primerOf,
  type RepoCase,
  repoFor,
  sessionStart,
} from "./primer-helpers.js";

/*
 * Task 001-234: the primer lists what Squeal covers, read from
 * `squeal.config.json` and the test files the runner listed, then says
 * typecheck, build and any other test suite are not covered, so the agent
 * can work out what is left (005's pilot: every false "pass" came from an
 * uncovered node:test suite). The same structure with and without slow
 * files and under both harnesses; within `PRIMER_CAP_CHARS`, however long
 * the list. Spec 004 D8, D9: with slow files it also says when they run and
 * when a slow failure arrives, which differs by harness.
 */

interface Case extends RepoCase {
  readonly covers: string;
  /** The runners the opening names, "A and B"; "do not run A or B". */
  readonly runners: string;
  readonly slow: boolean;
  /**
   * Under Codex the primer names the CLI in its first command only: with the
   * retry sentence (001-368) the full path in every one passes the cap.
   */
  readonly codexFirstOnly?: boolean;
}

const SCRIPTS = { name: "scripts", argv: [], env: {}, include: ["scripts/*.test.mjs"] };
const E2E = { name: "e2e", cwd: "e2e", argv: [], env: {}, include: ["**/*.test.mjs"], slow: true };

const MATRIX: Record<string, Case> = {
  "Vitest only": {
    policy: {},
    files: [],
    covers: "Squeal covers Vitest (vitest.config.ts).",
    runners: "Vitest",
    slow: false,
  },
  "Vitest and node:test": {
    policy: { nodeTest: [SCRIPTS] },
    files: [{ project: "scripts", path: "scripts/changelog.test.mjs" }],
    covers:
      'Squeal covers Vitest (vitest.config.ts) and node:test project "scripts" (scripts/*.test.mjs).',
    runners: "Vitest and node:test",
    slow: false,
  },
  // B1: the daemon builds no Vitest runner here (spec 003 D7), so the primer names none.
  "node:test only": {
    policy: { nodeTest: [SCRIPTS] },
    vitestConfig: false,
    replace: true,
    files: [{ project: "scripts", path: "scripts/changelog.test.mjs" }],
    covers: 'Squeal covers node:test project "scripts" (scripts/*.test.mjs).',
    runners: "node:test",
    slow: false,
  },
  "Vitest and slow files": {
    policy: { slow: { include: ["test/slow/**/*.test.ts"] } },
    files: [
      { project: "", path: "test/slow/ledger.test.ts" },
      { project: "", path: "test/slow/import.test.ts" },
    ],
    covers:
      "Squeal covers Vitest (vitest.config.ts), with 2 slow test files at the daemon's last listing.",
    runners: "Vitest",
    slow: true,
  },
  // Listed Vitest projects are not named: a key row does not say which runner listed it (B2).
  "all three, with Vitest projects": {
    policy: { nodeTest: [SCRIPTS, E2E], slow: { include: ["test/slow/**/*.test.ts"] } },
    replace: true,
    files: [
      { project: "unit", path: "src/math.test.ts" },
      { project: "browser", path: "test/slow/ledger.test.ts" },
      { project: "scripts", path: "scripts/changelog.test.mjs" },
      { project: "e2e", path: "e2e/flow.test.mjs" },
    ],
    covers:
      'Squeal covers Vitest (vitest.config.ts) and node:test projects "scripts" (scripts/*.test.mjs) and "e2e" (e2e/**/*.test.mjs), with 2 slow test files at the daemon\'s last listing.',
    runners: "Vitest and node:test",
    slow: true,
    codexFirstOnly: true,
  },
};

const runs = Object.keys(MATRIX).flatMap((name) =>
  HARNESSES.map((harness) => [name, harness] as const),
);

describe("SessionStart's primer lists exactly what the policy and the runner cover (001-234)", () => {
  it.each(runs)("%s, under %s", async (name, harness) => {
    const c = MATRIX[name] as Case;
    const text = primerOf(await sessionStart(repoFor(c), harness)).primer;
    const command = harness === "claude-code" ? "squeal" : CODEX;
    expect(text.startsWith("Squeal runs this repository's ")).toBe(true);
    expect(text).toContain(`this repository's ${c.runners} tests in the background`);
    expect(text).toContain(`do not run ${c.runners.replace(" and ", " or ")} to learn`);
    expect(text.includes("Vitest")).toBe(c.runners.includes("Vitest"));
    // The list, then what is left, as the primer's last two sentences.
    expect(text.endsWith(` ${c.covers} ${NOT_COVERED}`)).toBe(true);
    expect(text.match(/Squeal covers /g)).toHaveLength(1);
    const slowStep =
      harness === "codex" && c.codexFirstOnly === true
        ? "the CLI's `run --slow --wait 60000`"
        : `\`${command} run --slow --wait 60000\``;
    expect(text.includes(slowStep)).toBe(c.slow);
    expect(text.length).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
  });

  it("says the slow files are not counted while the runner has listed no test file", async () => {
    const r = repoFor({
      policy: { slow: { include: ["test/slow/**"] } },
      files: [],
      replace: true,
    });
    const text = primerOf(await sessionStart(r, "claude-code")).primer;
    expect(text).toContain(
      `Squeal covers Vitest (vitest.config.ts), with slow test files not counted yet. ${NOT_COVERED}`,
    );
  });
});

describe("a long coverage list (001-234)", () => {
  const many = Array.from({ length: 40 }, (_, i) => `suite-${String(i).padStart(2, "0")}`);
  const policy: PolicyFile = {
    nodeTest: many.map((name) => ({
      name,
      argv: [],
      env: {},
      include: [`packages/${name}/test/**/*.test.mjs`, `packages/${name}/scripts/*.test.mjs`],
    })),
  };
  const files = many.map((name) => ({ project: `web-${name}`, path: `web/${name}.test.ts` }));

  it.each(HARNESSES)(
    "folds projects into 'and N more' and keeps the not-covered sentence whole, under %s",
    async (harness) => {
      const out = primerOf(await sessionStart(repoFor({ policy, files, replace: true }), harness));
      expect(out.primer.length).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
      expect(out.primer.endsWith(NOT_COVERED)).toBe(true);
      expect(out.primer).toMatch(
        /Squeal covers Vitest \(vitest\.config\.ts\) and node:test projects "suite-00" \(/,
      );
      expect(out.primer).not.toContain("web-suite");
      expect(out.primer).toMatch(/ and \d+ more\. Squeal does not cover/);
    },
  );

  it("keeps the folded primer whole when a Codex hook cuts a long text", async () => {
    const out = primerOf(
      await sessionStart(repoFor({ policy, files, replace: true }), "codex"),
    ).primer;
    const text = `${Array.from({ length: 600 }, (_, i) => `FAIL  check ${i}`).join("\n")}\n\n${out}`;
    const capped = capContext(text, CODEX);
    expect(capped.length).toBeLessThanOrEqual(CONTEXT_CAP_CHARS);
    expect(capped.endsWith(`\n\n${out}`)).toBe(true);
  });
});

describe("the slow sentence by harness (spec 004 D8, D9)", () => {
  const slow = { vitest: true, vitestConfig: null, nodeTest: [], slow: { files: 3 } };

  it("is absent without slow files, under both harnesses", () => {
    for (const command of ["squeal", CODEX]) expect(primer(command)).not.toMatch(/slow/i);
    expect(PRIMER).toContain(`Squeal covers Vitest. ${NOT_COVERED}`);
  });

  /*
   * Task 001-283 (`research/primer-skill-writing.md` F1): the step before a
   * claim, with a completion criterion the agent reads off the header, and
   * the command that holds for slow files since 001-282. No "never during
   * Stop's wait": with `stop.requireSlowSuite` on, Stop waits (001-285).
   */
  it.each(["squeal", CODEX])(
    "names `run --slow --wait` as the step before a claim, under %s",
    (command) => {
      const text = primer(command, slow);
      expect(text).toContain(
        `Slow test files run when you pause between turns; before you say the task is done, run \`${command} run --slow --wait 60000\` unless the latest \`Slow tier:\` line states every slow file is current: it runs the rest and waits for them.`,
      );
      expect(text.indexOf("run --slow --wait")).toBeGreaterThan(text.indexOf("status --wait"));
      expect(text).not.toContain("Stop");
    },
  );

  it("under Claude Code, names the idle wake", () => {
    expect(primer("squeal", slow)).toContain(
      "A slow failure wakes you when you are idle in an interactive session; otherwise it arrives with your next prompt or tool call.",
    );
  });

  it("under Codex, says a slow failure arrives with the next prompt or tool call", () => {
    const text = primer(CODEX, slow);
    expect(text).toContain("A slow failure arrives with your next prompt or tool call.");
    expect(text).not.toContain("wakes you");
  });

  it("names the CLI by the primer's fallback when the path is long", () => {
    const command = `node "/${"x".repeat(700)}/dist/cli/squeal.mjs"`;
    const text = primer(command, slow);
    expect(text.length).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
    expect(text).toContain("run the CLI's `run --slow --wait 60000` unless");
  });
});

/*
 * Spec 005 D6: the primer, which reaches every session, says passing results
 * are silent and a message means a check changed (an agent with only the
 * primer took silence for lost messages), and defines a revision once, in
 * the human's wording, with and without slow files under both harnesses.
 */
describe("the primer's D6 sentences (005-15)", () => {
  const slow = { vitest: true, vitestConfig: null, nodeTest: [], slow: { files: 3 } };
  const cases = ["squeal", CODEX].flatMap((command) =>
    [VITEST_ONLY, slow].map((coverage) => [command, coverage] as const),
  );

  it.each(cases)(
    "says passes are silent and defines a revision once, under %s",
    (command, coverage) => {
      const text = primer(command, coverage);
      expect(text).toContain(
        "a SQUEAL message with your next tool call means a check changed, and passing results stay silent, so keep working;",
      );
      expect(text).toContain(` ${REVISION} Squeal covers `);
      expect(text.match(/A revision is /g)).toHaveLength(1);
      expect(text.length).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
    },
  );
});
