import { describe, expect, it } from "vitest";
import { askRetry } from "../../src/core/retry/records.js";
import { fullSuiteRequest } from "../../src/core/scheduler/checkpoint-requests.js";
import { block } from "../../src/core/scheduler/failures.js";
import type { FileState } from "../../src/core/scheduler/files.js";
import { AWAITING_INSTALL_REASON } from "../../src/core/scheduler/install.js";
import { narrowRequest, REINSTALLED_REASON } from "../../src/core/scheduler/narrow-run.js";
import { BacklogQuiet } from "../../src/core/scheduler/quiet.js";
import { groupRequest } from "../../src/core/scheduler/request-intake-requests.js";
import { retryRequest } from "../../src/core/scheduler/retries.js";
import { WarmUp } from "../../src/core/scheduler/warm-up.js";
import {
  COVERED_FILES_KEPT_MS,
  COVERED_FILES_TABLE,
  type CoveredFiles,
  readCoveredFiles,
} from "../../src/core/store/covered-files.js";
import { connectionOf } from "../../src/core/store/store.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { DEFAULT_POLICY, type Policy } from "../../src/core/types/policy.js";
import { SLOW_GROUP, TESTS_GROUP } from "../../src/core/types/scheduler.js";
import {
  A,
  B,
  C,
  D,
  keyOf,
  NOTHING,
  type Probe,
  probe,
  probeHost,
  queueA,
  S,
  WT,
} from "./request-intake-probe.js";

/*
 * Row 011-325: the request intake records each request's covered files as
 * the scheduler decided them, under a request id, in the transaction that
 * queues them (`recordCovered`); `readCoveredFiles` returns them by the id
 * the answer carries. One row per request, through `RequestIntake.take`
 * with the real declarations over a real store and ledger
 * (`request-intake-probe.ts`). The probe lists `A`, which has no key, and
 * `B`, queued; a row lists `C`, current at its key, `D`, blocked by its
 * runner's failure, and `S`, slow and queued.
 */

const RUNNER_FAILED = "vitest crashed\n    at the runner";
const SLOW_S: Policy = { ...DEFAULT_POLICY, slow: { ...DEFAULT_POLICY.slow, include: [S.path] } };
const NOT_KEYED = "test/a.test.ts not queued: Squeal cannot key it";

function fileOf(p: Probe, ref: TestFileRef): FileState {
  const file = p.ledger.file(ref);
  if (file === undefined) throw new Error(`${ref.path} is not listed`);
  return file;
}

/** Lists `C`, with a result at its key, and with `blocked` `D`, which its runner's failure blocks. */
function listMore(p: Probe, blocked = true): void {
  p.ledger.addFile(C);
  p.ledger.settle([C], NOTHING);
  p.ledger.applyResults(fileOf(p, C), keyOf(C), [], null);
  if (blocked) {
    p.ledger.addFile(D);
    p.ledger.settle([D], NOTHING);
    block(p.ledger, new Map([[null, RUNNER_FAILED]]), (file) => file.ref.path === D.path);
  }
  p.ledger.commit();
}

/** Lists `S`, queued. */
function listSlow(p: Probe): void {
  p.ledger.addFile(S);
  p.ledger.settle([S], NOTHING);
  p.ledger.commit();
}

/** The record of `id`, each file as "<path> <state>[: reason]", sorted. */
function decided(p: Probe, id: string | undefined): string[] {
  const record = id === undefined ? null : readCoveredFiles(p.store, id);
  if (record === null) throw new Error(`no covered files recorded under ${id}`);
  return record.files
    .map((f) =>
      f.state === "not-queued"
        ? `${f.testFile.path} not queued: ${f.reason}`
        : `${f.testFile.path} ${f.state}`,
    )
    .sort();
}

/** The ids recorded, oldest first; none before the first record. */
function ids(p: Probe): string[] {
  const conn = connectionOf(p.store);
  const found = conn.get(
    "SELECT 1 AS found FROM sqlite_master WHERE name = ?",
    COVERED_FILES_TABLE,
  );
  if (found === null) return [];
  return conn
    .all(`SELECT id FROM ${COVERED_FILES_TABLE} ORDER BY recorded_at, rowid`)
    .map((row) => String(row.id));
}

