import {
  closeSync,
  existsSync,
  ftruncateSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { CHILD_FILE_LIMIT, mapHere } from "../../../src/core/code/coverage/mapper.js";
import { ownRecord } from "../../../src/core/code/coverage/own.js";
import {
  COVERAGE_RECORD_VERSION,
  decodeRecord,
  hasLine,
  mergeRecords,
} from "../../../src/core/code/coverage/record.js";
import type {
  CoverageRecord,
  CoverageSource,
  CoveredFile,
  V8Payload,
} from "../../../src/core/code/coverage/types.js";
import { createCoverageWriter } from "../../../src/core/code/coverage/writer.js";
import { commonDir, ON, open } from "../helpers.js";
import { range, underLoader } from "./own-fixture.js";
import { TS_WORKER } from "./payloads.js";

/*
 * Spec 020 D12 items 4 (row 020-10a): a test file's record merged with the
 * records of the processes it started, each child file mapped and dropped
 * alone.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function root(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "sq-children-")));
  dirs.push(dir);
  return dir;
}

/** A record bitset of 1-based `lines`. */
function bits(...lines: number[]): string {
  const bytes = new Uint8Array(lines.length === 0 ? 0 : ((Math.max(...lines) - 1) >> 3) + 1);
  for (const line of lines)
    bytes[(line - 1) >> 3] = (bytes[(line - 1) >> 3] ?? 0) | (1 << ((line - 1) & 7));
  return Buffer.from(bytes).toString("base64");
}

const source = (
  path: string,
  blob: string,
  lines: number[],
  covered: number[],
  functions: CoverageSource["functions"],
): CoverageSource => ({ path, blob, lines: bits(...lines), covered: bits(...covered), functions });

const linesOf = (text: string) =>
  Array.from({ length: 16 }, (_, l) => l)
    .filter((l) => hasLine(text, l))
    .map((l) => l + 1);

describe("mergeRecords (020 D12)", () => {
  it("ORs lines, covered lines and each function's hit per path at one blob; two blobs or unread read unread", () => {
    const own: CoverageRecord = {
      v: 1,
      sources: [
        source(
          "src/a.ts",
          "a1",
          [1, 2, 3, 5],
          [1, 2],
          [
            [1, 0, 3, 1, 1],
            [5, 0, 5, 10, 0],
          ],
        ),
        source("src/b.ts", "b1", [1], [1], [[1, 0, 1, 9, 1]]),
        source("src/d.ts", "d1", [1], [1], [[1, 0, 1, 9, 1]]),
        source("src/e.ts", "e1", [1], [1], [[1, 0, 1, 9, 1]]),
      ],
      unread: [],
    };
    const child: CoverageRecord = {
      v: 1,
      sources: [
        source(
          "src/a.ts",
          "a1",
          [1, 2, 3, 5, 12],
          [1, 5, 12],
          [
            [1, 0, 3, 1, 1],
            [5, 0, 5, 10, 1],
          ],
        ),
        source("src/c.ts", "c1", [2], [], [[2, 0, 2, 4, 0]]),
        source("src/d.ts", "d2", [1], [], [[1, 0, 1, 9, 0]]),
      ],
      unread: ["dist/cli.mjs", "src/e.ts"],
    };

    const merged = mergeRecords(own, [child]);

    expect(merged).toEqual({
      v: 1,
      sources: [
        source(
          "src/a.ts",
          "a1",
          [1, 2, 3, 5, 12],
          [1, 2, 5, 12],
          // One function at 5:0-5:10 in each record: it ran in the child, so it ran (020-10b).
          [
            [1, 0, 3, 1, 1],
            [5, 0, 5, 10, 1],
          ],
        ),
        own.sources[1],
        child.sources[1],
      ],
      unread: ["dist/cli.mjs", "src/d.ts", "src/e.ts"],
    });
    // The order of the records does not matter.
    expect(mergeRecords(child, [own])).toEqual(merged);
  });

  it("keeps two functions at one span of one record apart, with every hit seen there (review 0.1.297 B4)", () => {
    // A class's field initializer ran in the test's process; its arrow field ran nowhere.
    const own: CoverageRecord = {
      v: 1,
      sources: [
        source(
          "src/a.ts",
          "a1",
          [2],
          [2],
          [
            [2, 2, 2, 20, 0],
            [2, 2, 2, 20, 1],
          ],
        ),
      ],
      unread: [],
    };
    const child: CoverageRecord = {
      v: 1,
      sources: [source("src/a.ts", "a1", [2], [], [[2, 2, 2, 20, 0]])],
      unread: [],
    };

    const merged = mergeRecords(own, [child]);

    expect(merged.sources[0]?.functions).toEqual([
      [2, 2, 2, 20, 0],
      [2, 2, 2, 20, 1],
    ]);
    expect(mergeRecords(child, [own])).toEqual(merged);
  });

  it("gives the own record itself when no child wrote one", () => {
    const own: CoverageRecord = {
      v: 1,
      sources: [source("src/b.ts", "b1", [1], [1], [])],
      unread: [],
    };
    expect(mergeRecords(own, [])).toBe(own);
  });
});

/** A node:test file's own payload, and one child that took the other branch of `area`. */
function fixture() {
  const dir = root();
  const own = underLoader(dir, 1, 0);
  const payload = join(dir, "own.json");
  writeFileSync(payload, JSON.stringify({ result: [own.script], "source-map-cache": own.cache }));
  const childDir = join(dir, "children");
  mkdirSync(childDir);
  const taken = underLoader(dir, 1, 1);
  const childPayload: V8Payload = { result: [taken.script], "source-map-cache": taken.cache };
  writeFileSync(join(childDir, "coverage-2-1-0.json"), JSON.stringify(childPayload));
  // A plain child script, run as it is.
  const plain = join(dir, "src", "plain.mjs");
  const text = "export function plain(x) {\n  return x > 1 ? 'big' : 'small';\n}\nplain(3);\n";
  writeFileSync(plain, text);
  const plainPayload: V8Payload = {
    result: [
      {
        url: pathToFileURL(plain).href,
        functions: [
          { functionName: "", ranges: [range(0, text.length, 1)], isBlockCoverage: true },
          {
            functionName: "plain",
            ranges: [range(0, text.indexOf("\n}") + 2, 1)],
            isBlockCoverage: true,
          },
        ],
      },
    ],
  };
  writeFileSync(join(childDir, "coverage-3-1-0.json"), JSON.stringify(plainPayload));
  const file: CoveredFile = {
    testFile: { project: "unit", path: "test/shapes.test.ts" },
    payload,
    sources: new Map(),
    ownRoot: dir,
    children: { root: dir, dir: childDir },
  };
  const expected = mergeRecords(
    ownRecord(dir, { result: [own.script], "source-map-cache": own.cache }, "sha1"),
    [ownRecord(dir, childPayload, "sha1"), ownRecord(dir, plainPayload, "sha1")],
  );
  return { dir, childDir, file, expected };
}

/** A copy of a child file cut in half, and a file over the limit with no bytes on disk. */
function addBroken(childDir: string): void {
  writeFileSync(join(childDir, "coverage-4-1-0.json"), '{"result":[{"url":"file:///x.js","fun');
  const fd = openSync(join(childDir, "coverage-5-1-0.json"), "w");
  ftruncateSync(fd, CHILD_FILE_LIMIT + 1);
  closeSync(fd);
}

describe("mapping a test file with its children (020 D12)", () => {
  it("merges each child file's record into the own record, and removes the payload and the directory", () => {
    const { file, childDir, expected } = fixture();
    const dropped: string[] = [];

    const record = decodeRecord(
      mapHere(
        file,
        "sha1",
        new Map(),
        () => false,
        (why) => dropped.push(why),
      ),
    );

    expect(record).toEqual(expected);
    const shapes = record.sources.find((s) => s.path === "src/shapes.ts");
    // The own process returned at the `if`; the child took its branch.
    expect(linesOf(shapes?.covered ?? "")).toEqual([1, 2, 3, 5]);
    expect(record.sources.map((s) => s.path)).toEqual(["src/plain.mjs", "src/shapes.ts"]);
    expect(dropped).toEqual([]);
    expect(existsSync(file.payload)).toBe(false);
    expect(existsSync(childDir)).toBe(false);
  });

  it("drops a cut child file alone, and one over 64 MiB unread, each with its reason", () => {
    const { file, childDir, expected } = fixture();
    addBroken(childDir);
    const dropped: string[] = [];

    const record = decodeRecord(
      mapHere(
        file,
        "sha1",
        new Map(),
        () => false,
        (why) => dropped.push(why),
      ),
    );

    expect(record).toEqual(expected);
    expect(dropped).toEqual([
      expect.stringMatching(/^coverage-4-1-0\.json: SyntaxError: /),
      `coverage-5-1-0.json: over 64 MiB (${CHILD_FILE_LIMIT + 1} bytes)`,
    ]);
    expect(existsSync(childDir)).toBe(false);
  });

  it("keeps the record unchanged with no children directory", () => {
    const { file, dir, childDir } = fixture();
    rmSync(childDir, { recursive: true });
    const record = decodeRecord(mapHere(file, "sha1", new Map(), () => false));
    const own = underLoader(dir, 1, 0);
    expect(record).toEqual(
      ownRecord(dir, { result: [own.script], "source-map-cache": own.cache }, "sha1"),
    );
  });

  it.each([
    ["worker", TS_WORKER],
    ["main thread", null],
  ] as const)(
    "stores the merged record through the %s, and counts each dropped child under its cause",
    async (_, worker) => {
      const { file, childDir, expected } = fixture();
      addBroken(childDir);
      const store = commonDir();
      const logs: string[] = [];
      const notes: string[] = [];
      const writer = createCoverageWriter({
        commonDir: store,
        format: "sha1",
        policy: () => ON,
        resultKey: () => "key",
        log: (message) => logs.push(message),
        note: (text) => notes.push(text),
        worker,
      });
      writer.collected({ runId: "run", files: [file] });
      await writer.idle();

      const bytes = open(store).coverage.get({
        resultKey: "key",
        providerVersion: COVERAGE_RECORD_VERSION,
      });
      expect(bytes === null ? null : decodeRecord(bytes)).toEqual(expected);
      expect(writer.dropped()).toEqual({ child: 2 });
      const cause =
        "child (a child process's coverage file did not map or was over 64 MiB, so it alone was dropped)";
      expect(notes).toEqual([
        expect.stringMatching(
          /^coverage: 1 coverage file of a child process was dropped since this daemon started: 1 child \(.+\); the last: test\/shapes\.test\.ts: coverage-4-1-0\.json: SyntaxError: /,
        ),
        `coverage: 2 coverage files of child processes were dropped since this daemon started: 2 ${cause}; the last: test/shapes.test.ts: coverage-5-1-0.json: over 64 MiB (67108865 bytes)`,
      ]);
      // Each one logged; a worker failure would fall back to the main thread and hide a broken worker.
      expect(logs).toEqual([
        expect.stringMatching(
          /^coverage: test\/shapes\.test\.ts: a child process's file was dropped: coverage-4-1-0\.json: SyntaxError: /,
        ),
        "coverage: test/shapes.test.ts: a child process's file was dropped: coverage-5-1-0.json: over 64 MiB (67108865 bytes)",
      ]);
      expect(existsSync(file.payload)).toBe(false);
      expect(existsSync(childDir)).toBe(false);
      await writer.close();
    },
  );
});
