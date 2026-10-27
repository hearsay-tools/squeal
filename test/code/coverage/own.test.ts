import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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
import { range, SHAPES, underLoader } from "./own-fixture.js";
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

function root(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "sq-own-")));
  dirs.push(dir);
  return dir;
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
    const payload: V8Payload = { result: [script] };
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

  it.each([
    "parsed",
    "inline",
    "unread",
    "parsed-excess-lines",
    "inline-excess-lines",
    "parsed-trailing",
    "inline-trailing",
  ])("stores a %s map through the actual worker and main thread", async (kind) => {
    const dir = root();
    const { path, url, script, cache } = underLoader(dir, 1, 0);
    const entry = cache[url];
    if (entry === undefined) throw new Error("no cached map");
    const excess = kind.endsWith("excess-lines");
    if (kind.endsWith("trailing")) {
      entry.data.mappings = "AAAA;";
      entry.lineLengths = [1, 0];
    }
    if (excess) entry.data.mappings = `AAAA${";".repeat(250_001)}`;
    const expected =
      kind === "unread" || excess
        ? { v: 1, sources: [], unread: ["src/shapes.ts"] }
        : ownRecord(dir, { result: [script], "source-map-cache": cache }, "sha1");
    if (kind.endsWith("trailing")) expect(expected.sources).toHaveLength(1);
    const lazy = {
      ...entry,
      data: null,
      url:
        kind === "unread"
          ? "data:application/json;base64,ew=="
          : `data:application/json;base64,${Buffer.from(JSON.stringify(entry.data)).toString("base64")}`,
    };
    const payload: V8Payload = {
      result: [script],
      "source-map-cache": kind.startsWith("parsed") ? cache : { [url]: lazy },
    };
    writeFileSync(path, "export const nowEdited = 1;\n");
    for (const worker of [TS_WORKER, null]) {
      const file = join(dir, `payload-${worker === null ? "main" : "worker"}.json`);
      writeFileSync(file, JSON.stringify(payload));
      const store = commonDir();
      const logs: string[] = [];
      const writer = createCoverageWriter({
        commonDir: store,
        format: "sha1",
        policy: () => ON,
        resultKey: () => "key",
        log: (message) => logs.push(message),
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
      // Worker failure would otherwise fall back to the main thread and hide a broken worker.
      expect(logs).toEqual([]);
      expect(open(store).coverage.get({ resultKey: "key", providerVersion: 2 })).toBeNull();
    }
  });
});
