import { describe, expect, it } from "vitest";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import {
  type CheckKey,
  type PendingPhase,
  type RevisionNumber,
  refinedMetaKey,
  type StatusSnapshot,
  type Store,
  type TestFileRef,
} from "../../src/core/types/index.js";
import { appendRevisions, fakeRepo, seedStore, state } from "./helpers.js";

/*
 * Row 011-58 (gh-61; 011 C6 and C15): plain status names the running and
 * queued test files with their projects, `--json` lists them beside the
 * counts it keeps, and a cut list states how many files it leaves out.
 */

const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);

const ref = (project: string, path: string): TestFileRef => ({ project, path: path as never });

/** A live worktree at revision 2, its runner part done. */
function worktree() {
  const repo = fakeRepo();
  const store = seedStore(repo);
  store.worktrees.upsert({
    id: repo.mainId,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: {
      socketPath: "/tmp/squeal-phase-files.sock",
      startedAt: NOW - 60_000,
      heartbeatAt: NOW - 1_000,
      heartbeatIntervalMs: 5_000,
      squealVersion: "0.0.0-test",
    },
  });
  appendRevisions(store, repo.mainId, 2, { head: null, dirty: false });
  store.meta.set(refinedMetaKey(repo.mainId), "2");
  return { repo, store, id: repo.mainId };
}

/** `files` keyed in `phase` (`null`: current), each with one test check in it. */
function seed(store: Store, id: string, phase: PendingPhase | null, files: readonly TestFileRef[]) {
  store.testFileKeys.upsertMany(
    files.map((testFile) => ({
      worktreeId: id,
      testFile,
      key: `k-${testFile.project}-${testFile.path}` as CheckKey,
      revision: 2,
      pending: phase,
    })),
  );
  store.knownStates.upsertMany(
    files.map((f) =>
      state(
        id,
        { kind: "test", project: f.project, testPath: f.path, fullName: "holds" },
        phase === null
          ? { observedAt: 2 }
          : { validity: "pending", pendingPhase: phase, observedAt: 1 },
      ),
    ),
  );
}

function snapshotOf(root: string): StatusSnapshot {
  const status = readStatus(root, { now: () => NOW });
  if (!status.available) throw new Error(status.message);
  return status;
}

function linesOf(s: StatusSnapshot): string[] {
  return formatStatus(s, NOW, "squeal").split("\n");
}

const numbered = (project: string, n: number, dir = "src") =>
  Array.from({ length: n }, (_, i) =>
    ref(project, `${dir}/f${String(i + 1).padStart(3, "0")}.test.ts`),
  );

describe("status names the running and queued test files (011-58, gh-61)", () => {
  it("names every running file and each queued one with its project, beside the counts", () => {
    const { repo, store, id } = worktree();
    const running = [
      ref("cezar", "packages/cezar/src/core/harness-parity.test.ts"),
      ref("cezar", "packages/cezar/src/a.test.ts"),
      ref("web", "web/b.test.ts"),
      ref("web", "web/c.test.ts"),
      ref("web", "web/d.test.ts"),
    ];
    seed(store, id, "running", running);
    seed(store, id, "queued", [ref("web", "web/q.test.ts"), ref("cezar", "packages/q.test.ts")]);
    seed(store, id, null, [ref("web", "web/done.test.ts")]);

    const s = snapshotOf(repo.main);
    const lines = linesOf(s);

    expect(s.testFilesByPhase).toEqual({ running: 5, queued: 2 });
    expect(lines).toContain(
      "Running: 5 test files: cezar: packages/cezar/src/a.test.ts, cezar: packages/cezar/src/core/harness-parity.test.ts, web: web/b.test.ts, web: web/c.test.ts, web: web/d.test.ts",
    );
    expect(lines).toContain("Queued: 2 test files: cezar: packages/q.test.ts, web: web/q.test.ts");
    // The vision's four lines lead (011 C6); the lists follow them, before `Outstanding:`.
    const at = lines.findIndex((l) => l.startsWith("Full-suite checkpoint:"));
    expect(at).toBe(3);
    expect(lines[at + 1]).toMatch(/^Running: /);
    expect(lines[at + 2]).toMatch(/^Queued: /);
    expect(lines[at + 3]).toBe("Outstanding:");
    expect(s.pendingTestFiles).toEqual({
      running: {
        files: [running[1], running[0], running[2], running[3], running[4]],
        omitted: 0,
      },
      queued: {
        files: [ref("cezar", "packages/q.test.ts"), ref("web", "web/q.test.ts")],
        omitted: 0,
      },
    });
  });

  it("a cut list states how many files it leaves out, in the text and in --json", () => {
    const { repo, store, id } = worktree();
    seed(store, id, "running", numbered("", 12, "run"));
    seed(store, id, "queued", numbered("", 130, "wait"));

    const s = snapshotOf(repo.main);
    const lines = linesOf(s);

    const shown = (dir: string, n: number) =>
      Array.from({ length: n }, (_, i) => `${dir}/f${String(i + 1).padStart(3, "0")}.test.ts`).join(
        ", ",
      );
    expect(lines).toContain(`Running: 12 test files: ${shown("run", 10)} and 2 more`);
    expect(lines).toContain(`Queued: 130 test files: ${shown("wait", 5)} and 125 more`);
    expect(s.testFilesByPhase).toEqual({ running: 12, queued: 130 });
    expect(s.pendingTestFiles?.running).toEqual({ files: numbered("", 12, "run"), omitted: 0 });
    expect(s.pendingTestFiles?.queued.files).toEqual(numbered("", 100, "wait"));
    expect(s.pendingTestFiles?.queued.omitted).toBe(30);
  });

  it("a file an open run holds is running, though a re-key queued it, as the count says (C15)", () => {
    const { repo, store, id } = worktree();
    const held = ref("", "src/held.test.ts");
    seed(store, id, "queued", [held, ref("", "src/other.test.ts")]);
    store.runs.start({
      id: "run-held",
      worktreeId: id,
      revision: 1 as RevisionNumber,
      testFiles: [held],
      checkpointId: null,
      logDir: "/tmp/run-held",
      startedAt: NOW - 10_000,
    });

    const s = snapshotOf(repo.main);

    expect(s.testFilesByPhase).toEqual({ running: 1, queued: 1 });
    expect(s.pendingTestFiles?.running).toEqual({ files: [held], omitted: 0 });
    expect(linesOf(s)).toContain("Running: 1 test file: src/held.test.ts");
    expect(linesOf(s)).toContain("Queued: 1 test file: src/other.test.ts");
  });

  it("nothing running or queued: no line, and both lists empty", () => {
    const { repo, store, id } = worktree();
    seed(store, id, null, [ref("", "src/done.test.ts")]);

    const s = snapshotOf(repo.main);

    expect(linesOf(s).filter((l) => /^(Running|Queued): /.test(l))).toEqual([]);
    expect(s.pendingTestFiles).toEqual({
      running: { files: [], omitted: 0 },
      queued: { files: [], omitted: 0 },
    });
  });
});
