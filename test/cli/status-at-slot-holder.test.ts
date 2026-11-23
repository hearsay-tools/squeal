import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import { slotDirOf } from "../../src/core/scheduler/group-limits.js";
import { acquireSlowSlot } from "../../src/core/slow/slot.js";
import { publishGroupActivity } from "../../src/core/slow/state.js";
import type { AbsolutePath, WorktreeId } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { type Fixture, fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { run, standIn, standInTree, testOf, withStore } from "./status-at-kit.js";

/*
 * Row 023-77 (dogfood round 10, Z1) on a `$TMPDIR` git fixture with
 * stand-in daemons. A narrowed call names a browser file queued at the
 * commit, whose lane publishes that it waits for the group's slot. The
 * working tree holds the slot, running the same file: the call names it,
 * with the time held and, from the file's stored duration, the time left.
 * A slot with no recorded holder, or a dead one, reads as before.
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

let runtime: string;
beforeEach(() => {
  runtime = mkdtempSync(join(tmpdir(), "squeal-023-77-run-"));
  vi.stubEnv("XDG_RUNTIME_DIR", runtime);
  // No host config: the slot is the repository's (`capacity.groupSlotScope` default).
  vi.stubEnv("XDG_CONFIG_HOME", join(runtime, "config"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(runtime, { recursive: true, force: true });
});

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

/** The browser slot's directory for the fixture's repository, as both daemons name it. */
const slotDir = (f: Fixture) =>
  slotDirOf("browser", join(runtime, "squeal"), {
    scope: "repository",
    commonDir: join(f.root, ".git"),
  });

/**
 * A narrowed `--run` on `B1`; the commit daemon's browser lane waits for
 * the slot, and `hold` takes the slot (or not) before the call reads it.
 */
async function narrowed(hold: (f: Fixture) => void) {
  const { f, a } = two();
  const tree = standInTree(f);
  writeFileSync(join(tree, "squeal.config.json"), `${JSON.stringify(CONFIG)}\n`);
  const commitId = worktreeIdFor(tree);
  withStore(f, (store) =>
    store.worktrees.upsert({
      id: commitId,
      root: tree,
      commonDir: join(f.root, ".git"),
      isMain: false,
      registeredAt: Date.now(),
      daemon: null,
    }),
  );
  hold(f);
  const daemons = standIn(tree, () => undefined, {
    select: (ask) => (ask.named.length === 0 ? ALL : ALL.filter((r) => ask.named.includes(r.path))),
    rows: (at, files) => {
      queued(f, at, files);
      withStore(f, (store) =>
        publishGroupActivity(store, worktreeIdFor(at as AbsolutePath), "browser", {
          kind: "waiting",
          for: "slot",
        }),
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

const WAITING = (at: string) =>
  `${B1.path}: 1 of 1 queued at ${at}, waiting for the browser group's slot`;

describe("a file waiting for the shared slot names its holder (row 023-77, Z1)", SLOW, () => {
  it("names the working tree's run of the same file, with the time held and left", async () => {
    let release = () => {};
    const { out, at } = await narrowed((f) => {
      const owner = { pid: process.pid, worktreeId: worktreeIdFor(f.root as AbsolutePath) };
      const slot = acquireSlowSlot({ dir: slotDir(f), owner, group: "browser" });
      slot?.holding([{ project: B1.project, path: B1.path, durationMs: 600_000 }]);
      release = () => slot?.release();
    });
    release();
    const holder = `which the working tree's run of ${B1.path} holds (running for `;
    expect(out).toContain(`${WAITING(at)}, ${holder}`);
    expect(out).toMatch(/holds \(running for \d+ s, about (9|10) min( \d+ s)? left\)/);
    expect(out).toContain(
      `Still to run, at ${at}: 1 test file, time unknown: waiting for the browser group's slot, ${holder}`,
    );
    expect(out).toMatch(/left\); it can start after that run ends/);
  });

  it("gives no time left when the holder's file has no stored duration", async () => {
    let release = () => {};
    const { out } = await narrowed((f) => {
      const owner = { pid: process.pid, worktreeId: worktreeIdFor(f.root as AbsolutePath) };
      const slot = acquireSlowSlot({ dir: slotDir(f), owner, group: "browser" });
      slot?.holding([{ project: B1.project, path: B1.path, durationMs: null }]);
      release = () => slot?.release();
    });
    release();
    expect(out).toMatch(/holds \(running for \d+ s\); it can start after that run ends/);
    expect(out).not.toContain(" left)");
  });

  it.each([
    ["no recorded files (an older release's holder)", false],
    ["a holder whose process is gone", true],
  ])("reads as before for %s", async (_, dead) => {
    let close = () => {};
    const { out, at } = await narrowed((f) => {
      const pid = dead ? deadPid() : process.pid;
      const worktreeId = worktreeIdFor(f.root as AbsolutePath) as WorktreeId;
      const slot = acquireSlowSlot({
        dir: slotDir(f),
        owner: { pid, worktreeId },
        group: "browser",
      });
      // An older release records no files; a dead holder's files are recorded.
      if (dead) slot?.holding([{ project: B1.project, path: B1.path, durationMs: 600_000 }]);
      close = () => slot?.release();
    });
    close();
    expect(out).toContain(`${WAITING(at)}, `);
    expect(out).not.toMatch(/holds|held by/);
    expect(out).toContain(
      `Still to run, at ${at}: 1 test file, time unknown: waiting for capacity (the browser group's slot)`,
    );
  });
});

/** The pid of a process that has exited. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"]);
  return Number(child.stdout.toString());
}