const checkpointHost = () => ({ quiet: new BacklogQuiet(), warmUp: new WarmUp() });

describe("covered files: each request's, as decided (row 011-325)", () => {
  it("run <group>: the group's files, queued, current or not queued with the reason", async () => {
    const p = probeHost();
    listMore(p);
    const answer = await p.intake.take(groupRequest(TESTS_GROUP, p.groups, undefined));
    expect(decided(p, answer?.coveredId)).toEqual([
      NOT_KEYED,
      "test/b.test.ts queued",
      "test/c.test.ts current",
      "test/d.test.ts not queued: its runner failed: vitest crashed",
    ]);
    const record = readCoveredFiles(p.store, answer?.coveredId ?? "") as CoveredFiles;
    expect(record).toMatchObject({ worktreeId: WT, revision: answer?.revision });
  });

  it("run --slow: the slow group's files only", async () => {
    const p = probeHost({ policy: SLOW_S });
    listMore(p, false);
    listSlow(p);
    const answer = await p.intake.take(groupRequest(SLOW_GROUP, p.groups, undefined));
    expect(answer).toMatchObject({ queued: 1 });
    expect(decided(p, answer?.coveredId)).toEqual(["test/s.test.ts queued"]);
  });

  it("run <group> <path>: its selection, the not-queued ones as its answer names them", async () => {
    const p = probeHost();
    listMore(p);
    const answer = await p.intake.take(
      narrowRequest(TESTS_GROUP, [B.path, C.path, D.path], p.groups),
    );
    const failed = "its runner failed: vitest crashed";
    expect(decided(p, answer?.coveredId)).toEqual([
      "test/b.test.ts queued",
      "test/c.test.ts current",
      `test/d.test.ts not queued: ${failed}`,
    ]);
    expect(answer?.narrow.notRun).toEqual([{ testFile: D, reason: failed }]);
  });

  it("retry: the files it claimed, queued", async () => {
    const p = probeHost();
    listMore(p, false);
    const at = p.state.now;
    askRetry(p.store, {
      testFile: C,
      key: keyOf(C),
      session: "s1",
      reason: "environment",
      at,
      worktreeId: WT,
    });
    await p.intake.take(retryRequest());
    expect(ids(p)).toHaveLength(1);
    expect(decided(p, ids(p)[0])).toEqual(["test/c.test.ts queued"]);
  });

  it("run --all: its checkpoint's files and its files already current", async () => {
    const p = probeHost();
    listMore(p, false);
    const answer = await p.intake.take(fullSuiteRequest({}, checkpointHost()));
    expect(answer.testFiles.map((ref) => ref.path).sort()).toEqual([A.path, B.path]);
    expect(decided(p, answer.coveredId)).toEqual([
      NOT_KEYED,
      "test/b.test.ts queued",
      "test/c.test.ts current",
    ]);
  });

  // Review wave 3.6, B1: a joined request's covered files are its own, never the baseline's others.
  it("run --all --fast joined to a baseline: its own lane's files only", async () => {
    const p = probeHost({ policy: SLOW_S });
    listMore(p, false);
    listSlow(p);
    const revision = p.ledger.revision.number;
    p.ledger.checkpoints.start("baseline-1", "baseline", revision, [A, B, S]);
    const answer = await p.intake.take(fullSuiteRequest({ lane: "fast" }, checkpointHost()));
    expect(answer.owner).toBe("baseline-1");
    expect(decided(p, answer.coveredId)).toEqual([
      NOT_KEYED,
      "test/b.test.ts queued",
      "test/c.test.ts current",
    ]);
  });
});

