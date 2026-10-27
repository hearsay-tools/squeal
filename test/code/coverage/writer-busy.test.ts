import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setImmediate as nextTurn } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUSY_BUDGET_MS,
  COVERAGE_PROVIDER_VERSION,
  type CoverageWriterOptions,
  type CoveredFile,
  createCoverageWriter,
  DROPPED_TOPIC,
} from "../../../src/core/code/coverage/index.js";
import { codeStorePath } from "../../../src/core/code/store/index.js";
import { BUSY_SLICE_MS, DEFAULT_BUSY_TIMEOUT_MS } from "../../../src/core/store/index.js";
import { commonDir, ON, open } from "../helpers.js";

/*
 * Row 015-79 (spec 015 D8, "A busy record store"): another connection that
 * keeps the code store's write lock costs a record a paced retry, never the
 * record. Each completed test file that gets no record is counted by its
 * cause and told in a saved note, since a hook-started daemon's log goes
 * nowhere.
 */

/** Past a busy slice and past the code store's own busy timeout, which the writer met before. */
const HOLD_MS = DEFAULT_BUSY_TIMEOUT_MS + 2 * BUSY_SLICE_MS;

const dirs: string[] = [];
const holders: ChildProcessWithoutNullStreams[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const holder of holders.splice(0)) holder.kill("SIGKILL");
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function payloadFile(test: string, payload?: string): CoveredFile {
  const dir = mkdtempSync(join(tmpdir(), "sq-writer-busy-"));
  dirs.push(dir);
  const text = "f();\n";
  const path = join(dir, "a.js");
  writeFileSync(path, text);
  const ranges = [{ startOffset: 0, endOffset: text.length, count: 1 }];
  const script = { url: `file://${path}`, functions: [{ functionName: "", ranges }] };
  writeFileSync(join(dir, "payload.json"), payload ?? JSON.stringify({ result: [script] }));
  const sha1 = createHash("sha1").update(text).digest("hex");
  return {
    testFile: { project: "", path: test },
    payload: join(dir, "payload.json"),
    sources: new Map([[path, { path: "a.js", code: text, map: null, sha1 }]]),
  };
}

/** Another process, as another daemon is, holds the code store's write lock until released. */
async function holdLock(dir: string): Promise<() => Promise<void>> {
  const script = [
    'const { DatabaseSync } = require("node:sqlite");',
    `const db = new DatabaseSync(${JSON.stringify(codeStorePath(dir))});`,
    'db.exec("BEGIN IMMEDIATE");',
    'process.stdout.write("held\\n");',
    'process.stdin.on("end", () => { db.exec("COMMIT"); db.close(); });',
    "process.stdin.resume();",
  ].join("\n");
  const holder = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "-e", script]);
  holders.push(holder);
  const exited = new Promise((resolve) => holder.on("close", resolve));
  await new Promise((resolve, reject) => {
    holder.stdout.once("data", resolve);
    holder.once("error", reject);
  });
  return async () => {
    holder.stdin.end();
    expect(await exited).toBe(0);
  };
}

interface Seen {
  readonly logs: string[];
  readonly notes: { readonly text: string; readonly topic: string }[];
  stored: number;
}

function writer(dir: string, options: Partial<CoverageWriterOptions> = {}) {
  const seen: Seen = { logs: [], notes: [], stored: 0 };
  const made = createCoverageWriter({
    commonDir: dir,
    format: "sha1",
    policy: () => ON,
    resultKey: (_run, testFile) => `key-${testFile.path}`,
    log: (text) => seen.logs.push(text),
    note: (text, topic) => seen.notes.push({ text, topic }),
    onStored: () => seen.stored++,
    waitsMs: [0],
    worker: null,
    ...options,
  });
  return { writer: made, seen };
}

const at = (resultKey: string) => ({ resultKey, providerVersion: COVERAGE_PROVIDER_VERSION });

