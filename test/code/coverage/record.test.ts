import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildRecord,
  type CoveredFile,
  decodeRecord,
  encodeRecord,
  hasLine,
  type V8Script,
} from "../../../src/core/code/coverage/index.js";
import { Counts } from "../../../src/core/code/coverage/ranges.js";
import { decodeMappings } from "../../../src/core/code/coverage/sourcemap.js";
import { blobHash } from "../../../src/core/hash/index.js";

/* Spec 015 D8 (row 015-11): mapping a V8 payload to a test file's record. */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const sha1 = (text: string) => createHash("sha1").update(text).digest("hex");
const range = (startOffset: number, endOffset: number, count: number) => ({
  startOffset,
  endOffset,
  count,
});

/** A source run as is (no transform, no map), with V8's functions over it. */
function covered(text: string, functions: V8Script["functions"], wrapper = 0) {
  const dir = mkdtempSync(join(tmpdir(), "sq-record-"));
  dirs.push(dir);
  const path = join(dir, "a.js");
  writeFileSync(path, text);
  const file: CoveredFile = {
    testFile: { project: "", path: "a.test.js" },
    payload: join(dir, "payload.json"),
    sources: new Map([[path, { path: "a.js", code: text, map: null, sha1: sha1(text) }]]),
  };
  const script: V8Script = { url: `file://${path}`, functions, startOffset: wrapper };
  return { path, file, script };
}

const linesOf = (bits: string) =>
  [0, 1, 2, 3, 4, 5].filter((l) => hasLine(bits, l)).map((l) => l + 1);

describe("coverage mapping", () => {
  it("decodes source map v3 segments by generated line", () => {
    // Line 0: column 0 -> source line 0; line 1 empty; line 2: columns 2 and 4 -> source line 1.
    expect(decodeMappings("AAAA;;EACA,EAAE")).toEqual([
      [[0, 0, 0, 0]],
      [],
      [
        [2, 0, 1, 0],
        [4, 0, 1, 2],
      ],
    ]);
  });

  it("gives each offset the count of the innermost range that holds it", () => {
    const counts = new Counts(
      [
        { functionName: "", isBlockCoverage: true, ranges: [range(0, 100, 1), range(10, 20, 0)] },
        { functionName: "f", isBlockCoverage: true, ranges: [range(30, 60, 2), range(40, 50, 0)] },
      ],
      0,
    );
    expect([0, 10, 19, 20, 30, 45, 55, 99, 100].map((o) => counts.at(o))).toEqual([
      1,
      0,
      0,
      1,
      2,
      0,
      2,
      1,
      null,
    ]);
  });

  it("maps lines that ran, lines that did not, and each function, past the evaluator's wrapper", () => {
    const text = "function f(x) {\n  if (x) return 1;\n  return 2;\n}\nf(true);\n";
    const wrapper = "(async()=>{".length;
    const at = (needle: string) => text.indexOf(needle) + wrapper;
    const { file, script } = covered(
      text,
      [
        { functionName: "", isBlockCoverage: true, ranges: [range(0, text.length + wrapper, 1)] },
        {
          functionName: "f",
          isBlockCoverage: true,
          ranges: [range(at("function"), at("}\nf") + 1, 1), range(at("return 2"), at("}\nf"), 0)],
        },
      ],
      wrapper,
    );

    const record = buildRecord(file, [script], "sha1", new Map());

    const [source] = record.sources;
    expect(source?.blob).toBe(blobHash(Buffer.from(text), "sha1"));
    // Line 4 is a closing brace: no statement starts there.
    expect(linesOf(source?.lines ?? "")).toEqual([1, 2, 3, 5]);
    expect(linesOf(source?.covered ?? "")).toEqual([1, 2, 5]);
    expect(source?.functions).toEqual([[1, 0, 4, 0, 1]]);
    expect(decodeRecord(encodeRecord(record))).toEqual(record);
  });

  it("names a source whose bytes moved since the run as unread, with no entry", () => {
    const { path, file, script } = covered("f();\n", [
      { functionName: "", isBlockCoverage: true, ranges: [range(0, 5, 1)] },
    ]);
    writeFileSync(path, "g();\n");

    const record = buildRecord(file, [script], "sha1", new Map());

    expect(record).toEqual({ v: 1, sources: [], unread: ["a.js"] });
  });

  it("takes the bytes from the map's sources when the file moved since the run", () => {
    const { path, file, script } = covered("f();\n", [
      { functionName: "", isBlockCoverage: true, ranges: [range(0, 5, 1)] },
    ]);
    writeFileSync(path, "g();\n");
    const executed = file.sources.get(path);
    if (executed === undefined) throw new Error("no source");
    const withContent: CoveredFile = {
      ...file,
      sources: new Map([[path, { ...executed, map: { sourcesContent: ["f();\n"] } }]]),
    };

    const record = buildRecord(withContent, [script], "sha1", new Map());

    expect(record.sources.map((s) => [s.path, s.blob])).toEqual([
      ["a.js", blobHash(Buffer.from("f();\n"), "sha1")],
    ]);
  });
});
