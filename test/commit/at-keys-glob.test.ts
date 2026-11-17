import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { type KeyAt, keysAtCommit, sideKeys } from "../../src/core/commit/at-keys.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { git } from "../hash/git-repo.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { SLOW } from "../scheduler/cleanup.js";
import { addWorktree, createRepo, openRepoStore } from "../scheduler/repo.js";
import { type Harness, openHarness } from "../scheduler/vitest-harness.js";

/*
 * Re-review of wave 1 B1 (row 023-03 after fix A, row 023-13), with the
 * real Vitest adapter: `src/registry.ts` globs `./plugins/*.ts`; commit A
 * holds `kept.ts` and `old.ts`, commit B only removes `old.ts`. Every file
 * the importing test names is byte-equal at A and B, but A's run reads
 * `old.ts`. A worktree at B asking for A's key must get the key a daemon at
 * A computes, or not determined, never another key; also through
 * `sideKeys`.
 */

const TEST = "test/registry.test.ts";
const REF = { project: "", path: TEST };
const ID = testFileId(REF);

const FILES: Record<string, string> = {
  "src/plugins/kept.ts": 'export const name = "kept";\n',
  "src/plugins/old.ts": 'export const name = "old";\n',
  "src/registry.ts":
    'const plugins = import.meta.glob("./plugins/*.ts", { eager: true });\nexport const count = Object.keys(plugins).length;\n',
  [TEST]: [
    'import { expect, it } from "vitest";',
    'import { count } from "../src/registry";',
    'it("counts", () => expect(count).toBeGreaterThan(0));',
    "",
  ].join("\n"),
};

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

async function started(root: string, h: () => Promise<Harness>): Promise<Harness> {
  const harness = await h();
  await harness.scheduler.start();
  await harness.quiet();
  expect(harness.keyOf(TEST), root).not.toBeNull();
  return harness;
}

async function stop(h: Harness): Promise<void> {
  await h.scheduler.close();
  await h.runner.close();
}

/** Either the daemon's exact key or not determined: never another key. */
function exactOrOpen(at: KeyAt | undefined, daemon: string | null): void {
  expect(at).toBeDefined();
  if (at !== undefined && "key" in at) expect(at.key).toBe(daemon);
  else expect(at).toMatchObject({ notDetermined: { reason: "closure" } });
}

describe("keys at a commit across a glob's removed match (re-review B1)", SLOW, () => {
  it("give the daemon's key at A, or not determined, from a worktree at B", async () => {
    const repo = createRepo();
    for (const [path, text] of Object.entries(FILES)) write(repo.main, path, text);
    git(repo.main, ["add", "-A"]);
    git(repo.main, ["commit", "-qm", "A"]);
    const commitA = git(repo.main, ["rev-parse", "HEAD"]).trim();
    const other = addWorktree(repo.main, repo.dir, "at-a");
    rmSync(join(repo.main, "src/plugins/old.ts"));
    git(repo.main, ["commit", "-qam", "B"]);
    const commitB = git(repo.main, ["rev-parse", "HEAD"]).trim();

    const store = openRepoStore(repo.commonDir);
    const options = { policy: RUN_MISSING };
    const atA = await started(other, () => openHarness(other, store, repo.commonDir, options));
    const daemonAtA = atA.keyOf(TEST);
    expect(store.testFiles.get(REF)?.closure.paths).toContain("src/plugins/old.ts");
    await stop(atA);
    // B's daemon starts last: the stored list is B's, without `old.ts`.
    const atB = await started(repo.main, () =>
      openHarness(repo.main, store, repo.commonDir, options),
    );
    const daemonAtB = atB.keyOf(TEST);
    expect(daemonAtB).not.toBe(daemonAtA);
    const list = store.testFiles.get(REF)?.closure.paths ?? [];
    expect(list).not.toContain("src/plugins/old.ts");
    expect(list).toContain("src/plugins/");

    const asked = { root: repo.main, store, worktreeId: atB.worktreeId, inputs: [], files: [REF] };
    const keys = await keysAtCommit({ ...asked, commit: commitA });
    exactOrOpen(keys.get(ID), daemonAtA);
    expect(keys.get(ID)).toEqual({
      notDetermined: {
        reason: "closure",
        detail:
          "src/plugins/old.ts at the commit is in the listed folder src/plugins/, not in the list",
      },
    });
    // At its own commit the worktree's key is the daemon's.
    const own = await keysAtCommit({ ...asked, commit: commitB });
    expect(own.get(ID)).toMatchObject({ key: daemonAtB, step: 1 });

    // D5.1: the test is equal at A and B, so the side's key follows the code commit.
    const testPaths = [TEST];
    const oldCode = await sideKeys({ ...asked, code: commitA, tests: commitB, testPaths });
    exactOrOpen(oldCode.get(ID), daemonAtA);
    const newCode = await sideKeys({ ...asked, code: commitB, tests: commitA, testPaths });
    expect(newCode.get(ID)).toMatchObject({ key: daemonAtB });
    await stop(atB);
  });
});