describe("the records' writer beside a busy code store (row 015-79)", () => {
  it("keeps each record while another process holds the write lock, and stores it once free", async () => {
    const dir = commonDir();
    const store = open(dir);
    const release = await holdLock(dir);
    const files = ["a.test.js", "b.test.js", "c.test.js"].map((path) => payloadFile(path));
    let longest = 0;
    let done = false;
    const probe = (async () => {
      let last = performance.now();
      while (!done) {
        await nextTurn();
        longest = Math.max(longest, performance.now() - last);
        last = performance.now();
      }
    })();
    const asked: string[] = [];
    const { writer: made, seen } = writer(dir, {
      resultKey: (_run, testFile) => {
        asked.push(testFile.path);
        return `key-${testFile.path}`;
      },
    });

    made.collected({ runId: "run-1", files });
    await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
    const releasedAt = Date.now();
    await release();
    await made.idle();
    done = true;
    await probe;
    await made.close();

    for (const file of files) {
      expect(store.coverage.has(at(`key-${file.testFile.path}`)), file.testFile.path).toBe(true);
      expect(store.coverage.storedAt(at(`key-${file.testFile.path}`))).toBeGreaterThanOrEqual(
        releasedAt,
      );
      expect(existsSync(file.payload)).toBe(false);
    }
    expect(seen.stored).toBe(3);
    // A retry keeps the key it found, and the result waits stay its own: one look each.
    expect(asked).toEqual(["a.test.js", "b.test.js", "c.test.js"]);
    expect(made.dropped()).toEqual({});
    expect(seen.notes).toEqual([]);
    expect(seen.logs).toEqual([]);
    // Each try waits at most a busy slice on the main thread, never the store's whole busy timeout.
    expect(longest).toBeLessThan(DEFAULT_BUSY_TIMEOUT_MS);
  }, 30_000);

  it("drops a record after its busy budget, counts and notes it, and never calls onStored", async () => {
    const dir = commonDir();
    const store = open(dir);
    const release = await holdLock(dir);
    const { writer: made, seen } = writer(dir, { busyMs: 3 * BUSY_SLICE_MS });

    made.collected({ runId: "run-1", files: [payloadFile("a.test.js")] });
    await made.idle();
    await made.close();
    await release();

    expect(made.dropped()).toEqual({ busy: 1 });
    expect(seen.stored).toBe(0);
    expect(store.coverage.has(at("key-a.test.js"))).toBe(false);
    expect(seen.logs).toEqual([
      expect.stringMatching(/^coverage: a\.test\.js: the code store stayed locked for \d+ s$/),
    ]);
    expect(seen.notes).toEqual([
      {
        topic: DROPPED_TOPIC,
        text: expect.stringMatching(
          /^coverage: 1 completed test file got no record since this daemon started: 1 busy \(.+\); the last: a\.test\.js: the code store stayed locked for \d+ s$/,
        ),
      },
    ]);
    expect(BUSY_BUDGET_MS).toBe(120_000);
  }, 30_000);

  it("tells a missing result, a map error and a store that did not open apart from a busy store", async () => {
    const noResult = writer(commonDir(), { resultKey: () => undefined, waitsMs: [0, 5] });
    noResult.writer.collected({ runId: "run-1", files: [payloadFile("a.test.js")] });
    const mapError = writer(commonDir());
    mapError.writer.collected({ runId: "run-1", files: [payloadFile("b.test.js", "{not json")] });
    const newer = commonDir();
    open(newer).close();
    const db = new DatabaseSync(codeStorePath(newer));
    db.exec("PRAGMA user_version = 99");
    db.close();
    const notOpen = writer(newer);
    notOpen.writer.collected({ runId: "run-1", files: [payloadFile("c.test.js")] });

    for (const { writer: made } of [noResult, mapError, notOpen]) {
      await made.idle();
      await made.close();
    }

    expect(noResult.writer.dropped()).toEqual({ "no-result": 1 });
    expect(mapError.writer.dropped()).toEqual({ "map-error": 1 });
    expect(notOpen.writer.dropped()).toEqual({ "store-open": 1 });
    expect(noResult.seen.notes.map((n) => n.text)).toEqual([
      expect.stringContaining(": 1 no-result ("),
    ]);
    expect(mapError.seen.notes.map((n) => n.text)).toEqual([
      expect.stringMatching(/: 1 map-error \(.+\); the last: b\.test\.js: SyntaxError: /),
    ]);
    expect(notOpen.seen.notes.map((n) => n.text)).toEqual([
      expect.stringMatching(/: 1 store-open \(.+\); the last: c\.test\.js: .*newer-schema/),
    ]);
    for (const { seen } of [noResult, mapError, notOpen]) expect(seen.stored).toBe(0);
  });

  it("notes the first drop and each doubling, then the rest at close, under one topic", async () => {
    const files = Array.from({ length: 5 }, (_, i) => payloadFile(`t${i}.test.js`));
    const { writer: made, seen } = writer(commonDir(), { resultKey: () => undefined });

    made.collected({ runId: "run-1", files });
    await made.idle();
    expect(seen.notes.map((n) => n.text.match(/^coverage: (\d+) /)?.[1])).toEqual(["1", "2", "4"]);
    await made.close();
    await made.close();

    expect(seen.notes.map((n) => n.text.match(/^coverage: (\d+) /)?.[1])).toEqual([
      "1",
      "2",
      "4",
      "5",
    ]);
    expect(new Set(seen.notes.map((n) => n.topic))).toEqual(new Set([DROPPED_TOPIC]));
    expect(made.dropped()).toEqual({ "no-result": 5 });
  });

  it("settles idle at close while records wait for the store, with no timer left and nothing stored later", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    const dir = commonDir();
    const store = open(dir);
    const release = await holdLock(dir);
    const { writer: made, seen } = writer(dir);

    made.collected({ runId: "run-1", files: [payloadFile("a.test.js"), payloadFile("b.test.js")] });
    // Past the first try's slice: a.test.js waits for its retry, b.test.js with it.
    await vi.advanceTimersByTimeAsync(4 * BUSY_SLICE_MS);
    expect(made.busy()).toBe(true);
    const idle = made.idle();
    await made.close();
    await idle;
    expect(vi.getTimerCount()).toBe(0);
    expect(made.busy()).toBe(false);
    await release();
    await vi.advanceTimersByTimeAsync(4 * BUSY_SLICE_MS);

    expect(store.coverage.has(at("key-a.test.js"))).toBe(false);
    expect(store.coverage.has(at("key-b.test.js"))).toBe(false);
    expect(seen.stored).toBe(0);
    expect(made.dropped()).toEqual({ closed: 2 });
    expect(seen.notes.map((n) => n.text)).toEqual([
      expect.stringMatching(/^coverage: 2 completed test files got no record .*: 2 closed \(/),
    ]);
  }, 30_000);
});
