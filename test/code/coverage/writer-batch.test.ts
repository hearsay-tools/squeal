import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { COVERAGE_RECORD_VERSION } from "../../../src/core/code/coverage/record.js";
import type { CoveredFile } from "../../../src/core/code/coverage/types.js";
import {
  BATCH_WINDOW_MS,
  type CoverageWriterOptions,
  createCoverageWriter,
  MAX_BATCH_FILES,
} from "../../../src/core/code/coverage/writer.js";
import { codeStorePath } from "../../../src/core/code/store/open.js";
import { commonDir, ON, open } from "../helpers.js";

/*
 * Spec 024 D3 (row 024-03): the writer stores its records in batches of at
 * most `MAX_BATCH_FILES`, a smaller one once `BATCH_WINDOW_MS` passed, and
 * tells `onStored` once per batch. It is busy while a record waits for its
 * batch, and `close` stores the records batched. One record's error drops
 * that record alone.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function payloadFile(test: string): CoveredFile {
  const dir = mkdtempSync(join(tmpdir(), "sq-writer-batch-"));
  dirs.push(dir);
  const text = `f(${JSON.stringify(test)});\n`;
  const path = join(dir, "a.js");
  writeFileSync(path, text);
  const payload = join(dir, "payload.json");
  const ranges = [{ startOffset: 0, endOffset: text.length, count: 1 }];
  writeFileSync(
    payload,
    JSON.stringify({
      result: [{ url: `file://${path}`, functions: [{ functionName: "", ranges }] }],
    }),
  );
  const sha1 = createHash("sha1").update(text).digest("hex");
  return {
    testFile: { project: "", path: test },
    payload,
    sources: new Map([[path, { path: "a.js", code: text, map: null, sha1 }]]),
  };
}

const at = (resultKey: string) => ({ resultKey, providerVersion: COVERAGE_RECORD_VERSION });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function writer(dir: string, options: Partial<CoverageWriterOptions> = {}) {
  const seen = { stored: 0, logs: [] as string[] };
  const made = createCoverageWriter({
    commonDir: dir,
    format: "sha1",
    policy: () => ON,
    resultKey: (_run, testFile) => `key-${testFile.path}`,
    log: (text) => seen.logs.push(text),
    onStored: () => seen.stored++,
    waitsMs: [0],
    worker: null,
    ...options,
  });
  return { writer: made, seen };
}

describe("the records' writer's batches (row 024-03)", () => {
  it("stores a run's records in batches of at most MAX_BATCH_FILES, told once each", async () => {
    const dir = commonDir();
    const count = 2 * MAX_BATCH_FILES + 3;
    const files = Array.from({ length: count }, (_, i) => payloadFile(`t${i}.test.js`));
    const { writer: made, seen } = writer(dir);
    made.collected({ runId: "r", files });
    await made.idle();
    await made.close();

    expect(seen.stored).toBe(Math.ceil(count / MAX_BATCH_FILES));
    expect(made.dropped()).toEqual({});
    expect(seen.logs).toEqual([]);
    const store = open(dir);
    for (const file of files)
      expect(store.coverage.has(at(`key-${file.testFile.path}`))).toBe(true);
  }, 30_000);

  it("holds a smaller batch for its window, busy meanwhile", async () => {
    const dir = commonDir();
    const { writer: made, seen } = writer(dir);
    const began = performance.now();
    made.collected({ runId: "r", files: [payloadFile("a.test.js"), payloadFile("b.test.js")] });
    await sleep(BATCH_WINDOW_MS / 4);
    expect(made.busy()).toBe(true);
    expect(seen.stored).toBe(0);
    await made.idle();
    expect(performance.now() - began).toBeGreaterThanOrEqual(BATCH_WINDOW_MS - 5);
    expect(made.busy()).toBe(false);
    expect(seen.stored).toBe(1);
    await made.close();
  });

  it("stores the records batched when it closes", async () => {
    const dir = commonDir();
    const { writer: made, seen } = writer(dir);
    made.collected({ runId: "r", files: [payloadFile("a.test.js")] });
    // Mapped and keyed, waiting for its batch's window.
    await sleep(BATCH_WINDOW_MS / 4);
    expect(seen.stored).toBe(0);
    await made.close();

    expect(seen.stored).toBe(1);
    expect(made.dropped()).toEqual({});
    expect(open(dir).coverage.has(at("key-a.test.js"))).toBe(true);
  });

  it("drops only the record the store refused, and tells the rest once", async () => {
    const dir = commonDir();
    open(dir).close();
    const db = new DatabaseSync(codeStorePath(dir));
    db.exec(
      `CREATE TRIGGER refuse BEFORE INSERT ON coverage WHEN NEW.result_key = 'key-b.test.js'
       BEGIN SELECT RAISE(ABORT, 'refused'); END`,
    );
    db.close();
    const { writer: made, seen } = writer(dir);
    const files = ["a.test.js", "b.test.js", "c.test.js"].map((path) => payloadFile(path));
    made.collected({ runId: "r", files });
    await made.idle();
    await made.close();

    expect(seen.stored).toBe(1);
    expect(made.dropped()).toEqual({ "store-error": 1 });
    expect(seen.logs).toEqual([expect.stringMatching(/^coverage: b\.test\.js: .*refused/)]);
    const store = open(dir);
    expect(store.coverage.has(at("key-a.test.js"))).toBe(true);
    expect(store.coverage.has(at("key-b.test.js"))).toBe(false);
    expect(store.coverage.has(at("key-c.test.js"))).toBe(true);
  });
});
