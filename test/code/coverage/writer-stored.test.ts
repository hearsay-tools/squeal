import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  COVERAGE_PROVIDER_VERSION,
  type CoveredFile,
  createCoverageWriter,
} from "../../../src/core/code/coverage/index.js";
import { commonDir, ON, open } from "../helpers.js";

/*
 * Row 015-12 (agreed with the coordinator): the writer tells the code pass
 * each record it stores, says while it has work in hand, and a throw from
 * the callback is logged, never the writer's; `has` reads a record's
 * presence and writes nothing.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function payloadFile(test: string): CoveredFile {
  const dir = mkdtempSync(join(tmpdir(), "sq-writer-stored-"));
  dirs.push(dir);
  const text = "f();\n";
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

describe("coverage records' writer, for the coverage step", () => {
  it("calls onStored after each record, is busy until the last, and logs a callback's throw", async () => {
    const dir = commonDir();
    const logs: string[] = [];
    let calls = 0;
    const writer = createCoverageWriter({
      commonDir: dir,
      format: "sha1",
      policy: () => ON,
      resultKey: (_run, testFile) => `key-${testFile.path}`,
      log: (text) => logs.push(text),
      waitsMs: [0],
      onStored: () => {
        calls++;
        if (calls === 1) throw new Error("boom");
      },
    });
    expect(writer.busy()).toBe(false);
    writer.collected({ runId: "r", files: [payloadFile("a.test.js"), payloadFile("b.test.js")] });
    expect(writer.busy()).toBe(true);
    await writer.idle();
    expect(writer.busy()).toBe(false);
    await writer.close();

    expect(calls).toBe(2);
    expect(logs).toEqual(["coverage: after storing a.test.js: Error: boom"]);
    const store = open(dir);
    const key = (resultKey: string) => ({ resultKey, providerVersion: COVERAGE_PROVIDER_VERSION });
    expect(store.coverage.has(key("key-a.test.js"))).toBe(true);
    expect(store.coverage.has(key("key-b.test.js"))).toBe(true);
    expect(store.coverage.has(key("key-c.test.js"))).toBe(false);
    expect(store.coverage.has({ resultKey: "key-a.test.js", providerVersion: 0 })).toBe(false);
  });
});
