import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { globListingsMetaKey } from "../../src/core/keys/glob-listings.js";
import type { CheckId } from "../../src/core/types/check.js";
import { git } from "../hash/git-repo.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { SLOW } from "../scheduler/cleanup.js";
import { addWorktree, createRepo, openRepoStore } from "../scheduler/repo.js";
import { type Harness, openHarness } from "../scheduler/vitest-harness.js";

/*
 * Row 023-13 (fix A), `023 research/glob-membership.md` S2 to S4 with the
 * real Vitest adapter: a module globs `./plugins/*.ts` and the test expects
 * one plugin. A file added while no daemon ran, or present in another
 * worktree, must not read as the stored pass.
 */

const TEST = "test/registry.test.ts";
const COUNTS: CheckId = { kind: "test", project: "", testPath: TEST, fullName: "counts one" };
const PLUGIN = "src/plugins/new.ts";

const FILES: Record<string, string> = {
  "src/plugins/kept.ts": 'export const name = "kept";\n',
  "src/registry.ts": [
    "// import.meta.glob('./decoy/*.ts') in a comment lists nothing",
    'const plugins = import.meta.glob("./plugins/*.ts", { eager: true });',
    "export const count = Object.keys(plugins).length;",
    "",
  ].join("\n"),
  [TEST]: [
    'import { expect, it } from "vitest";',
    'import { count } from "../src/registry.ts";',
    'it("counts one", () => expect(count).toBe(1));',
    "",
  ].join("\n"),
};

/** The `basic` fixture with the glob module, committed. */
function globRepo() {
  const repo = createRepo();
  for (const [path, text] of Object.entries(FILES)) write(repo.main, path, text);
  git(repo.main, ["add", "-A"]);
  git(repo.main, ["commit", "-qm", "glob"]);
  return repo;
}

function write(root: string, path: string, text: string): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}

/** A daemon's start in `root`, quiet, then its state of `COUNTS` and its runs of the test. */
async function startIn(
  root: string,
  store: ReturnType<typeof openRepoStore>,
  commonDir: string,
  runMissing = false,
  runtimeInputs = true,
): Promise<Harness> {
  const policy = { ...(runMissing ? RUN_MISSING : {}), observe: { runtimeInputs } };
  const h = await openHarness(root, store, commonDir, { policy });
  await h.scheduler.start();
  await h.quiet();
  return h;
}

async function stop(h: Harness): Promise<void> {
  await h.scheduler.close();
  await h.runner.close();
}

const passes = (h: Harness) => h.sink.stateOf(COUNTS);

describe("a glob's folder membership in keys (row 023-13)", SLOW, () => {
  // The listings key a closure whatever policy `observe.runtimeInputs` says.
  it.each([true, false])(
    "a restart reads an added matching file as stale, and its removal reuses the pass (observe %s)",
    async (observe) => {
      const repo = globRepo();
      const store = openRepoStore(repo.commonDir);
      const start = (root: string, runMissing = false) =>
        startIn(root, store, repo.commonDir, runMissing, observe);
      const first = await start(repo.main, true);
      expect(passes(first)).toMatchObject({ outcome: "pass", validity: "current" });
      expect(JSON.parse(store.meta.get(globListingsMetaKey("")) ?? "{}")).toEqual({
        "src/registry.ts": ["src/plugins/"],
      });
      await stop(first);

      // S2: added while no daemon ran.
      write(repo.main, PLUGIN, 'export const name = "new";\n');
      const second = await start(repo.main);
      expect(passes(second)?.validity).toBe("stale");
      await stop(second);

      // Removed again: the stored pass is the one at this content, reused with no run.
      rmSync(join(repo.main, PLUGIN));
      const third = await start(repo.main);
      expect(passes(third)).toMatchObject({ outcome: "pass", validity: "current" });
      expect(third.runsOf(TEST)).toEqual([]);
      await stop(third);
    },
  );

  it("a second worktree at a commit with an added matching file does not inherit the pass", async () => {
    const repo = globRepo();
    const store = openRepoStore(repo.commonDir);
    const first = await startIn(repo.main, store, repo.commonDir, true);
    expect(passes(first)).toMatchObject({ outcome: "pass", validity: "current" });
    await stop(first);

    // S4: the other worktree's commit adds the file; its daemon starts for the first time.
    const other = addWorktree(repo.main, repo.dir, "other");
    write(other, PLUGIN, 'export const name = "new";\n');
    git(other, ["add", "-A"]);
    git(other, ["commit", "-qm", "add new"]);
    const second = await startIn(other, store, repo.commonDir);
    // No state at all: the stored pass is not at this worktree's key, and lookup-only runs nothing.
    expect(passes(second)).toBeNull();
    await stop(second);
  });
});
