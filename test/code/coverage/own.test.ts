import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transformSync } from "esbuild";
import { afterEach, describe, expect, it } from "vitest";
import {
  COVERAGE_PROVIDER_VERSION,
  type CoverageRecord,
  createCoverageWriter,
  decodeRecord,
  hasLine,
  type V8Payload,
  type V8Script,
} from "../../../src/core/code/coverage/index.js";
import { ownRecord } from "../../../src/core/code/coverage/own.js";
import { blobHash } from "../../../src/core/hash/index.js";
import { commonDir, ON, open } from "../helpers.js";
import { TS_WORKER } from "./payloads.js";

/*
 * Row 015-86 (spec 015 D8): a node:test file's record, from the
 * `NODE_V8_COVERAGE` file of its own process. Under a loader the payload's
 * `source-map-cache` carries the executed code's line lengths and the map,
 * which holds the source the loader read; without one V8 ran the file.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const SHAPES = [
  "export function area(w: number, h: number): number {",
  "  if (w < 0) {",
  "    return 0;",
  "  }",
  "  return w * h;",
  "}",
  "",
  "export function neverCalled(): string {",
  '  return "no";',
  "}",
  "",
].join("\n");

function root(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "sq-own-")));
  dirs.push(dir);
  return dir;
}

const range = (startOffset: number, endOffset: number, count: number) => ({
  startOffset,
  endOffset,
  count,
});

/** `shapes.ts` as tsx runs it: esbuild's code and map, V8's counts over the code. */
function underLoader(dir: string, area: number, branch: number) {
  const path = join(dir, "src", "shapes.ts");
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(path, SHAPES);
  const url = pathToFileURL(path).href;
  const out = transformSync(SHAPES, { loader: "ts", format: "esm", sourcemap: "external" });
  const map = JSON.parse(out.map) as { mappings: string };
  const code = out.code;
  const at = (text: string, from = 0) => code.indexOf(text, from);
  const areaStart = at("function area");
  const areaEnd = at("\n}", areaStart) + 2;
  const neverStart = at("function neverCalled");
  const neverEnd = at("\n}", neverStart) + 2;
  const script: V8Script = {
    url,
    functions: [
      { functionName: "", ranges: [range(0, code.length, 1)], isBlockCoverage: true },
      {
        functionName: "area",
        ranges: [
          range(areaStart, areaEnd, area),
          range(at("{", at("if")), at("}", at("if")) + 1, branch),
        ],
        isBlockCoverage: true,
      },
      {
        functionName: "neverCalled",
        ranges: [range(neverStart, neverEnd, 0)],
        isBlockCoverage: true,
      },
    ],
  };
  const lineLengths = code.split("\n").map((line) => line.length);
  const data = { ...map, sources: [url], sourcesContent: [SHAPES] };
  return { path, url, script, cache: { [url]: { lineLengths, data } } };
}

const linesOf = (bits: string) =>
  Array.from({ length: 12 }, (_, l) => l)
    .filter((l) => hasLine(bits, l))
    .map((l) => l + 1);
const only = (record: CoverageRecord) => {
  expect(record.sources).toHaveLength(1);
  return record.sources[0] as CoverageRecord["sources"][number];
};

