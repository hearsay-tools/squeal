import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CandidateBatch } from "../../src/core/types/index.js";
import { type ChangeFeed, createChangeFeed } from "../../src/core/watcher/change-feed.js";
import { createWatcherBackend } from "../../src/core/watcher/index.js";
import { BatchLog, delay, git, makeRepo, PausableBackend, waitFor } from "./helpers.js";

function write(root: string, path: string, content = "x\n"): void {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), content);
}

describe("ChangeFeed", () => {
  let root: string;
  let cleanup: () => void;
  let log: BatchLog;
  let errors: Error[];
  let dropped: string[];
  let backend: PausableBackend;
  let feed: ChangeFeed | null;
  let tracked: string[];
  let onBatch: (batch: CandidateBatch) => void;

  const startFeed = async (options: { reconcileIntervalMs?: number; extra?: string[] } = {}) => {
    feed = createChangeFeed({
      root,
      backend,
      onBatch: (batch) => onBatch(batch),
      onError: (error) => errors.push(error),
      onDropped: (reason) => dropped.push(reason),
      trackedPaths: () => tracked,
      extraFiles: options.extra ?? [],
      timings: { reconcileIntervalMs: options.reconcileIntervalMs ?? 60_000 },
    });
    await feed.start();
  };
  const watchBatchWith = (path: string) =>
    log.batches.some((b) => b.trigger === "watch" && b.paths.some((p) => p.path === path));

  beforeEach(() => {
    ({ root, cleanup } = makeRepo());
    log = new BatchLog();
    onBatch = log.push;
    errors = [];
    dropped = [];
    backend = new PausableBackend(createWatcherBackend("linux"));
    feed = null;
    tracked = ["README.md", "src/a.ts", "src/lib/b.ts"];
  });
  afterEach(async () => {
    await feed?.close();
    cleanup();
    expect(errors).toEqual([]);
  });

  it("emits a start reconciliation from git status and the tracked paths", async () => {
    write(root, "src/a.ts", "dirty\n");
    write(root, "src/new.ts");
    write(root, "src/debug.log");
    rmSync(join(root, "README.md"));
    await startFeed();
    expect(log.batches[0]?.trigger).toBe("interval");
    const paths = log.batches[0]?.paths ?? [];
    expect(paths.map((p) => p.path)).toEqual([
      "README.md",
      "src/a.ts",
      "src/lib/b.ts",
      "src/new.ts",
    ]);
    const a = statSync(join(root, "src/a.ts"));
    expect(paths.find((p) => p.path === "src/a.ts")?.stat).toEqual({
      mtimeMs: a.mtimeMs,
      ctimeMs: a.ctimeMs,
      size: a.size,
      inode: a.ino,
    });
    expect(paths.find((p) => p.path === "README.md")?.stat).toBeNull();
  });

  it("reports a write after an atomic save", async () => {
    await startFeed();
    write(root, "src/a.ts.tmp", "saved\n");
    renameSync(join(root, "src/a.ts.tmp"), join(root, "src/a.ts"));
    await waitFor(() => watchBatchWith("src/a.ts"));
    await delay(150);
    log.batches.length = 0;
    write(root, "src/a.ts", "written after the save\n");
    await waitFor(() => watchBatchWith("src/a.ts"));
    expect(log.find("src/a.ts")?.candidate.stat?.size).toBe("written after the save\n".length);
    expect(log.has("src/a.ts.tmp")).toBe(false);
  });

  it("reports files written inside a renamed directory, and the old paths as gone", async () => {
    await startFeed();
    renameSync(join(root, "src/lib"), join(root, "src/moved"));
    await waitFor(() => watchBatchWith("src/moved/b.ts") && watchBatchWith("src/lib/b.ts"));
    expect(log.find("src/lib/b.ts")?.candidate.stat).toBeNull();
    await delay(150);
    log.batches.length = 0;
    write(root, "src/moved/b.ts", "edited\n");
    write(root, "src/moved/new.ts", "new\n");
    await waitFor(() => watchBatchWith("src/moved/b.ts") && watchBatchWith("src/moved/new.ts"));
  });

  it("ends a rename storm with the candidate set matching the disk", async () => {
    const count = 200;
    const name = (i: number, suffix: string) => `src/storm/f${i}${suffix}.ts`;
    for (let i = 0; i < count; i++) write(root, name(i, ""), `file ${i}\n`);
    const onDisk = () =>
      git(root, "ls-files", "--cached", "--others", "--exclude-standard", "--deduplicate")
        .split("\n")
        .filter((p) => p !== "" && existsSync(join(root, p)))
        .sort();
    // What a consumer of the batches knows: the latest stat per path. The
    // stat cache it stands for is also what the feed reads as tracked paths.
    const known = new Map<string, boolean>(onDisk().map((p) => [p, true]));
    const present = () => [...known].filter(([, exists]) => exists).map(([p]) => p);
    tracked = present();
    onBatch = (batch) => {
      for (const p of batch.paths) known.set(p.path, p.stat !== null);
      tracked = present();
      log.push(batch);
    };
    const expectReportedToMatchDisk = async () => {
      const disk = onDisk();
      const reported = () => present().sort();
      await waitFor(() => reported().join("\n") === disk.join("\n"), 10_000).catch(() => {});
      expect(reported()).toEqual(disk);
    };
    await startFeed();

    const move = (from: string, to: string) => renameSync(join(root, from), join(root, to));
    for (let round = 0; round < 5; round++) {
      for (let i = 0; i < count; i++) move(name(i, ""), name(i, ".swap"));
      for (let i = 0; i < count; i++) move(name(i, ".swap"), name(i, ""));
    }
    for (let i = 0; i < count; i += 2) move(name(i, ""), name(i, ".final"));
    // Checked before the directory rename, which reports every path under the old directory as gone.
    await expectReportedToMatchDisk();
    expect(onDisk().filter((p) => p.endsWith(".final.ts"))).toHaveLength(count / 2);

    move("src/storm", "src/stormed");
    await expectReportedToMatchDisk();
    expect(onDisk().filter((p) => p.startsWith("src/stormed/"))).toHaveLength(count);
    expect(log.batches.slice(1).filter((b) => b.trigger !== "watch")).toEqual([]);
  });

  it("produces no candidates from inside a nested worktree once its .git entry exists", async () => {
    const wt = join(root, "wt");
    // A branch without .gitignore, so only the .git entry can trigger the rebuild.
    git(root, "switch", "-q", "-c", "side");
    git(root, "rm", "-q", ".gitignore");
    git(root, "commit", "-q", "-m", "side without .gitignore");
    git(root, "switch", "-q", "main");
    const fromInsideAfterGit: string[] = [];
    // A batch delivered while wt/.git exists must not carry paths from inside wt.
    onBatch = (batch) => {
      if (existsSync(join(wt, ".git"))) {
        fromInsideAfterGit.push(
          ...batch.paths.map((p) => p.path).filter((p) => p.startsWith("wt/")),
        );
      }
      log.push(batch);
    };
    await startFeed();
    git(root, "worktree", "add", "-q", "--detach", "wt", "side");
    await waitFor(() => feed?.spec?.excluded.includes(wt) === true);
    write(root, "wt/src/a.ts", "edited in the nested worktree\n");
    write(root, "wt/src/extra.ts");
    write(root, "src/a.ts", "edited in the outer worktree\n");
    await waitFor(() => watchBatchWith("src/a.ts"));
    await delay(300);
    // A tracked path inside the nested worktree, or its root, is dropped by reconciliation too.
    tracked.push("wt/src/a.ts", "wt");
    await feed?.reconcile("interval");
    expect(log.batches.at(-1)?.trigger).toBe("interval");
    expect(fromInsideAfterGit).toEqual([]);
    expect(log.has("wt/src/extra.ts")).toBe(false);
    expect(log.paths().filter((p) => p.startsWith("wt/src/a.ts") || p === "wt")).toEqual([]);
  });

  // That a touch creates no revision is tested in test/revision/reconcile.test.ts.
  it("emits a candidate for a touch", async () => {
    await startFeed();
    const later = new Date(Date.now() + 5_000);
    utimesSync(join(root, "src/a.ts"), later, later);
    await waitFor(() => watchBatchWith("src/a.ts"));
    // Node 22 reports mtimeMs with sub-millisecond float error (CI saw x.999), so compare within 1 ms.
    expect(log.find("src/a.ts")?.candidate.stat?.mtimeMs).toBeCloseTo(later.getTime(), 0);
  });

  it("catches an edit made while the backend is paused in the interval reconciliation", async () => {
    tracked.push("out/gen.js");
    await startFeed({ reconcileIntervalMs: 400, extra: ["out/gen.js"] });
    backend.paused = true;
    write(root, "src/a.ts", "edited while paused\n");
    write(root, "out/gen.js", "regenerated while paused\n");
    write(root, "src/new.ts", "created while paused\n");
    await delay(200);
    expect(log.batches.filter((b) => b.trigger === "watch")).toEqual([]);
    // The first batch is the start reconciliation, also `interval` (review wave 10d, S1).
    const later = () => log.batches.slice(1).find((b) => b.trigger === "interval");
    await waitFor(() => later() !== undefined);
    const batch = later();
    const stat = (path: string) => batch?.paths.find((p) => p.path === path)?.stat;
    expect(stat("src/a.ts")?.size).toBe("edited while paused\n".length);
    expect(stat("out/gen.js")?.size).toBe("regenerated while paused\n".length);
    expect(stat("src/new.ts")?.size).toBe("created while paused\n".length);
  });

  it("runs a full reconciliation after a dropped-events signal", async () => {
    await startFeed();
    backend.paused = true;
    write(root, "src/lib/b.ts", "edited while paused\n");
    await delay(150);
    backend.signalDropped("test: events were dropped");
    await waitFor(() => log.batches.some((b) => b.trigger === "dropped-events"));
    expect(dropped).toEqual(["test: events were dropped"]);
    const batch = log.batches.find((b) => b.trigger === "dropped-events");
    expect(batch?.paths.find((p) => p.path === "src/lib/b.ts")?.stat?.size).toBe(
      "edited while paused\n".length,
    );
  });

  it("never reports gitignored paths", async () => {
    write(root, "out/before.js");
    write(root, "src/before.log");
    await startFeed();
    write(root, "out/x.js");
    write(root, "node_modules/pkg/index.js");
    write(root, "src/debug.log");
    write(root, "build/deep/b.js");
    appendFileSync(join(root, ".gitignore"), "gen/\n");
    await waitFor(() => watchBatchWith(".gitignore"));
    write(root, "gen/x.ts");
    write(root, "src/control.ts");
    await waitFor(() => watchBatchWith("src/control.ts"));
    await feed?.reconcile("interval");
    expect(log.has("src/control.ts")).toBe(true);
    const check = spawnSync("git", ["check-ignore", "--stdin"], {
      cwd: root,
      input: log.paths().join("\n"),
      encoding: "utf8",
    });
    // Exit 1: none of the reported paths is ignored.
    expect({ status: check.status, ignored: check.stdout }).toEqual({ status: 1, ignored: "" });
  });

  it("rebuilds the watch spec when a .gitignore changes", async () => {
    write(root, "tmp/a.txt");
    await startFeed();
    expect(feed?.spec?.excluded).not.toContain(join(root, "tmp"));
    appendFileSync(join(root, ".gitignore"), "tmp/\n");
    await waitFor(() => feed?.spec?.excluded.includes(join(root, "tmp")) === true);
  });
});
