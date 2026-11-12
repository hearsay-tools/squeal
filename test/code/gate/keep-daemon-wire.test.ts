import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { requestDaemon } from "../../../src/core/daemon/client.js";
import type { AbsolutePath } from "../../../src/core/types/common.js";
import type { DaemonResponse } from "../../../src/core/types/daemon.js";
import type { KeepResponse } from "../../../src/core/types/daemon-writes.js";
import type { CheckRunResult } from "../../../src/core/types/runner.js";
import {
  A,
  B,
  countGateWrites,
  KEY_A,
  KEY_B,
  kept,
  recordAt,
  resultsAt,
  type Served,
  served,
} from "./keep-daemon-kit.js";

/*
 * Row 021-20, review 0.1.450: the keep request on the daemon's socket.
 * B1: a coverage record or a results list past 64 KiB is carried, whole or
 * in fragments, as a `write` line is, and a line past the 32 MiB bound is
 * still refused, with its own reason. B3: the daemon takes only what the
 * gate's keeper writes, checked whole before either store is opened, and
 * refuses anything else with no write.
 */

const SLOW = { timeout: 60_000 } as const;

/** A valid coverage record of `unread` paths: 10,000 make about 200 KB. */
const bigRecord = (unread: number) => ({
  v: 1,
  sources: [],
  // Sorted, as a stored record holds them (`shareRecord`).
  unread: Array.from({ length: unread }, (_, i) => `src/module-${i}/index-${i}.mjs`).sort(),
});

/** `count` passing tests of `test/a.test.ts`, with names long enough to pass 64 KiB. */
const passes = (count: number): CheckRunResult[] =>
  Array.from({ length: count }, (_, i) => ({
    check: {
      kind: "test",
      project: "",
      testPath: A.path,
      fullName: `case ${i} ${"of a long describe block ".repeat(3)}`,
    },
    outcome: "pass",
    durationMs: 1,
    location: null,
    errors: [],
  }));

/** One line written in `size`-byte pieces, a turn of the event loop between them; the answer. */
async function sendInPieces(
  socket: AbsolutePath,
  line: string,
  size: number,
): Promise<DaemonResponse> {
  return new Promise((resolve, reject) => {
    const client = createConnection(socket);
    let answer = "";
    client.setEncoding("utf8");
    client.on("error", reject);
    client.on("data", (chunk) => {
      answer += chunk;
      const end = answer.indexOf("\n");
      if (end < 0) return;
      client.destroy();
      resolve(JSON.parse(answer.slice(0, end)) as DaemonResponse);
    });
    client.on("connect", async () => {
      for (let at = 0; at < line.length; at += size) {
        if (client.destroyed) return;
        client.write(line.slice(at, at + size));
        await yieldTurn();
      }
    });
  });
}

