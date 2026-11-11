import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createNodeTestRunnerSet } from "../../src/core/daemon/node-test-runners.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import type { NodeTestProject } from "../../src/core/types/policy.js";

/*
 * Spec 020 D15.6 (row 020-16b): the daemon does not open a node:test entry
 * that has a `prepare`, so it lists none of its files, and it notes this
 * once; only `squeal code --base` runs the command.
 */

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(name: string, more: Partial<NodeTestProject> = {}): NodeTestProject {
  return { name, cwd: name, argv: [], env: {}, include: ["*.test.mjs"], ...more };
}

const BUILD = { command: ["node", "scripts/build.mjs"] };

describe("the daemon's node:test entries with a prepare (spec 020 D15.6)", () => {
  it("lists no file of such an entry and notes it once", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "squeal-prepare-daemon-")));
    dirs.push(root);
    for (const name of ["unit", "package"]) {
      mkdirSync(join(root, name));
      writeFileSync(join(root, name, "a.test.mjs"), 'import "node:test";\n');
    }
    const notes: string[] = [];
    let entries = [project("unit"), project("package", { prepare: BUILD })];
    const set = createNodeTestRunnerSet(() => entries, {
      root: root as AbsolutePath,
      tempDir: root as AbsolutePath,
      tierSize: () => 1,
      note: (text) => notes.push(text),
    });
    const members = set.members();
    expect(members).toHaveLength(1);
    const listed = (await Promise.all(members.map((m) => m.testFiles()))).flat();
    expect(listed).toEqual([{ project: "unit", path: "unit/a.test.mjs" }]);

    // A reload that keeps the entry does not note it again, nor open it.
    entries = [...entries];
    expect(set.reconcile().projects).toEqual([]);
    expect(set.members()).toHaveLength(1);
    const prepared = notes.filter((n) => n.includes("prepare"));
    expect(prepared).toEqual([
      'node-test project "package" has a prepare command, so Squeal does not run its tests in the background; squeal code --base runs the prepare, then them',
    ]);

    // Without the prepare, a reload opens it.
    entries = [project("unit"), project("package")];
    expect(set.reconcile().projects).toEqual(["package"]);
    expect(set.members()).toHaveLength(2);
    await Promise.allSettled(set.members().map((m) => m.close()));
    await Promise.allSettled(members.map((m) => m.close()));
  });
});
