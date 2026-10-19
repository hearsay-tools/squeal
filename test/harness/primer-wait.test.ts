import { describe, expect, it } from "vitest";
import type { Coverage } from "../../src/harness/shared/coverage.js";
import { PRIMER, PRIMER_CAP_CHARS, primer } from "../../src/harness/shared/primer.js";
import { CODEX } from "./primer-helpers.js";

/*
 * Spec 005 D6 as amended by the human (2026-10-17, task 005-68, issue 18):
 * the primer names the path wait, its verdict, and when each wait applies.
 * An agent that knew only `status --wait 60000` waited on a whole suite
 * other edits had re-keyed, then ran the tests it needed itself.
 */

const TODAY = (wait: string) =>
  `Wait only when you need a result before your next step, for example before saying the task is done: ${wait}.`;

const SCRIPTS = { name: "scripts", include: ["scripts/*.test.mjs"] };
const E2E = { name: "e2e", include: ["e2e/**/*.test.mjs"] };
const coverage = (nodeTest: Coverage["nodeTest"], slow: Coverage["slow"]): Coverage => ({
  vitest: true,
  vitestConfig: "vitest.config.ts",
  nodeTest,
  slow,
});

describe("the primer's waits (005-68)", () => {
  it("names the path wait for files just changed, then the waits before finishing", () => {
    const wait = PRIMER.slice(PRIMER.indexOf("Wait only"), PRIMER.indexOf(" Run tests yourself"));
    expect(wait).toBe(
      "Wait only when you need a result before your next step: `squeal status --wait 60000 <path>...` for the verdict on files you just changed; before you finish, `squeal status --wait 60000` or a checkpoint, `squeal run --all --wait`.",
    );
    expect(PRIMER.indexOf("next tool call")).toBeLessThan(PRIMER.indexOf("status --wait"));
  });

  it("names a Codex CLI in full once, as the path wait", () => {
    const text = primer(CODEX);
    expect(text).toContain(
      `\`${CODEX} status --wait 60000 <path>...\` for the verdict on files you just changed; before you finish, the CLI's \`status --wait 60000\` or a checkpoint, the CLI's \`run --all --wait\`.`,
    );
    expect(text.split(CODEX)).toHaveLength(2);
  });

  it("says the CLI once, up front, where the primer names it nowhere", () => {
    const root = `/home/agent/${"x".repeat(250)}/.codex/plugins/cache/hearsay/squeal/0.1.109`;
    const text = primer(root, coverage([], { files: 3 }));
    expect(text).toContain(
      "Wait only when you need a result before your next step, on the CLI SQUEAL messages name: `status --wait 60000 <path>...` for the verdict on files you just changed; before you finish, `status --wait 60000` or a checkpoint, `run --all --wait`.",
    );
    expect(text).not.toContain(root);
  });

  /*
   * The 005 coordinator (2026-10-17): the primer folds its projects, then
   * the path wait, then the CLI's naming. Where the path wait does not fit,
   * the primer keeps today's wait sentence and today's naming.
   */
  it("keeps today's sentence and first command under Codex with slow files", () => {
    for (const slow of [{ files: 2 }, { files: 2, requireSlowSuite: true }]) {
      const text = primer(CODEX, coverage([], slow));
      expect(text).toContain(TODAY(`\`${CODEX} status --wait 60000\``));
      expect(text).toContain("the CLI's `run --slow --wait 60000`");
      expect(text).not.toContain("<path>");
      expect(text.length).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
    }
  });

  /*
   * Task 004-78 (research `atomic-flags-0215.md` 2, line 3): at the eval
   * cell's 217-character Codex CLI the primer named no CLI and kept the path
   * wait, and agents ran `status --wait` with no CLI. The fold now drops the
   * path wait and the sentence's example before it drops the CLI's name.
   */
  it("names a 217-character Codex CLI at the wait, under either slow policy", () => {
    const home =
      "/tmp/squeal-evals-1001/cells/581f1772dc45/20261018T125937Z-bcdbec/a3-harmless.p0.codex-gpt-6-luna.e-medium.r3/codex";
    const cli = `node --disable-warning=ExperimentalWarning "${home}/plugins/cache/hearsay/squeal/0.1.215/dist/cli/squeal.mjs"`;
    expect(cli).toHaveLength(217);
    for (const requireSlowSuite of [false, true]) {
      const text = primer(cli, coverage([], { files: 1, requireSlowSuite }));
      expect(text).toContain(
        `Wait only when you need a result, as before you finish: \`${cli} status --wait 60000\`.`,
      );
      expect(text).toContain("the CLI's `run --slow --wait 60000`");
      expect(text).not.toContain("CLI SQUEAL messages name");
      expect(text.length).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
    }
  });

  /*
   * The 004 coordinator (2026-10-18): the short sentence is tried once the
   * projects are folded and before the CLI goes unnamed. At 230 characters
   * it still fits under either policy; past it the primer names no CLI path,
   * as before 004-78, and keeps the path wait. Under either `slow.trigger`
   * (004-80): the continuous sentence is 8 characters shorter, so its reach
   * is 238 to 241 characters against idle's 230 to 233; 250 is past both.
   */
  it("names a 230-character CLI at the wait, and none past the fold's reach", () => {
    for (const [requireSlowSuite, pausesOnly] of [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ] as const) {
      const slow = coverage([], { files: 1, requireSlowSuite, pausesOnly });
      const at = "x".repeat(230);
      const text = primer(at, slow);
      expect(text).toContain(`\`${at} status --wait 60000\`.`);
      expect(text.length).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
      const past = "x".repeat(250);
      const none = primer(past, slow);
      expect(none).not.toContain(past);
      expect(none).toContain("on the CLI SQUEAL messages name: `status --wait 60000 <path>...`");
    }
  });

  it("keeps every project and today's sentence under Claude Code with slow files and projects", () => {
    const text = primer("squeal", coverage([SCRIPTS, E2E], { files: 2, requireSlowSuite: true }));
    expect(text).toContain(TODAY("`squeal status --wait 60000`"));
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
