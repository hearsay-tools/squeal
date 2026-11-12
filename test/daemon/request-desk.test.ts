import { describe, expect, it } from "vitest";
import { parseRequest } from "../../src/core/daemon/protocol.js";
import { RequestDesk } from "../../src/core/daemon/request-desk.js";
import type { WorktreeId } from "../../src/core/types/common.js";
import type {
  ImportOutcome,
  ImportRequest,
  KeepRequest,
} from "../../src/core/types/daemon-writes.js";

/*
 * Spec 021 D15 (row 021-20): the socket's side of a request the daemon's
 * main thread runs: `squeal import`'s import and the code gate's kept
 * files. Each request is checked as it is parsed; the desk refuses another
 * worktree, another store schema and a stopping daemon, so the client does
 * as it does with no daemon; it hands every other request to the main
 * thread and answers its outcome from memory.
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

const KEEP: KeepRequest = {
  type: "keep",
  worktreeId: WORKTREE,
  storeSchema: 7,
  write: { kind: "coverage", key: "k1", record: { v: 1, sources: [], unread: [] } },
};

function importDesk(outcome: Promise<ImportOutcome> = new Promise(() => {})) {
  const taken: ImportRequest[] = [];
  const desk = new RequestDesk({
    type: "import",
    worktreeId: WORKTREE,
    storeSchema: 7,
    run: (request: ImportRequest) => {
      taken.push(request);
      return outcome;
    },
  });
  return { desk, taken };
}

const requestIdOf = (answer: object) => (answer as { requestId: string }).requestId;

describe("the import and keep requests (021-20)", () => {
  it("parse whole and refuse a part that is wrong", () => {
    expect(parseRequest(JSON.stringify(REQUEST))).toEqual(REQUEST);
    expect(parseRequest(JSON.stringify(KEEP))).toEqual(KEEP);
    for (const type of ["import-status", "keep-status"]) {
      expect(parseRequest(JSON.stringify({ type, requestId: "r" }))).toEqual({
        type,
        requestId: "r",
      });
    }
    for (const [part, why] of [
      [{ file: "results.json.gz" }, '"file" must be an absolute path'],
      [{ fileHash: "abc" }, '"fileHash" must be a SHA-256 in hex'],
      [{ dryRun: "no" }, '"dryRun" must be true or false'],
      [{ storeSchema: 1.5 }, '"storeSchema" must be an integer'],
      [{ worktreeId: "" }, '"worktreeId" must be a non-empty string'],
    ] as const) {
      expect(parseRequest(JSON.stringify({ ...REQUEST, ...part }))).toBe(why);
    }
    const results = { kind: "results", records: [{}], paths: ["a"], environmentFiles: [] };
    expect(parseRequest(JSON.stringify({ ...KEEP, write: results }))).toMatchObject({
      write: results,
    });
    for (const [write, why] of [
      [{ kind: "other" }, '"write.kind" must be "coverage" or "results"'],
      [{ kind: "coverage", key: "", record: {} }, '"write.key" must be a non-empty string'],
      [{ kind: "coverage", key: "k", record: null }, '"write.record" must be an object'],
      [{ ...results, records: [] }, '"write.records" must be a non-empty list'],
      [{ ...results, paths: [1] }, '"write.paths" must be a list of strings'],
      [{ ...results, environmentFiles: "x" }, '"write.environmentFiles" must be a list of strings'],
    ] as const) {
      expect(parseRequest(JSON.stringify({ ...KEEP, write }))).toBe(why);
    }
  });
});

describe("the request desk (021-20)", () => {
  it("hands a request to the main thread and answers its outcome once it ended", async () => {
    let end: (outcome: ImportOutcome) => void = () => {};
    const { desk, taken } = importDesk(new Promise((resolve) => (end = resolve)));
    const answer = desk.take(REQUEST, "ready");
    expect(answer).toMatchObject({ ok: true, type: "import", outcome: null });
    expect(taken).toEqual([REQUEST]);
    const requestId = requestIdOf(answer);
    expect(desk.status(requestId)).toMatchObject({ outcome: null });
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
    expect(desk.status(requestId)).toMatchObject({ outcome: { counts, commitHere: false } });
  });

  it("answers a rejected run as failed", async () => {
    const { desk } = importDesk(Promise.reject(new Error("disk full")));
    const answer = desk.take(REQUEST, "ready");
    await new Promise((resolve) => setImmediate(resolve));
    expect(desk.status(requestIdOf(answer))).toMatchObject({ outcome: { failed: "disk full" } });
  });

  it("refuses another worktree, another store schema, a stopping daemon and an unknown id", () => {
    const { desk, taken } = importDesk();
    expect(desk.take({ ...REQUEST, worktreeId: "w2" as WorktreeId }, "ready")).toMatchObject({
      ok: false,
      error: "this daemon serves worktree w1, not w2",
    });
    expect(desk.take({ ...REQUEST, storeSchema: 6 }, "ready")).toMatchObject({
      ok: false,
      error: "the daemon's store is at schema 7, not 6",
    });
    expect(desk.take(REQUEST, "stopping")).toMatchObject({
      ok: false,
      error: "daemon is stopping",
    });
    expect(desk.status("none")).toMatchObject({ ok: false, error: "unknown request id none" });
    expect(taken).toEqual([]);
  });
});
