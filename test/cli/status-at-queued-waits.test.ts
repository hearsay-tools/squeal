import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import { publishGroupActivity } from "../../src/core/slow/state.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { SlowTierActivity } from "../../src/core/types/status.js";
import { type Fixture, fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { run, standIn, standInTree, testOf, withStore } from "./status-at-kit.js";

/*
 * Row 023-71 (dogfood round 9, Y1) on a `$TMPDIR` git fixture with
 * stand-in daemons. A narrowed call names a file of a `manual` browser
 * group that is queued at the commit and has not started. Round 9 read
 * "1 of 1 still running at <c>" with "about 2 min for 1 test file" for 300
 * to 930 s while the per-file line said "queued". The call now says
 * queued, gives the wait the commit daemon publishes for the group's lane
 * (only when it publishes one), and gives no time while the file waits.
 */

const B1 = ref("test/b1.test.ts");
const B2 = ref("test/b2.test.ts");
const ALL = [B1, B2];
const CONFIG = {
  checks: [
    {
      name: "browser",
      runner: "vitest",
      tests: ["test/b*.test.ts"],
      at: "manual",
      limits: { maxParallel: 1, maxWorkers: 1, priority: "low" },
    },
  ],
};

/** Commit A with two browser tests, and HEAD changing `src/a.ts`, which they read. */
function two() {
  const f = fixture({
    "squeal.config.json": `${JSON.stringify(CONFIG)}\n`,
    "src/a.ts": "export const value = 2;\n",
    ...Object.fromEntries(ALL.map((file) => [file.path, testOf("a", 2)])),
  });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 2; // b\n" });
  return { f, a };
}

/** Marks `files` queued in the daemon of `tree`, at the stand-in's keys. */
function queued(f: Fixture, tree: string, files: readonly TestFileRef[]) {
  withStore(f, (store) =>
    store.testFileKeys.upsertMany(
      files.map((testFile) => ({
        worktreeId: worktreeIdFor(tree as AbsolutePath),
        testFile,
        key: `commit-${testFile.path}`,
        revision: 2,
        pending: "queued" as const,
      })),
    ),
  );
}

/** A narrowed `--run` on `B1` whose commit daemon's browser lane published `activity`. */
async function narrowed(activity: SlowTierActivity | null) {
  const { f, a } = two();
  const tree = standInTree(f);
  // The stand-in's tree is an empty folder: its policy is the commit's, with the browser group.
  writeFileSync(join(tree, "squeal.config.json"), `${JSON.stringify(CONFIG)}\n`);
  const daemons = standIn(tree, () => undefined, {
    select: (ask) => (ask.named.length === 0 ? ALL : ALL.filter((r) => ask.named.includes(r.path))),
    rows: (at, files) => {
      queued(f, at, files);
      withStore(f, (store) =>
        publishGroupActivity(store, worktreeIdFor(at as AbsolutePath), "browser", activity),
      );
    },
    selects: 2,
  });
  const options = {
    cacheRoot: f.cacheRoot,
    install: linkInstall().install,
    daemons: daemons.ports,
  };
  const out = await run(
    f,
    { commit: a, paths: [B1.path], run: { allMissing: false }, waitMs: 1000 },
    options,
  );
  return { out: out.out, at: a.slice(0, 9) };
}

describe("a named file queued at the commit (row 023-71, Y1)", SLOW, () => {
  it("reads queued, with the slot wait its daemon publishes, and no time while it waits", async () => {
    const { out, at } = await narrowed({ kind: "waiting", for: "slot" });
    const slot = "the browser group's slot, which another daemon holds";
    expect(out).toContain(`${B1.path}: 1 of 1 queued at ${at}, waiting for ${slot}, `);
    expect(out).not.toContain(`still running at ${at}`);
    expect(out).toContain(
      `Still to run, at ${at}: 1 test file, time unknown: waiting for capacity (${slot})`,
    );
    expect(out).toContain(`0 running and 1 queued at ${at} (its worktree)`);
  });

  it("names a pool wait by the pool's permits", async () => {
    const { out, at } = await narrowed({ kind: "waiting", for: "pool" });
    expect(out).toMatch(
      new RegExp(
        `${B1.path}: 1 of 1 queued at ${at}, waiting for a free test process: the shared worker pool's \\d+ permits are held by other work, `,
      ),
    );
  });

  it("gives no reason where the daemon publishes none", async () => {
    const { out, at } = await narrowed(null);
    expect(out).toContain(`${B1.path}: 1 of 1 queued at ${at}, `);
    expect(out).not.toContain("waiting for");
    expect(out).toContain(
      `Still to run, at ${at}: 1 test file, time unknown: not started yet, and the daemon does not say what holds it`,
    );
  });
});
