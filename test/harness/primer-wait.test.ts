import { describe, expect, it } from "vitest";
import type { Coverage } from "../../src/harness/shared/coverage.js";
import { PRIMER, PRIMER_CAP_CHARS, primer } from "../../src/harness/shared/primer.js";
import { CODEX } from "./primer-helpers.js";

/*
 * Spec 005 D6 as amended by the human (2026-10-17, task 005-68, issue 18):
 * the primer names the path wait, its verdict, and when each wait applies.
 * An agent that knew only `status --wait 60000` waited on a whole suite
 * other edits had re-keyed, then ran the tests it needed itself. Row 005-94
 * (the human, 2026-11-17, C3): no checkpoint in the wait sentence, and the
 * path wait in every primer it fits, tried before the plain wait, with row
 * 005-89's drop order. Today's plain sentence stays only where no drop makes
 * room for the CLI's name at the path wait.
 */

const PATH_WAIT = (cli: string) =>
  `Wait only when you need a result before your next step: \`${cli} status --wait 60000 <path>...\` for the verdict on files you just changed, and the CLI's \`status --wait 60000\` before you finish.`;

const SCRIPTS = { name: "scripts", include: ["scripts/*.test.mjs"] };
const E2E = { name: "e2e", include: ["e2e/**/*.test.mjs"] };
const coverage = (nodeTest: Coverage["nodeTest"], slow: Coverage["slow"]): Coverage => ({
  vitest: true,
  vitestConfig: "vitest.config.ts",
  nodeTest,
  slow,
});

describe("the primer's waits (005-68, 005-94)", () => {
  it("names the path wait for files just changed, then the wait before finishing", () => {
    const wait = PRIMER.slice(PRIMER.indexOf("Wait only"), PRIMER.indexOf(" Run tests yourself"));
    expect(wait).toBe(
      "Wait only when you need a result before your next step: `squeal status --wait 60000 <path>...` for the verdict on files you just changed, and `squeal status --wait 60000` before you finish.",
    );
    expect(PRIMER).not.toContain("checkpoint");
    expect(PRIMER.indexOf("next tool call")).toBeLessThan(PRIMER.indexOf("status --wait"));
  });

  it("names a Codex CLI in full once, as the path wait", () => {
    const text = primer(CODEX);
    expect(text).toContain(PATH_WAIT(CODEX));
    expect(text.split(CODEX)).toHaveLength(2);
  });

  it("says the CLI once, up front, where no drop makes room to name it", () => {
    const root = `/home/user/${"x".repeat(1_000)}/.codex/plugins/cache/hearsay/squeal/0.1.109`;
    const text = primer(root, coverage([], { files: 3 }));
    expect(text).toContain(
      "Wait only when you need a result before your next step, on the CLI SQUEAL messages name: `status --wait 60000 <path>...` for the verdict on files you just changed, and `status --wait 60000` before you finish.",
    );
    expect(text).not.toContain(root);
    expect(text.length).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
  });

  /*
   * Row 005-94: under Codex with slow files the path wait is said, where today's plain
   * sentence was; the slow arrival goes first (row 005-89), then the retry.
   */
  it("names the path wait under Codex with slow files", () => {
    for (const slow of [{ files: 2 }, { files: 2, requireSlowSuite: true }]) {
      const text = primer(CODEX, coverage([], slow));
      expect(text).toContain(PATH_WAIT(CODEX));
      expect(text).toContain("the CLI's `run --slow --wait 60000`");
      expect(text).not.toContain("A slow failure");
      expect(text).not.toContain("for example before saying the task is done");
      expect(text.length).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
    }
  });

  /*
   * Task 004-78 (research `atomic-flags-0215.md` 2, line 3): at the eval
   * cell's 217-character Codex CLI the primer named no CLI and kept the path
   * wait, and agents ran `status --wait` with no CLI. Row 005-94: the CLI is
   * named at the path wait, and the retry goes before it (row 005-89).
   */
  it("names a 217-character Codex CLI at the path wait, under either slow policy", () => {
    const home =
      "/tmp/squeal-evals-1001/cells/581f1772dc45/20261018T125937Z-bcdbec/a3-harmless.p0.codex-gpt-6-luna.e-medium.r3/codex";
    const cli = `node --disable-warning=ExperimentalWarning "${home}/plugins/cache/hearsay/squeal/0.1.215/dist/cli/squeal.mjs"`;
    expect(cli).toHaveLength(217);
    for (const requireSlowSuite of [false, true]) {
      const text = primer(cli, coverage([], { files: 1, requireSlowSuite }));
      expect(text).toContain(PATH_WAIT(cli));
      expect(text).toContain("the CLI's `run --slow --wait 60000`");
      expect(text).not.toContain("CLI SQUEAL messages name");
      expect(text).not.toContain("--reason load");
      expect(text.length).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
    }
  });

  /*
   * The 004 coordinator (2026-10-18) bounded the short sentence's reach at 230 to 237
   * characters. Row 005-94: the path wait with the CLI named reaches past it, with text dropped
   * in row 005-89's order; at 500 characters it is the definition of a revision that goes last.
   */
  it("names a long CLI at the path wait under every slow policy", () => {
    for (const [requireSlowSuite, pausesOnly] of [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ] as const) {
      const slow = coverage([], { files: 1, requireSlowSuite, pausesOnly });
      for (const length of [230, 250, 500]) {
        const at = "x".repeat(length);
        const text = primer(at, slow);
        expect(text).toContain(PATH_WAIT(at));
        expect(text.length).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
      }
    }
  });

  it("keeps every project and the path wait under Claude Code with slow files and projects", () => {
    const text = primer("squeal", coverage([SCRIPTS, E2E], { files: 2, requireSlowSuite: true }));
    expect(text).toContain("`squeal status --wait 60000 <path>...`");
    expect(text).toContain("`squeal run --slow --wait 60000`");
    expect(text).toContain('node:test projects "scripts" (scripts/*.test.mjs) and "e2e"');
    expect(text.length).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
  });

  it("keeps the path wait under Claude Code with slow files alone", () => {
    const text = primer("squeal", coverage([], { files: 2, requireSlowSuite: true }));
    expect(text).toContain("`squeal status --wait 60000 <path>...`");
    expect(text).toContain("`squeal run --slow --wait 60000`");
    expect(text.length).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
  });
});
