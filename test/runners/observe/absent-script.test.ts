import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TestFileRef } from "../../../src/core/types/index.js";
import { git } from "../../hash/git-repo.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "../../scheduler/helpers.js";

/*
 * Task 011-60 (gh-56; research issue-56 F2): a Vitest test whose child
 * process imports a script that is missing fails, and creating the script
 * queues the file, whose next result replaces the FAIL.
 */
const CHILD = "test/child.test.ts";
const SCRIPT = "scripts/later.mjs";
const POOLS = ["forks", "threads"] as const;

describe("scheduler: a child's missing script (task 011-60)", SLOW, () => {
  it("re-runs the file when the script appears, and its pass replaces the fail", async () => {
    const repo = createRepo("observed");
    writeFileSync(
      join(repo.main, CHILD),
      [
        'import { execFileSync } from "node:child_process";',
        'import { expect, it } from "vitest";',
        `const url = new URL("../${SCRIPT}", import.meta.url).href;`,
        'it("loads the script its child imports", () => {',
        '  const code = "import answer from \'" + url + "\'; console.log(answer);";',
        '  const out = execFileSync(process.execPath, ["--input-type=module", "--eval", code], {',
        '    encoding: "utf8",',
        '    stdio: ["ignore", "pipe", "pipe"],',
        "  });",
        '  expect(out.trim()).toBe("42");',
        "});",
      ].join("\n"),
    );
    git(repo.main, ["add", "-A"]);
    git(repo.main, ["commit", "-qm", "child importer"]);
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, { observe: true });
    await h.scheduler.start();
    await h.scheduler.idle();
    const states = () =>
      h.store.knownStates
        .list(h.worktreeId)
        .filter((s) => s.check.testPath === CHILD)
        .map((s) => [s.check.project, s.outcome, s.validity])
        .sort();
    const ran = (from: number) =>
      h.runner.runs
        .slice(from)
        .flatMap((run) => run.files)
        .filter((f: TestFileRef) => f.path === CHILD)
        .map((f) => f.project)
        .sort();
    expect(states().filter(([, outcome]) => outcome === "fail")).not.toEqual([]);
    for (const pool of POOLS) {
      expect(store.testFiles.get({ project: pool, path: CHILD })?.closure.paths).toContain(SCRIPT);
    }

    const from = h.runner.runs.length;
    h.write(SCRIPT, "export default 42;\n");
    await h.batch(SCRIPT);
    await h.scheduler.idle();
    expect(ran(from)).toEqual(["forks", "threads"]);
    expect(
      states().every(([, outcome, validity]) => outcome === "pass" && validity === "current"),
    ).toBe(true);
    expect(states().length).toBeGreaterThan(0);
  });
});
