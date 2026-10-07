import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDaemonNotes } from "../../src/core/notes.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "../scheduler/helpers.js";
import { type FixturePackage, writeInstall } from "./install.js";

// Task 001-109, review wave-11b S1 and S2, through the scheduler: a stale hidden lockfile is noted
// once per state, not once per daemon start; a package folder added under a running scheduler
// without rewriting the lockfile re-keys before the next tier, without a restart.

const INSTALL: Readonly<Record<string, FixturePackage>> = {
  "node_modules/kept": {
    version: "1.0.0",
    manifest: { type: "module" },
    files: { "index.js": 'export const version = "1.0.0";\n' },
  },
};

const SIDE = "test/side.test.ts";
const SIDE_TEST =
  'import { side } from "sideloaded";\nimport { expect, it } from "vitest";\n' +
  'it("loads a side-loaded package", () => {\n  expect(side).toBe(1);\n});\n';

const sideload = (root: string) => {
  const write = (path: string, content: string) => writeFileSync(join(root, path), content);
  mkdirSync(join(root, "node_modules/sideloaded"), { recursive: true });
  write(
    "node_modules/sideloaded/package.json",
    JSON.stringify({ name: "sideloaded", version: "1.0.0", type: "module" }),
  );
  write("node_modules/sideloaded/index.js", "export const side = 1;\n");
};

const staleNotes = (store: Parameters<typeof readDaemonNotes>[0], worktreeId: string) =>
  readDaemonNotes(store, worktreeId).filter((note) => note.text.includes("does not describe"));

describe("installs under a running daemon (001-109)", SLOW, () => {
  it("notes a stale hidden lockfile once, not again at a restart (S1)", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    writeInstall(repo.main, INSTALL);
    sideload(repo.main);
    const first = await openHarness(repo.main, store, repo.commonDir, { tierSize: 10 });
    await first.scheduler.start();
    await first.scheduler.idle();
    expect(staleNotes(store, first.worktreeId)).toHaveLength(1);
    await first.scheduler.close();

    const second = await openHarness(repo.main, store, repo.commonDir, { tierSize: 10 });
    await second.scheduler.start();
    await second.scheduler.idle();
    expect(staleNotes(store, second.worktreeId)).toHaveLength(1);
  });

  it("re-keys when a package folder appears without the lockfile being rewritten (S2)", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    writeFileSync(join(repo.main, SIDE), SIDE_TEST);
    writeInstall(repo.main, INSTALL);
    const h = await openHarness(repo.main, store, repo.commonDir, { tierSize: 10 });
    await h.scheduler.start();
    await h.scheduler.idle();
    const before = h.keyOf(SIDE);
    const runs = h.runsOf(SIDE).length;
    expect(before).not.toBeNull();

    sideload(repo.main);
    // Any batch starts the pump; the lockfile is unchanged, so this one creates no revision.
    await h.scheduler.handleBatch({ trigger: "interval", paths: [] });
    await h.scheduler.idle();

    expect(h.keyOf(SIDE)).not.toBe(before);
    expect(h.runsOf(SIDE).length).toBeGreaterThan(runs);
    expect(staleNotes(store, h.worktreeId)).toHaveLength(1);
  });
});
