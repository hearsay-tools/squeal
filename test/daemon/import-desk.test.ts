import { describe, expect, it } from "vitest";
import { ImportDesk } from "../../src/core/daemon/import-desk.js";
import { parseRequest } from "../../src/core/daemon/protocol.js";
import type { WorktreeId } from "../../src/core/types/common.js";
import type { ImportOutcome, ImportRequest } from "../../src/core/types/daemon-writes.js";

/*
 * Spec 021 D15 (row 021-20): the socket's side of `squeal import` through
 * the daemon. The request is checked as it is parsed; the desk refuses
 * another worktree, another store schema and a stopping daemon, so the
 * command imports itself; it hands every other import to the main thread
 * and answers its outcome from memory.
 */

const WORKTREE = "w1" as WorktreeId;
const REQUEST: ImportRequest = {
  type: "import",
  worktreeId: WORKTREE,
  storeSchema: 7,
  file: "/tmp/results.json.gz",
  fileHash: "a".repeat(64),
  dryRun: false,
};

function desk(outcome: Promise<ImportOutcome> = new Promise(() => {})) {
  const taken: ImportRequest[] = [];
  const d = new ImportDesk({
    worktreeId: WORKTREE,
    storeSchema: 7,
    requestImport: (request) => {
      taken.push(request);
      return outcome;
    },
  });
  return { d, taken };
}

describe("the import request (021-20)", () => {
  it("parses a whole request and refuses a part that is wrong", () => {
    expect(parseRequest(JSON.stringify(REQUEST))).toEqual(REQUEST);
    expect(parseRequest(JSON.stringify({ type: "import-status", requestId: "r" }))).toEqual({
      type: "import-status",
      requestId: "r",
    });
    for (const [part, why] of [
      [{ file: "results.json.gz" }, '"file" must be an absolute path'],
      [{ fileHash: "abc" }, '"fileHash" must be a SHA-256 in hex'],
      [{ dryRun: "no" }, '"dryRun" must be true or false'],
      [{ storeSchema: 1.5 }, '"storeSchema" must be an integer'],
      [{ worktreeId: "" }, '"worktreeId" must be a non-empty string'],
    ] as const) {
      expect(parseRequest(JSON.stringify({ ...REQUEST, ...part }))).toBe(why);
    }
  });
});

describe("the import desk (021-20)", () => {
  it("hands an import to the main thread and answers its outcome once it ended", async () => {
    let end: (outcome: ImportOutcome) => void = () => {};
    const { d, taken } = desk(new Promise((resolve) => (end = resolve)));
    const answer = d.answer(REQUEST, "ready");
    expect(answer).toMatchObject({ ok: true, type: "import", outcome: null });
    expect(taken).toEqual([REQUEST]);
    const requestId = answer.ok ? (answer as { requestId: string }).requestId : "";
    const status = { type: "import-status", requestId } as const;
    expect(d.answer(status, "ready")).toMatchObject({ outcome: null });
    const counts = {
      results: 1,
      alreadyStored: 0,
      closures: 0,
      observed: 0,
      startup: 0,
      rekeyed: 0,
    };
    end({ counts, commitHere: false });
    await Promise.resolve();
    expect(d.answer(status, "stopping")).toMatchObject({ outcome: { counts, commitHere: false } });
  });

  it("answers a rejected import as failed", async () => {
    const { d } = desk(Promise.reject(new Error("disk full")));
    const answer = d.answer(REQUEST, "ready") as { requestId: string };
    await new Promise((resolve) => setImmediate(resolve));
    expect(d.answer({ type: "import-status", requestId: answer.requestId }, "ready")).toMatchObject(
      {
        outcome: { failed: "disk full" },
      },
    );
  });

  it("refuses another worktree, another store schema, a stopping daemon and an unknown id", () => {
    const { d, taken } = desk();
    expect(d.answer({ ...REQUEST, worktreeId: "w2" as WorktreeId }, "ready")).toMatchObject({
      ok: false,
      error: "this daemon serves worktree w1, not w2",
    });
    expect(d.answer({ ...REQUEST, storeSchema: 6 }, "ready")).toMatchObject({
      ok: false,
      error: "the daemon's store is at schema 7, not 6",
    });
    expect(d.answer(REQUEST, "stopping")).toMatchObject({ ok: false, error: "daemon is stopping" });
    expect(d.answer({ type: "import-status", requestId: "none" }, "ready")).toMatchObject({
      ok: false,
      error: "unknown request id none",
    });
    expect(taken).toEqual([]);
  });
});
