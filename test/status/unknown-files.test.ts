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
    text: () => formatStatus(status(), NOW),
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

    expect(status.available && status.unknownTestFiles?.files).toEqual([
      { testFile: ref("test/a.test.ts"), ran: false, reason: null, samples: [] },
    ]);
    expect(w.text()).toContain("  test/a.test.ts: no result: no reason was kept\n");
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
