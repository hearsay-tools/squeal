import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { runGateFiles } from "../../src/cli/code-gate-files.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { quiet } from "../code/gate/host-load.js";
import { fixture, git, linkInstall, passesAt, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { prove } from "./proof-kit.js";
import { clean } from "./status-at-kit.js";
import { inProcessCommitDaemons } from "./status-at-real-daemon.js";

/*
 * Review 0.1.597 (row 023-42, spec 023 D4.9, D5.2, D7.6), on the
 * reviewer's probes. B1: a folder the test lists is no blob, and its key
 * hashes the tracked names only, so a stored pass from a caller whose
 * listing holds an ignored name must not stand for the commit's: the
 * green side reads `needs test/fixtures/`. B2: a proof D5.2 stops runs
 * nothing, so the persistent commit daemon is asked for no green run: the
 * test's side effect never appears in its worktree.
 */

const TEST = ref("test/a.test.ts");
const ON = { "squeal.config.json": "{}\n" };

/** Commit daemons in this process that live across the test's calls; stopped at its end. */
function kept() {
  const kit = inProcessCommitDaemons({ install: linkInstall().install });
  onTestFinished(() => kit.stop());
  return kit;
}

describe("review 0.1.597: the proof's green side on the commit daemon", SLOW, () => {
  it("B1: a stored pass from a caller listing with an ignored name is not the commit's", async () => {
    const f = fixture({
      ...ON,
      ".gitignore": "node_modules/\n*.log\n",
      "src/a.ts": "export const value = 1;\n",
      "test/fixtures/a.json": "{}\n",
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    const lists = [
      'import { readdirSync } from "node:fs";',
      'import { expect, it } from "vitest";',
      'import { value } from "../src/a";',
      'it("value", () => {',
      "  expect(value).toBe(2);",
      '  expect(readdirSync(new URL("./fixtures", import.meta.url)).length).toBe(2);',
      "});",
      "",
    ].join("\n");
    const head = f.commit({ "src/a.ts": "export const value = 2;\n", [TEST.path]: lists });
    // Only the caller's listing holds the ignored name; git sees a clean tree.
    writeFileSync(join(f.root, "test/fixtures/extra.log"), "x\n");
    const seeded = await runGateFiles({
      root: f.root,
      files: [TEST.path],
      budgetSeconds: 120,
      hostLoad: quiet,
    });
    expect(seeded.runs.map((r) => r.outcome)).toEqual(["passed"]);
    expect(git(f.root, "status", "--porcelain")).toBe("");
    expect(passesAt(f, head, TEST)).toBe(false);

    const kit = kept();
    const options = {
      cacheRoot: f.cacheRoot,
      install: linkInstall().install,
      daemons: kit.daemons,
    };
    const result = await prove(f, { files: [TEST.path], base: a, case: "source" }, options);
    expect(result.code, result.why).toBe(3);
    expect(result.files[0], result.why).toMatchObject({ verdict: "not comparable" });
    expect(result.out).toContain("needs test/fixtures/");
    expect(result.files[0]?.green).not.toMatchObject({ end: "pass" });
    await kit.stop();
    clean(f);
  });

  it("B2: a proof D5.2 stops asks the commit daemon for no green run", async () => {
    const marked = [
      'import { writeFileSync } from "node:fs";',
      'import { expect, it } from "vitest";',
      'import { value } from "../src/a";',
      'it("value", () => {',
      '  writeFileSync(new URL("../ran.marker", import.meta.url), "");',
      "  expect(value).toBe(2);",
      "});",
      "",
    ].join("\n");
    const f = fixture({
      ...ON,
      "src/a.ts": "export const value = 1;\n",
      "docs/info.md": "a\n",
      [TEST.path]: marked,
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "src/a.ts": "export const value = 2;\n", "docs/info.md": "b\n" });
    const kit = kept();
    const options = {
      cacheRoot: f.cacheRoot,
      install: linkInstall().install,
      daemons: kit.daemons,
    };
    const result = await prove(f, { files: [TEST.path], base: a, source: ["src/a.ts"] }, options);
    expect(result.code, result.why).toBe(3);
    expect(result.out).toContain("docs/info.md");
    expect(result.report.runs).toBe(0);
    expect(kit.started).toHaveLength(1);
    const tree = kit.started[0] as AbsolutePath;
    // Whatever the daemon was asked has finished once its wait returns.
    expect(await kit.daemons.wait(tree, [TEST], Date.now() + 60_000)).toBeNull();
    expect(existsSync(join(tree, "ran.marker"))).toBe(false);
    await kit.stop();
    clean(f);
  });
});