/** How keep try `id` ended, asked until it has. */
async function outcomeOf(at: Served, id: string): Promise<KeepResponse["outcome"]> {
  for (;;) {
    const answer = await requestDaemon(
      at.socketPath,
      { type: "keep-status", requestId: id },
      2_000,
    );
    if (!answer.ok || answer.type !== "keep") throw new Error(JSON.stringify(answer));
    if (answer.outcome !== null) return answer.outcome;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** A keep request of `write` for `at`'s worktree, sent to its daemon's socket. */
async function sendKeep(at: Served, write: unknown): Promise<DaemonResponse & { id?: string }> {
  const id = randomUUID();
  const request = {
    type: "keep",
    id,
    worktreeId: at.worktreeId,
    storeSchema: at.storeSchema,
    write,
  };
  return { ...(await requestDaemon(at.socketPath, request as never, 2_000)), id };
}

describe("a keep line past 64 KiB (review 0.1.450 B1)", () => {
  it(
    "keeps a coverage record and a results list each past 64 KiB, with no write of the gate's own",
    SLOW,
    async () => {
      const at = await served();
      const record = bigRecord(10_000);
      const results = passes(1_500);
      expect(JSON.stringify(record).length).toBeGreaterThan(200_000);
      expect(JSON.stringify(results).length).toBeGreaterThan(64 * 1024);
      const notes: string[] = [];
      const count = countGateWrites();
      await kept(at, notes, { record, results });
      expect(count.stop()).toBe(0);
      expect(notes).toEqual([]);
      expect(recordAt(at.commonDir)).toEqual(record);
      expect(resultsAt(at.commonDir)).toBe(1_501);
    },
  );

  it("takes a long keep line that arrives in pieces", SLOW, async () => {
    const at = await served();
    const record = bigRecord(10_000);
    const id = randomUUID();
    const request = {
      type: "keep",
      id,
      worktreeId: at.worktreeId,
      storeSchema: at.storeSchema,
      write: { kind: "coverage", key: KEY_A, record },
    };
    const answer = await sendInPieces(at.socketPath, `${JSON.stringify(request)}\n`, 4_096);
    expect(answer).toMatchObject({ ok: true, type: "keep", requestId: id });
    expect(await outcomeOf(at, id)).toEqual({ kept: true });
    expect(recordAt(at.commonDir)).toEqual(record);
  });

  it("still refuses a keep line past 32 MiB", SLOW, async () => {
    const at = await served();
    const line = `{"type":"keep",${"x".repeat(33 * 1024 * 1024)}`;
    expect(await sendInPieces(at.socketPath, line, 1024 * 1024)).toMatchObject({
      ok: false,
      error: "request too long",
    });
    expect(at.keeps).toEqual([]);
  });

  it("says why the daemon refused the write, and keeps the older note for an older daemon only", async () => {
    const stopping = await served({ phase: "stopping" });
    const notes: string[] = [];
    await kept(stopping, notes);
    expect(notes).toEqual([
      "1 completed test file was not kept in the stores: the daemon refused the write: daemon is stopping",
    ]);
  });
});

describe("what a keep request may write (review 0.1.450 B3)", () => {
  const provenance = (at: Served) => ({
    worktreeId: at.worktreeId,
    revision: 0,
    commit: "c".repeat(40),
    dirty: false,
    runId: `gate-${randomUUID()}`,
    recordedAt: 1_762_000_000_000,
  });
  const fileRecord = (at: Served, run = provenance(at)) => ({
    check: { kind: "file", project: "", testPath: A.path },
    key: KEY_A,
    outcome: "pass",
    durationMs: 1,
    location: null,
    fingerprint: null,
    summary: null,
    errors: [],
    provenance: run,
  });
  const results = (records: unknown[]) => ({
    kind: "results",
    key: KEY_A,
    records,
    paths: ["src/a.mjs"],
    environmentFiles: [],
  });

  it("writes the results the gate builds", async () => {
    const at = await served();
    const answer = await sendKeep(at, results([fileRecord(at)]));
    expect(answer).toMatchObject({ ok: true, type: "keep" });
    expect(await outcomeOf(at, answer.id as string)).toEqual({ kept: true });
    expect(resultsAt(at.commonDir)).toBe(1);
  });

  it.each([
    ["an unknown outcome", (at: Served) => results([{ ...fileRecord(at), outcome: "unknown" }])],
    [
      "a setup check",
      (at: Served) =>
        results([{ ...fileRecord(at), check: { kind: "setup", project: "", testPath: A.path } }]),
    ],
    [
      "a second test file",
      (at: Served) => {
        const run = provenance(at);
        const other = {
          ...fileRecord(at, run),
          check: { kind: "file", project: "", testPath: B.path },
        };
        return results([fileRecord(at, run), other]);
      },
    ],
    ["a record at another key", (at: Served) => results([{ ...fileRecord(at), key: KEY_B }])],
    [
      "another run's record",
      (at: Served) =>
        results([
          fileRecord(at),
          {
            ...fileRecord(at),
            check: { kind: "test", project: "", testPath: A.path, fullName: "t" },
          },
        ]),
    ],
    [
      "a run that is not the gate's",
      (at: Served) =>
        results([{ ...fileRecord(at), provenance: { ...provenance(at), runId: "run-1" } }]),
    ],
    [
      "another worktree's provenance",
      (at: Served) =>
        results([
          { ...fileRecord(at), provenance: { ...provenance(at), worktreeId: "elsewhere" } },
        ]),
    ],
    [
      "a field of its own",
      (at: Served) => results([{ ...fileRecord(at), sql: "DROP TABLE results" }]),
    ],
    [
      "a malformed error",
      (at: Served) => results([{ ...fileRecord(at), outcome: "fail", errors: [{ name: 1 }] }]),
    ],
    [
      "a coverage record of another version",
      () => ({ kind: "coverage", key: KEY_A, record: { v: 2, sources: [], unread: [] } }),
    ],
    [
      "a coverage source without its spans",
      () => ({
        kind: "coverage",
        key: KEY_A,
        record: {
          v: 1,
          sources: [
            {
              path: "src/a.mjs",
              blob: "b".repeat(40),
              lines: "AQ==",
              covered: "AQ==",
              functions: [[1, 2]],
            },
          ],
          unread: [],
        },
      }),
    ],
    [
      "a key that is not a result key",
      () => ({ kind: "coverage", key: "k1", record: { v: 1, sources: [], unread: [] } }),
    ],
  ] as const)("refuses %s with no write to either store", async (_, writeOf) => {
    const at = await served();
    const answer = await sendKeep(at, writeOf(at));
    expect(answer.ok).toBe(false);
    expect(at.keeps).toEqual([]);
    expect(resultsAt(at.commonDir, KEY_A)).toBe(0);
    expect(resultsAt(at.commonDir, KEY_B)).toBe(0);
    expect(recordAt(at.commonDir)).toBeNull();
  });
});