describe("covered files: the install wait (row 011-325)", () => {
  /** Each request taken through the probe's intake, and its answer's id. */
  type Taken = (p: Probe) => Promise<{ readonly coveredId?: string } | null>;
  const requests: readonly (readonly [string, string, Taken])[] = [
    ["run --all", REINSTALLED_REASON, (p) => p.intake.take(fullSuiteRequest({}, checkpointHost()))],
    [
      "run <group>",
      AWAITING_INSTALL_REASON,
      (p) => p.intake.take(groupRequest(TESTS_GROUP, p.groups, undefined)),
    ],
    [
      "run <group> <path>",
      AWAITING_INSTALL_REASON,
      (p) => p.intake.take(narrowRequest(TESTS_GROUP, [A.path, B.path, C.path], p.groups)),
    ],
  ];

  it.each(requests)(
    "%s: not queued, with the reason, and no progress record",
    async (_, reason, take) => {
      const p = probeHost();
      listMore(p, false);
      p.state.waiting = reason;
      const answer = await take(p);
      expect(decided(p, answer?.coveredId)).toEqual([
        `test/a.test.ts not queued: ${reason}`,
        `test/b.test.ts not queued: ${reason}`,
        "test/c.test.ts current",
      ]);
      expect(p.log.filter((line) => line.startsWith("record"))).toEqual([]);
    },
  );
});

describe("covered files: the record's transaction and lifetime (row 011-325)", () => {
  it("records nothing for a stage that throws", async () => {
    const p = probeHost();
    const request = probe(p, {
      store: {
        stage: (context, ledger) => {
          queueA(p)(context, ledger);
          throw new Error("the probe failed");
        },
      },
    });
    await expect(p.intake.take(request)).rejects.toThrow("the probe failed");
    expect(ids(p)).toEqual([]);
    expect(readCoveredFiles(p.store, "unknown")).toBeNull();
  });

  // Condition 1 of the agreement with card 3: one read sees both the files queued and the record.
  it("is written in the transaction that queues the files: one it cannot write queues none", async () => {
    const p = probeHost();
    connectionOf(p.store).db.exec(`CREATE TABLE ${COVERED_FILES_TABLE} (id TEXT PRIMARY KEY)`);
    await expect(p.intake.take(probe(p))).rejects.toThrow(/files/);
    expect(p.log).toEqual(["stage (A not queued)"]);
    expect(p.committed()).toEqual({ key: null, pending: null });
  });

  // For a request whose answer carries no id (an import's boolean, row 011-323): no record.
  it("writes none for a request that names why, and keeps its progress record", async () => {
    const p = probeHost();
    const record = { skip: "the probe's answer carries no id" };
    await p.intake.take(probe(p, { store: { stage: queueA(p), record } }));
    expect(ids(p)).toEqual([]);
    expect(p.log).toContain("record test/a.test.ts (A queued)");
  });

  it("survives a daemon handoff: the next daemon reads it, and keeps it while a file is queued", async () => {
    const before = probeHost();
    const answer = await before.intake.take(groupRequest(TESTS_GROUP, before.groups, undefined));
    const id = answer?.coveredId ?? "";
    const after = probeHost({ dir: before.dir });
    expect(readCoveredFiles(after.store, id)).toEqual(readCoveredFiles(before.store, id));
    after.state.now = before.state.now + 2 * COVERED_FILES_KEPT_MS;
    await after.intake.take(retryRequest());
    expect(decided(after, id)).toEqual([NOT_KEYED, "test/b.test.ts queued"]);
  });

  it("is pruned only once none of its files is queued or running and 10 minutes passed", async () => {
    const p = probeHost();
    const answer = await p.intake.take(groupRequest(TESTS_GROUP, p.groups, undefined));
    const id = answer?.coveredId ?? "";
    const start = p.state.now;
    /** A later request at `minutes` after the first, which prunes; whether the first is kept. */
    const keptAt = async (minutes: number) => {
      p.state.now = start + minutes * 60_000;
      await p.intake.take(retryRequest());
      return readCoveredFiles(p.store, id) !== null;
    };
    expect(await keptAt(11)).toBe(true);
    p.ledger.applyResults(fileOf(p, B), keyOf(B), [], null);
    p.ledger.commit();
    expect(await keptAt(12)).toBe(true);
    expect(await keptAt(21)).toBe(true);
    expect(await keptAt(22)).toBe(false);
  });
});
