import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recordUnknownFiles } from "../../src/core/scheduler/unknown-files.js";
import { SUMMARY_MAX_CHARS } from "../../src/core/state/index.js";
import {
  formatStatus,
  formatWhy,
  readStatus,
  readWhy,
  UNKNOWN_FILES_LISTED,
} from "../../src/core/status/index.js";
import type { CheckKey, PendingPhase, RevisionNumber } from "../../src/core/types/index.js";
import { withoutTouched } from "../../src/runners/vitest/moved.js";
import { appendRevisions, check, fakeRepo, seedStore, state } from "./helpers.js";

/*
 * Task 001-403: status names each test file without a result at its key and
 * none on the way, with why: "ran, nothing recorded" when its run completed
 * and stored nothing, else "no result", and the sample paths kept.
 */

const NOW = Date.UTC(2026, 9, 15, 12, 0);
const ref = (path: string) => ({ project: "", path: path as never });

function seeded() {
  const repo = fakeRepo();
  const store = seedStore(repo);
  const id = repo.mainId;
  store.worktrees.upsert({
    id,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  appendRevisions(store, id, 3, { head: null, dirty: false });
  const row = (path: string, key: string | null, pending: PendingPhase | null = null) =>
    store.testFileKeys.upsertMany([
      { worktreeId: id, testFile: ref(path), key: key as CheckKey | null, revision: 3, pending },
    ]);
  const marked = (path: string, key: string, ran: boolean, samples: string[] = []) =>
    store.transaction(() =>
      recordUnknownFiles(
        store,
        id,
        [
          {
            testFile: ref(path),
            key: key as CheckKey,
            reason: ran ? "3 runs in a row read paths no earlier run had read" : "run crashed",
            ran,
            samples: samples as never,
            revision: 3 as RevisionNumber,
            at: NOW,
          },
        ],
        () => true,
      ),
    );
  const status = () => readStatus(repo.main, { now: () => NOW });
  return {
    root: repo.main,
    store,
    id,
    row,
    marked,
    status,
    text: () => formatStatus(status(), NOW, "squeal", { full: true }),
  };
}

describe("status: test files without a result, named (001-403)", () => {
  it("names a file that ran and stored nothing, one with an unknown check's reason, and none current or pending", () => {
    const w = seeded();
    w.row("test/new-path.test.ts", "k1");
    w.marked("test/new-path.test.ts", "k1", true, ["runs/a", "runs/b"]);
    w.row("test/slow.test.ts", "k2");
    w.store.knownStates.upsertMany([
      state(w.id, check("test/slow.test.ts", "waits"), {
        outcome: "unknown",
        validity: "unknown",
        summary: "timed out after 600 s",
      }),
    ]);
    w.row("test/ok.test.ts", "k3");
    w.store.knownStates.upsertMany([state(w.id, check("test/ok.test.ts", "works"))]);
    w.row("test/queued.test.ts", "k4", "queued");

    const status = w.status();

    expect(status.available && status.unknownTestFiles).toEqual({
      total: 2,
      files: [
        {
          testFile: ref("test/new-path.test.ts"),
          ran: true,
          reason: "3 runs in a row read paths no earlier run had read",
          samples: ["runs/a", "runs/b"],
        },
        {
          testFile: ref("test/slow.test.ts"),
          ran: false,
          reason: "timed out after 600 s",
          samples: [],
        },
      ],
    });
    expect(w.text()).toContain(
      [
        "Test files without a result: 2 (nothing current at their inputs, none queued)",
        "  test/new-path.test.ts: ran, nothing recorded: 3 runs in a row read paths no earlier run had read (paths: runs/a, runs/b)",
        "  test/slow.test.ts: no result: timed out after 600 s",
      ].join("\n"),
    );
  });

  it("ignores a reason kept for a key the file has moved from", () => {
    const w = seeded();
    w.row("test/a.test.ts", "k-new");
    w.marked("test/a.test.ts", "k-old", false);

    const status = w.status();

    // Task 011-12 (issue 24): the store still says why, the key never had a result.
    expect(status.available && status.unknownTestFiles?.files).toEqual([
      {
        testFile: ref("test/a.test.ts"),
        ran: false,
        reason: "never run at this key, and nothing queued it",
        samples: [],
        cause: "never-run",
      },
    ]);
    expect(w.text()).toContain(
      "  test/a.test.ts: no result: never run at this key, and nothing queued it\n",
    );
  });

  it(`lists the first ${UNKNOWN_FILES_LISTED} and counts the rest`, () => {
    const w = seeded();
    for (let i = 0; i < UNKNOWN_FILES_LISTED + 3; i++) w.row(`test/f${100 + i}.test.ts`, null);

    const status = w.status();

    expect(status.available && status.unknownTestFiles?.files).toHaveLength(UNKNOWN_FILES_LISTED);
    expect(w.text()).toContain("  and 3 more test files\n");
  });

  it("cuts a long reason as a delivery does; --json and why keep every path (task 011-02)", () => {
    const w = seeded();
    const paths = Array.from({ length: 600 }, (_, i) => `dist/agent-config/module-${i}.d.ts`);
    const file = ref("test/touched.test.ts");
    const report = {
      end: "completed",
      durationMs: 1,
      completedFiles: [file],
      results: [],
      fileErrors: [],
      failure: null,
    } as const;
    const reason = `vitest: ${withoutTouched(report, [file], paths).failure}`;
    w.row("test/touched.test.ts", "k1");
    w.store.knownStates.upsertMany([
      state(w.id, check("test/touched.test.ts", "works"), {
        outcome: "unknown",
        validity: "unknown",
        summary: reason,
      }),
    ]);

    const status = w.status();
    const line = w
      .text()
      .split("\n")
      .find((l) => l.startsWith("  test/touched.test.ts: "));

    expect(status.available && status.unknownTestFiles?.files[0]?.reason).toBe(reason);
    expect(line).toBe(
      `  test/touched.test.ts: no result: ${reason.slice(0, SUMMARY_MAX_CHARS - 3)}...`,
    );
    expect(line).toContain("since 600 files were written during this run");
    const why = formatWhy(readWhy(w.root, "test/touched.test.ts > works"));
    expect(why).toContain(`every path: ${paths.join(", ")}`);
  });

  it("says nothing when every file has a result", () => {
    const w = seeded();
    w.row("test/ok.test.ts", "k3");
    w.store.knownStates.upsertMany([state(w.id, check("test/ok.test.ts", "works"))]);

    expect(w.status()).not.toHaveProperty("unknownTestFiles");
    expect(w.text()).not.toContain("without a result");
  });
});

describe("status: why a file without a result has none, from what the store keeps (011-12, issue 24)", () => {
  it("names an unkeyed file, a failed setup, another worktree's run and a key never run; 'no reason was kept' only when true", () => {
    const w = seeded();
    w.row("test/unkeyed.test.ts", null);
    w.store.knownStates.upsertMany([
      state(w.id, { kind: "setup", project: "web", testPath: "vitest.setup.ts" } as never, {
        outcome: "fail",
      }),
    ]);
    w.store.testFileKeys.upsertMany([
      {
        worktreeId: w.id,
        testFile: { project: "web", path: "test/setup.test.ts" as never },
        key: "k-s" as CheckKey,
        revision: 3,
        pending: null,
      },
    ]);
    w.row("test/claimed.test.ts", "k-c");
    const other = { id: "other-wt", root: "/repo/other" };
    w.store.worktrees.upsert({
      id: other.id,
      root: other.root,
      commonDir: "/repo/.git",
      isMain: false,
      registeredAt: 2,
      daemon: {
        socketPath: "/run/other.sock",
        startedAt: NOW - 10_000,
        heartbeatAt: NOW - 1_000,
        heartbeatIntervalMs: 5_000,
        squealVersion: "0.0.0",
      },
    });
    w.store.testFileKeys.upsertMany([
      {
        worktreeId: other.id,
        testFile: ref("test/claimed.test.ts"),
        key: "k-c" as CheckKey,
        revision: 1,
        pending: "running",
      },
    ]);
    w.row("test/never.test.ts", "k-n");
    w.row("test/kept-none.test.ts", "k-k");
    w.store.knownStates.upsertMany([
      state(w.id, check("test/kept-none.test.ts", "x"), {
        outcome: "unknown",
        validity: "unknown",
      }),
    ]);

    const status = w.status();
    const files = (status.available && status.unknownTestFiles?.files) || [];
    const reasons = Object.fromEntries(files.map((f) => [f.testFile.path, f.reason]));

    expect(reasons).toEqual({
      "test/unkeyed.test.ts":
        "no key: its project's environment or closure is not known (a runner call failed), or a closure path is untracked",
      "test/setup.test.ts": "its project's global setup failed",
      "test/claimed.test.ts": "/repo/other's daemon is running its key",
      "test/never.test.ts": "never run at this key, and nothing queued it",
      "test/kept-none.test.ts": null,
    });
    expect(w.text()).toContain("  test/kept-none.test.ts: no result: no reason was kept\n");
  });

  it("says a lookup-only baseline queued nothing, for a many-file worktree, and keeps a recorded reason", () => {
    const w = seeded();
    writeFileSync(
      join(w.root, "squeal.config.json"),
      JSON.stringify({ baseline: { onStart: "lookup-only" } }),
    );
    for (let i = 0; i < 410; i++) w.row(`test/f${1000 + i}.test.ts`, `k${i}`);
    w.marked("test/f1000.test.ts", "k0", false);

    const status = w.status();
    const text = w.text();

    expect(status.available && status.unknownTestFiles?.total).toBe(410);
    expect(text).toContain("  test/f1000.test.ts: no result: run crashed\n");
    expect(text).toContain(
      "  test/f1001.test.ts: no result: never run at this key: the baseline is lookup-only, so nothing queued it\n",
    );
    expect(text).not.toContain("no reason was kept");
  });
});
