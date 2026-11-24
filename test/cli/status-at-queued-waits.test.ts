import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import { publishGroupActivity } from "../../src/core/slow/state.js";
import type { AbsolutePath, EpochMs } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { SlowTierActivity } from "../../src/core/types/status.js";
import { type Fixture, fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { run, standIn, standInTree, testOf, withStore } from "./status-at-kit.js";

/** Review 0.1.621 B1: what the daemon does after the call's first read, before its wait read. */
const between = vi.hoisted(() => ({ act: null as (() => void) | null }));
vi.mock("../../src/cli/status-at-estimate-named.js", async (original) => {
  const named = await original<typeof import("../../src/cli/status-at-estimate-named.js")>();
  return {
    ...named,
    readMainStore: ((...args: Parameters<typeof named.readMainStore>) => {
      const act = between.act;
      between.act = null;
      act?.();
      return named.readMainStore(...args);
    }) as typeof named.readMainStore,
  };
});
afterEach(() => {
  between.act = null;
});

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

/** Marks `files` `pending` (queued by default) in the daemon of `tree`, at the stand-in's keys. */
function queued(
  f: Fixture,
  tree: string,
  files: readonly TestFileRef[],
  pending: "queued" | "running" = "queued",
  prefix = "commit",
) {
  withStore(f, (store) =>
    store.testFileKeys.upsertMany(
      files.map((testFile) => ({
        worktreeId: worktreeIdFor(tree as AbsolutePath),
        testFile,
        key: `${prefix}-${testFile.path}`,
        revision: 2,
        pending,
      })),
    ),
  );
}

/** Row 023-84: what the commit daemon records beside its lane's activity. */
interface Recorded {
  /** `B1`'s key row: `running` when the run is at its current key. */
  readonly pending?: "queued" | "running";
  /** The files of a run the store holds open, started at `since`. */
  readonly open?: { readonly files: readonly TestFileRef[]; readonly since: number };
  /** The run started at key `old-…` (row `running`); an edit then moved the key (row `queued`). */
  readonly rekeyed?: true;
  /** Review 0.1.621 B1: after the call's first read, the daemon starts `B1` at its current key. */
  readonly startsLater?: true;
}

/** A narrowed `--run` on `B1` whose commit daemon's browser lane published `activity`. */
async function narrowed(activity: SlowTierActivity | null, recorded: Recorded = {}) {
  const { f, a } = two();
  const tree = standInTree(f);
  // The stand-in's tree is an empty folder: its policy is the commit's, with the browser group.
  writeFileSync(join(tree, "squeal.config.json"), `${JSON.stringify(CONFIG)}\n`);
  const daemons = standIn(tree, () => undefined, {
    select: (ask) => (ask.named.length === 0 ? ALL : ALL.filter((r) => ask.named.includes(r.path))),
    rows: (at, files) => {
      if (recorded.rekeyed === true) queued(f, at, files, "running", "old");
      else queued(f, at, files, recorded.pending);
      const id = worktreeIdFor(at as AbsolutePath);
      if (recorded.startsLater === true) between.act = () => queued(f, at, [B1], "running");
      withStore(f, (store) => {
        publishGroupActivity(store, id, "browser", activity);
        const open = recorded.open;
        if (open === undefined) return;
        store.runs.start({
          id: `run-${open.since}`,
          worktreeId: id,
          revision: 1 as never,
          testFiles: open.files,
          checkpointId: null,
          logDir: "/tmp/023-84" as AbsolutePath,
          startedAt: open.since as EpochMs,
        });
      });
      if (recorded.rekeyed === true) queued(f, at, files);
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
    // Review 0.1.611 S1: the lane publishes what it waits for, not who holds it.
    const slot = "the browser group's slot";
    expect(out).toContain(`${B1.path}: 1 of 1 queued at ${at}, waiting for ${slot}, `);
    expect(out).not.toMatch(/held by|holds/);
    expect(out).not.toContain(`still running at ${at}`);
    expect(out).toContain(
      `Still to run, at ${at}: 1 test file, time unknown: waiting for capacity (${slot})`,
    );
    expect(out).toContain(`0 running and 1 queued at ${at} (its worktree)`);
  });

  it("names a pool wait without claiming who holds the pool", async () => {
    const { out, at } = await narrowed({ kind: "waiting", for: "pool" });
    const pool = "capacity from the shared worker pool";
    expect(out).toContain(`${B1.path}: 1 of 1 queued at ${at}, waiting for ${pool}, `);
    expect(out).toContain(`Still to run, at ${at}: 1 test file, time unknown: waiting for ${pool}`);
    expect(out).not.toMatch(/held by|holds/);
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

/*
 * Row 023-84 (dogfood round 11, AA4): s1b-03 read "waiting for the browser
 * group's run of packages/web/e2e/thread-scroll.e2e.ts to end" while that
 * run of the same file had started at a key the file no longer had. The
 * call now says that run's result will not count.
 */
describe("a named file behind its own side's run at an older key (row 023-84, AA4)", SLOW, () => {
  /** The commit daemon's lane runs `B1` since 40 s, with a stored duration of 97 s. */
  const since = () => Date.now() - 40_000;
  const running = (at: number): SlowTierActivity => ({
    kind: "running",
    path: B1.path,
    since: at,
    lastDurationMs: 97_000,
  });

  it("says the run started before the file's inputs changed and its result will not count", async () => {
    const at = since();
    const { out, at: c } = await narrowed(running(at), { open: { files: [B1], since: at } });
    expect(out).toMatch(
      new RegExp(
        `${B1.path}: 1 of 1 queued at ${c}, waiting for the commit worktree's run of ${B1.path} to end: that run started before its inputs changed \\(running for 4\\d s, about 5\\d s left\\), so its result will not count, and the file runs again after it`,
      ),
    );
    expect(out).toContain(
      `Still to run, at ${c}: 1 test file, time unknown: not started, waiting for the commit worktree's run of ${B1.path} to end: that run started`,
    );
    expect(out).not.toContain(`waiting for the browser group's run of ${B1.path} to end`);
  });

  it("gives no time left without a stored duration", async () => {
    const at = since();
    const activity = { ...running(at), lastDurationMs: null };
    const { out } = await narrowed(activity, { open: { files: [B1], since: at } });
    expect(out).toMatch(
      /that run started before its inputs changed \(running for 4\d s\), so its result/,
    );
  });

  it("reads as before when the store holds no open run of the file", async () => {
    // The lane's activity alone is no record of a run: it can be old news.
    const { out, at: c } = await narrowed(running(since()));
    expect(out).toContain(
      `${B1.path}: 1 of 1 queued at ${c}, waiting for the browser group's run of ${B1.path} to end`,
    );
    expect(out).not.toContain("will not count");
  });

  it("reads a run of another file as before", async () => {
    const at = since();
    const activity = { ...running(at), path: B2.path };
    const { out, at: c } = await narrowed(activity, { open: { files: [B2], since: at } });
    expect(out).toContain(
      `${B1.path}: 1 of 1 queued at ${c}, waiting for the browser group's run of ${B2.path} to end`,
    );
    expect(out).not.toContain("will not count");
  });

  it("reads a run at the file's current key as running, as before", async () => {
    const at = since();
    const { out, at: c } = await narrowed(running(at), {
      pending: "running",
      open: { files: [B1], since: at },
    });
    expect(out).not.toContain("will not count");
    expect(out).not.toContain(`${B1.path}: 1 of 1 queued at ${c}`);
  });

  it("says so for a run at K whose file's key moved to K' during the run", async () => {
    const at = since();
    const { out, at: c } = await narrowed(running(at), {
      rekeyed: true,
      open: { files: [B1], since: at },
    });
    expect(out).toContain(
      `${B1.path}: 1 of 1 queued at ${c}, waiting for the commit worktree's run of ${B1.path} to end: that run started before its inputs changed`,
    );
  });

  // Review 0.1.621 B1: the call's queued list is an earlier read than its wait's.
  it("never calls a run stale that started at the current key after the call's first read", async () => {
    const at = since();
    const { out } = await narrowed(running(at), {
      startsLater: true,
      open: { files: [B1], since: at },
    });
    expect(between.act).toBeNull();
    expect(out).not.toContain("will not count");
    expect(out).not.toContain("started before its inputs changed");
  });
});
