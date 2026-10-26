import { describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import {
  type EndedNamed,
  type EndedWait,
  namedLine,
  waitLine,
} from "../../src/cli/status-wait-lines.js";
import { readVerdict } from "../../src/cli/verdict.js";
import {
  createDelivery,
  formatRegistration,
  readLiveHeader,
} from "../../src/core/delivery/index.js";
import { readHeader } from "../../src/core/state/index.js";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import {
  type CheckId,
  type CheckKey,
  type Consumer,
  type DaemonRecord,
  type PendingPhase,
  refinedMetaKey,
  type StatusSnapshot,
  type Store,
  type Validity,
} from "../../src/core/types/index.js";
import { knownFailuresLine, statusText } from "../../src/harness/shared/text.js";
import { fixedStatus } from "../delivery/fakes.js";
import { appendRevisions, check, type FakeRepo, fakeRepo, seedStore, state } from "./helpers.js";

/*
 * Row 011-26, spec 011 C6 as amended 2026-10-20 (gh-45; `tasks/011-24/design.md`
 * section 2): every `Known failures:` line, status's, the registration
 * header's, Stop's and both waits' verdict lines, says after a semicolon what
 * is not current, in test files and tests, and `status --json` counts the
 * test files by class (`testFileCounts`) and the pending ones by phase
 * (`testFilesByPhase`), each file classed as a named wait classes it.
 */

const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
const HEAD = 26;
const ZERO =
  "Known failures: 0; not current: 8 of 10 test files (2 queued, 6 stale), 80 tests (20 queued, 60 stale)";
const CLAUSE = ZERO.replace("Known failures: 0", "");
/** What a wait's verdict line says of the worktree, after its own part and before its next step (row 011-243). */
const worktreePart = (line: string | undefined) =>
  line
    ?.split(". Worktree: ")
    .at(-1)
    ?.split(/\. (?:A later pass is not reported|For the verdict)/)[0];

const LIVE: DaemonRecord = {
  socketPath: "/tmp/squeal-not-current.sock",
  startedAt: NOW - 60_000,
  heartbeatAt: NOW - 1_000,
  heartbeatIntervalMs: 5_000,
  squealVersion: "0.0.0-test",
  token: "live",
};

interface Seeded {
  readonly repo: FakeRepo;
  readonly store: Store;
  readonly wt: string;
}

/** A worktree at revision 26, its daemon live unless `daemon` is `null`. */
function worktree(daemon: DaemonRecord | null = LIVE): Seeded {
  const repo = fakeRepo();
  const store = seedStore(repo);
  const wt = repo.mainId;
  store.worktrees.upsert({
    id: wt,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon,
  });
  appendRevisions(store, wt, HEAD, { head: null, dirty: true });
  store.meta.set(refinedMetaKey(wt), String(HEAD));
  return { repo, store, wt };
}

/**
 * `path`'s key row and `tests` checks of `validity`: a pending file is
 * `phase` (queued unless named), a stale one's key moved with nothing queued.
 */
function file(
  { store, wt }: Seeded,
  path: string,
  validity: Validity,
  { tests = 10, phase = "queued", outcome = "pass", key = `k-${path}` } = {} as {
    tests?: number;
    phase?: PendingPhase;
    outcome?: "pass" | "fail";
    key?: string | null;
  },
): void {
  const pending = validity === "pending" ? phase : null;
  store.testFileKeys.upsertMany([
    {
      worktreeId: wt,
      testFile: { project: "", path: path as never },
      key: key as CheckKey | null,
      revision: HEAD,
      pending,
    },
  ]);
  store.knownStates.upsertMany(
    Array.from({ length: tests }, (_, i) =>
      state(wt, check(path, `t${i}`), {
        validity,
        pendingPhase: pending,
        outcome,
        observedAt: 10,
        ...(outcome === "fail" ? { summary: "AssertionError", fingerprint: "f" } : {}),
      }),
    ),
  );
}

/** gh-45's `zero`: 10 files of 10 passing tests, 6 stale, 2 queued, 2 current. */
function zero(daemon: DaemonRecord | null = LIVE): Seeded {
  const w = worktree(daemon);
  for (let i = 0; i < 10; i++) {
    file(w, `src/f${i}.test.ts`, i < 6 ? "stale" : i < 8 ? "pending" : "current");
  }
  return w;
}

function snapshotOf({ repo }: Seeded): StatusSnapshot {
  const status = readStatus(repo.main, { now: () => NOW });
  if (!status.available) throw new Error(status.message);
  return status;
}

async function registrationText({ store, wt }: Seeded): Promise<string> {
  const delivery = createDelivery(store, { status: fixedStatus(), now: () => NOW });
  const consumer: Consumer = { worktreeId: wt, sessionId: "s1", agentId: "main" };
  return formatRegistration(await delivery.register(consumer), undefined, "squeal", NOW);
}

function stopText({ store, wt }: Seeded): string {
  const header = readLiveHeader(store, wt, NOW);
  const failures = store.knownStates.list(wt).filter((s) => s.outcome === "fail");
  return statusText(header, failures as never);
}

async function cli({ repo }: Seeded, args: readonly string[]) {
  let out = "";
  let err = "";
  const io: CliIo = {
    stdout: (t) => {
      out += t;
    },
    stderr: (t) => {
      err += t;
    },
    cwd: repo.main,
    now: () => NOW,
    env: {},
  };
  const code = await main([...args], io);
  return { code, out, err };
}

const knownLine = (text: string) => text.split("\n").find((l) => l.startsWith("Known failures:"));

describe("Known failures says what is not current (011-26, gh-45 zero)", () => {
  it("in status, plain and --json", () => {
    const snapshot = snapshotOf(zero());
    expect(formatStatus(snapshot, NOW).split("\n")[1]).toBe(ZERO);
    expect(snapshot.testFileCounts).toEqual({ current: 2, pending: 2, stale: 6, unknown: 0 });
    expect(snapshot.testFilesByPhase).toEqual({ running: 0, queued: 2 });
    expect(snapshot.counts).toEqual({ current: 20, pending: 20, stale: 60, unknown: 0 });
  });

  it("in the registration header and Stop", async () => {
    const w = zero();
    expect(knownLine(await registrationText(w))).toBe(ZERO);
    expect(knownLine(stopText(w))).toBe(ZERO);
    const failures: { check: CheckId; validity: Validity }[] = [];
    expect(knownFailuresLine(failures, "squeal", readLiveHeader(w.store, w.wt, NOW))).toBe(ZERO);
  });

  it("at the end of both waits' verdict lines", () => {
    const result = snapshotOf(zero());
    const wait = { outcome: "news", waitedMs: 1_000, transitions: 1, result } as EndedWait;
    expect(worktreePart(waitLine(wait))).toBe(`known failures 0${CLAUSE}`);
    const named = {
      outcome: "settled",
      waitedMs: 1_000,
      selection: { files: [{ project: "", path: "src/f9.test.ts" }], unmatched: [] },
      verdict: {
        revision: HEAD,
        testFiles: 1,
        byClass: { current: 1, pending: 0, stale: 0, unknown: 0 },
        unlisted: false,
        failures: { tests: 0, testFiles: 0 },
      },
      files: [{ testFile: { project: "", path: "src/f9.test.ts" }, state: "current" }],
      sync: { state: "synced", revision: HEAD },
      result,
    } as unknown as EndedNamed;
    expect(worktreePart(namedLine(named))).toBe(`known failures 0${CLAUSE}`);
  });

  it("in both waits' --json snapshot and on their verdict line", async () => {
    const w = zero(null);
    for (const [args, exit] of [
      [["status", "--wait", "1000", "--json"], 0],
      [["status", "--wait", "1000", "--json", "src/f9.test.ts"], 3],
    ] as const) {
      const { code, out, err } = await cli(w, args);
      expect(code).toBe(exit);
      const json = JSON.parse(out) as StatusSnapshot;
      expect(json.testFileCounts).toEqual({ current: 2, pending: 2, stale: 6, unknown: 0 });
      expect(json.testFilesByPhase).toEqual({ running: 0, queued: 2 });
      expect(worktreePart(err.trimEnd().split("\n").at(-1))).toBe(`known failures 0${CLAUSE}`);
    }
  });
});

/** The header's classes, and the named wait's over every listed file (`readVerdict`). */
function classes({ store, wt }: Seeded) {
  return {
    header: readHeader(store, wt).testFileCounts,
    named: readVerdict(store, wt, null).byClass,
  };
}

describe("test files classed as a named wait classes them (011-26)", () => {
  it("a file without checks: queued is pending, unkeyed or never run is unknown", () => {
    const w = worktree();
    file(w, "src/queued.test.ts", "pending", { tests: 0 });
    file(w, "src/unkeyed.test.ts", "unknown", { tests: 0, key: null });
    file(w, "src/never.test.ts", "current", { tests: 0 });
    file(w, "src/ok.test.ts", "current", { tests: 1 });
    const { header, named } = classes(w);
    expect(header).toEqual({ current: 1, pending: 1, stale: 0, unknown: 2 });
    expect(header).toEqual(named);
    expect(knownLine(formatStatus(snapshotOf(w), NOW))).toBe(
      "Known failures: 0; not current: 3 of 4 test files (1 queued, 2 unknown)",
    );
  });

  it("a file whose open run a re-key queued counts running (C15), in status and the header", async () => {
    const w = worktree();
    file(w, "src/rekeyed.test.ts", "pending", { tests: 2 });
    file(w, "src/ok.test.ts", "current", { tests: 1 });
    w.store.runs.start({
      id: "run-1",
      worktreeId: w.wt,
      revision: (HEAD - 1) as never,
      testFiles: [{ project: "", path: "src/rekeyed.test.ts" as never }],
      checkpointId: null,
      logDir: "/tmp/run-1",
      startedAt: NOW - 30_000,
    });
    const snapshot = snapshotOf(w);
    expect(snapshot.testFilesByPhase).toEqual({ running: 1, queued: 0 });
    expect(snapshot.breakdown.pendingByPhase).toEqual({ running: 2, queued: 0 });
    const line =
      "Known failures: 0; not current: 1 of 2 test files (1 running), 2 tests (2 running)";
    expect(knownLine(formatStatus(snapshot, NOW))).toBe(line);
    expect(knownLine(await registrationText(w))).toBe(line);
    expect(classes(w).header).toEqual(classes(w).named);
  });

  it("a slow file is classed as any file", () => {
    const w = worktree();
    file(w, "test/slow.test.ts", "pending", { tests: 1 });
    file(w, "test/slow-stale.test.ts", "stale", { tests: 1 });
    file(w, "src/ok.test.ts", "current", { tests: 1 });
    const { header, named } = classes(w);
    expect(header).toEqual({ current: 1, pending: 1, stale: 1, unknown: 0 });
    expect(header).toEqual(named);
  });

  it("a failed global setup's files are unknown; the setup counts among known failures only", () => {
    const w = worktree();
    w.store.knownStates.upsertMany([
      state(w.wt, { kind: "setup", project: "web", testPath: "vitest.setup.ts" } as never, {
        outcome: "fail",
        summary: "setup failed",
        fingerprint: "s",
      }),
    ]);
    w.store.testFileKeys.upsertMany([
      {
        worktreeId: w.wt,
        testFile: { project: "web", path: "test/a.test.ts" as never },
        key: "k-a" as CheckKey,
        revision: HEAD,
        pending: null,
      },
    ]);
    const { header, named } = classes(w);
    expect(header).toEqual({ current: 0, pending: 0, stale: 0, unknown: 1 });
    expect(header).toEqual(named);
    expect(knownLine(formatStatus(snapshotOf(w), NOW))).toBe(
      "Known failures: 1 (1 global setup); not current: 1 of 1 test file (1 unknown)",
    );
  });
});

describe("all N test files current only with a live daemon, the files listed and the runner part done", () => {
  const current = (daemon: DaemonRecord | null = LIVE) => {
    const w = worktree(daemon);
    file(w, "src/a.test.ts", "current", { tests: 2 });
    file(w, "src/b.test.ts", "current", { tests: 1 });
    return w;
  };

  it("says so with a live daemon", async () => {
    const w = current();
    const line = "Known failures: 0; all 2 test files current";
    expect(knownLine(formatStatus(snapshotOf(w), NOW))).toBe(line);
    expect(knownLine(await registrationText(w))).toBe(line);
    expect(knownLine(stopText(w))).toBe(line);
  });

  it("not while no daemon validates", async () => {
    const w = current(null);
    const line = "Known failures: 0; 2 test files current as of revision 26";
    expect(knownLine(formatStatus(snapshotOf(w), NOW))).toBe(line);
    expect(knownLine(await registrationText(w))).toBe(line);
  });

  it("not while the runner part of the revision is pending", () => {
    const w = current();
    w.store.meta.set(refinedMetaKey(w.wt), String(HEAD - 1));
    expect(knownLine(formatStatus(snapshotOf(w), NOW))).toBe(
      "Known failures: 0; 2 test files current; revision 26 is not listed yet, so test files it adds are not counted",
    );
  });

  it("not while the daemon has not listed the test files", async () => {
    const w = worktree();
    const line = "Known failures: 0; the daemon has not listed this worktree's test files yet";
    expect(knownLine(formatStatus(snapshotOf(w), NOW))).toBe(line);
    expect(knownLine(await registrationText(w))).toBe(line);
  });

  it("names the unlisted revision after what is not current", () => {
    const w = zero();
    w.store.meta.set(refinedMetaKey(w.wt), String(HEAD - 1));
    expect(knownLine(formatStatus(snapshotOf(w), NOW))).toBe(
      `${ZERO}; revision 26 is not listed yet, so test files it adds are not counted`,
    );
  });
});
