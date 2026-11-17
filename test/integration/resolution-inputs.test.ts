import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CheckId } from "../../src/core/types/check.js";
import { git } from "../hash/git-repo.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { SLOW } from "../scheduler/cleanup.js";
import { addWorktree, createRepo, openRepoStore } from "../scheduler/repo.js";
import { type Harness, openHarness } from "../scheduler/vitest-harness.js";

/*
 * Row 023-14, `023 research/glob-membership.md` S7 with the real Vitest
 * adapter: a test imports `#reg`, which the root `package.json` maps to
 * `src/reg-a.ts`. A retargeted entry, made while no daemon ran or in another
 * worktree, must not read as the stored pass. A test that imports nothing
 * through a manifest keeps its pass.
 */

const REG = "test/reg.test.ts";
const COUNT = "test/registry.test.ts";
const READS_A: CheckId = { kind: "test", project: "", testPath: REG, fullName: "reads a" };
const COUNTS: CheckId = { kind: "test", project: "", testPath: COUNT, fullName: "counts one" };

const FILES: Record<string, string> = {
  "src/reg-a.ts": 'export const value = "a";\n',
  "src/reg-b.ts": 'export const value = "b";\n',
  "src/registry.ts": "export const count = 1;\n",
  [REG]:
    'import { expect, it } from "vitest";\nimport { value } from "#reg";\nit("reads a", () => expect(value).toBe("a"));\n',
  [COUNT]:
    'import { expect, it } from "vitest";\nimport { count } from "../src/registry";\nit("counts one", () => expect(count).toBe(1));\n',
};

/** The root `package.json` with `#reg` mapped to `target`. */
function imports(root: string, target: string): void {
  const file = join(root, "package.json");
  const manifest = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  writeFileSync(file, `${JSON.stringify({ ...manifest, imports: { "#reg": target } }, null, 2)}\n`);
}

/** The `basic` fixture with both tests, committed. */
function resolutionRepo() {
  const repo = createRepo();
  for (const [path, text] of Object.entries(FILES)) writeFileSync(join(repo.main, path), text);
  imports(repo.main, "./src/reg-a.ts");
  commit(repo.main, "resolution inputs");
  return repo;
}

function commit(root: string, message: string): void {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", message]);
}

async function startIn(
  root: string,
  store: ReturnType<typeof openRepoStore>,
  commonDir: string,
  runMissing = false,
): Promise<Harness> {
  const h = await openHarness(root, store, commonDir, runMissing ? { policy: RUN_MISSING } : {});
  await h.scheduler.start();
  await h.quiet();
  return h;
}

async function stop(h: Harness): Promise<void> {
  await h.scheduler.close();
  await h.runner.close();
}

const CURRENT_PASS = { outcome: "pass", validity: "current" };

describe("what decides an import's resolution, in keys (row 023-14)", SLOW, () => {
  it("a restart reads a retargeted `imports` entry as stale, and its undo reuses the pass", async () => {
    const repo = resolutionRepo();
    const store = openRepoStore(repo.commonDir);
    const start = (runMissing = false) => startIn(repo.main, store, repo.commonDir, runMissing);
    const first = await start(true);
    expect(first.sink.stateOf(READS_A)).toMatchObject(CURRENT_PASS);
    expect(first.sink.stateOf(COUNTS)).toMatchObject(CURRENT_PASS);
    await stop(first);

    // S7: the entry retargeted while no daemon ran; `vitest run` reads "b".
    imports(repo.main, "./src/reg-b.ts");
    const second = await start();
    expect(second.sink.stateOf(READS_A)?.validity).toBe("stale");
    expect(second.sink.stateOf(COUNTS)).toMatchObject(CURRENT_PASS);
    await stop(second);

    // Undone: the stored pass is the one at this content, reused with no run.
    imports(repo.main, "./src/reg-a.ts");
    const third = await start();
    expect(third.sink.stateOf(READS_A)).toMatchObject(CURRENT_PASS);
    expect(third.runsOf(REG)).toEqual([]);
    await stop(third);
  });

  it("a second worktree at a commit that retargets the entry does not inherit its pass", async () => {
    const repo = resolutionRepo();
    const store = openRepoStore(repo.commonDir);
    const first = await startIn(repo.main, store, repo.commonDir, true);
    expect(first.sink.stateOf(READS_A)).toMatchObject(CURRENT_PASS);
    await stop(first);

    // The control: a worktree at the same commit inherits it.
    const same = addWorktree(repo.main, repo.dir, "same");
    const control = await startIn(same, store, repo.commonDir);
    expect(control.sink.stateOf(READS_A)).toMatchObject(CURRENT_PASS);
    await stop(control);

    const other = addWorktree(repo.main, repo.dir, "other");
    imports(other, "./src/reg-b.ts");
    commit(other, "retarget");
    const second = await startIn(other, store, repo.commonDir);
    // No state at all: the stored pass is not at this worktree's key, and lookup-only runs nothing.
    expect(second.sink.stateOf(READS_A)).toBeNull();
    expect(second.sink.stateOf(COUNTS)).toMatchObject(CURRENT_PASS);
    await stop(second);
  });
});
