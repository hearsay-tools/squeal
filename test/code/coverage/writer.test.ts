import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  COVERAGE_PROVIDER_VERSION,
  type CoveredFile,
  createCoverageWriter,
  decodeRecord,
  type ResultKeyOf,
} from "../../../src/core/code/coverage/index.js";
import { codeStorePath } from "../../../src/core/code/store/index.js";
import { commonDir, ON, open } from "../helpers.js";

/*
 * Spec 015 D8 (row 015-11): a record is mapped after its run and stored at
 * the key its result was stored under, never before the result is.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function payloadFile(): CoveredFile {
  const dir = mkdtempSync(join(tmpdir(), "sq-writer-"));
  dirs.push(dir);
  const text = "f();\n";
  const path = join(dir, "a.js");
  writeFileSync(path, text);
  const payload = join(dir, "payload.json");
  const ranges = [{ startOffset: 0, endOffset: text.length, count: 1 }];
  const script = { url: `file://${path}`, functions: [{ functionName: "", ranges }] };
  writeFileSync(payload, JSON.stringify({ result: [script] }));
  const sha1 = createHash("sha1").update(text).digest("hex");
  return {
    testFile: { project: "", path: "a.test.js" },
    payload,
    sources: new Map([[path, { path: "a.js", code: text, map: null, sha1 }]]),
  };
}

describe("coverage records' writer", () => {
  it("stores a record at its result's key once the result is stored, and deletes the payload", async () => {
    const dir = commonDir();
    const file = payloadFile();
    const asked: string[] = [];
    let stored = false;
    const resultKey: ResultKeyOf = (runId, testFile) => {
      asked.push(`${runId} ${testFile.path}`);
      return stored ? "key-1" : undefined;
    };
    const writer = createCoverageWriter({
      commonDir: dir,
      format: "sha1",
      policy: () => ON,
      resultKey,
      log: () => {},
      waitsMs: [0, 30, 30],
    });

    writer.collected({ runId: "run-1", files: [file] });
    await new Promise((resolve) => setTimeout(resolve, 10));
    stored = true;
    await writer.idle();
    await writer.close();

    expect(asked).toEqual(["run-1 a.test.js", "run-1 a.test.js"]);
    expect(existsSync(file.payload)).toBe(false);
    const record = open(dir).coverage.get({
      resultKey: "key-1",
      providerVersion: COVERAGE_PROVIDER_VERSION,
    });
    expect(record === null ? null : decodeRecord(record).sources.map((s) => s.path)).toEqual([
      "a.js",
    ]);
  });

  it("drops a record whose result is never stored, and opens no code store for it", async () => {
    const dir = commonDir();
    const logged: string[] = [];
    const writer = createCoverageWriter({
      commonDir: dir,
      format: "sha1",
      policy: () => ON,
      resultKey: () => undefined,
      log: (text) => logged.push(text),
      waitsMs: [0, 5],
    });

    writer.collected({ runId: "run-1", files: [payloadFile()] });
    await writer.idle();
    await writer.close();

    expect(logged).toEqual(["coverage: no result of run run-1 for a.test.js"]);
    expect(existsSync(codeStorePath(dir))).toBe(false);
  });
});