describe("ownRecord (row 015-86)", () => {
  it("maps a script under a loader through its cached map, a function never called not hit", () => {
    const dir = root();
    const { script, cache } = underLoader(dir, 1, 0);
    const source = only(ownRecord(dir, { result: [script], "source-map-cache": cache }, "sha1"));
    expect(source.path).toBe("src/shapes.ts");
    expect(source.functions.map((f) => [f[0], f[4]])).toEqual([
      [1, 1],
      [8, 0],
    ]);
    // The closing-punctuation rule reads the source: lines 4, 6 and 10 hold only `}`. A
    // declaration's line reads by its own function's count, as under Vitest.
    expect(linesOf(source.lines)).toEqual([1, 2, 3, 5, 8, 9]);
    expect(linesOf(source.covered)).toEqual([1, 2, 5]);
  });

  it("takes the blob of the text the loader read, not of the file as it is now", () => {
    const dir = root();
    const { path, script, cache } = underLoader(dir, 1, 1);
    writeFileSync(path, "export const edited = 1;\n");
    const source = only(ownRecord(dir, { result: [script], "source-map-cache": cache }, "sha1"));
    expect(source.blob).toBe(blobHash(Buffer.from(SHAPES), "sha1"));
    expect(linesOf(source.covered)).toEqual([1, 2, 3, 5]);
  });

  it("reads a script unread when its own map lacks the text the loader read", () => {
    const dir = root();
    const { url, script, cache } = underLoader(dir, 1, 1);
    // Review 0.1.358 B1: tsx leaves the text out while it sees no NODE_V8_COVERAGE.
    const entry = cache[url];
    const bare = { [url]: { ...entry, data: { ...entry?.data, sourcesContent: [null] } } };
    const payload = { result: [script], "source-map-cache": bare } as V8Payload;
    expect(ownRecord(dir, payload, "sha1")).toEqual({
      v: 1,
      sources: [],
      unread: ["src/shapes.ts"],
    });
  });

  it("reads a script without a map of its own from the file, as V8 ran it", () => {
    const dir = root();
    const text = "export function plain(x) {\n  return x + 1;\n}\n";
    const path = join(dir, "plain.mjs");
    writeFileSync(path, text);
    const url = pathToFileURL(path).href;
    const script: V8Script = {
      url,
      functions: [
        { functionName: "", ranges: [range(0, text.length, 1)], isBlockCoverage: true },
        { functionName: "plain", ranges: [range(0, text.length - 1, 1)], isBlockCoverage: true },
      ],
    };
    // A map whose source is another file (a compiled file's own map) is not the script's.
    const other = { lineLengths: [1], data: { mappings: "AAAA", sources: ["file:///x.ts"] } };
    const payload: V8Payload = { result: [script], "source-map-cache": { [url]: other } };
    const source = only(ownRecord(dir, payload, "sha1"));
    expect(source.blob).toBe(blobHash(Buffer.from(text), "sha1"));
    expect(linesOf(source.lines)).toEqual([1, 2]);
    // The module's own function, then `plain`.
    expect(source.functions).toEqual([
      [1, 0, 3, 0, 1],
      [1, 0, 3, 1, 1],
    ]);
  });

  it("leaves out scripts outside the root, under node_modules and of Node, and names a gone file unread", () => {
    const dir = root();
    const script = (url: string): V8Script => ({
      url,
      functions: [{ functionName: "", ranges: [range(0, 1, 1)], isBlockCoverage: true }],
    });
    const nested = join(dir, "node_modules", "dep", "index.js");
    mkdirSync(join(dir, "node_modules", "dep"), { recursive: true });
    writeFileSync(nested, "x");
    const payload: V8Payload = {
      result: [
        script("node:internal/main/test_runner"),
        script(pathToFileURL(join(tmpdir(), "elsewhere.js")).href),
        script(pathToFileURL(nested).href),
        script(pathToFileURL(join(dir, "gone.js")).href),
      ],
    };
    expect(ownRecord(dir, payload, "sha1")).toEqual({ v: 1, sources: [], unread: ["gone.js"] });
  });

  it("stores the same record through the worker thread as on the main thread", async () => {
    const dir = root();
    const { script, cache } = underLoader(dir, 1, 0);
    const payload: V8Payload = { result: [script], "source-map-cache": cache };
    const expected = ownRecord(dir, payload, "sha1");
    for (const worker of [TS_WORKER, null]) {
      const file = join(dir, `payload-${worker === null ? "main" : "worker"}.json`);
      writeFileSync(file, JSON.stringify(payload));
      const store = commonDir();
      const writer = createCoverageWriter({
        commonDir: store,
        format: "sha1",
        policy: () => ON,
        resultKey: () => "key",
        log: () => {},
        worker,
      });
      writer.collected({
        runId: "run",
        files: [
          {
            testFile: { project: "unit", path: "test/shapes.test.ts" },
            payload: file,
            sources: new Map(),
            ownRoot: dir,
          },
        ],
      });
      await writer.idle();
      await writer.close();
      const bytes = open(store).coverage.get({
        resultKey: "key",
        providerVersion: COVERAGE_PROVIDER_VERSION,
      });
      expect(bytes === null ? null : decodeRecord(bytes)).toEqual(expected);
    }
  });
});
