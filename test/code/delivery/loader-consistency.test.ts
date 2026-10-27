import { describe, expect, it } from "vitest";
import { functionKey, readEvidence, writeEvidence } from "../../../src/core/code/crap/index.js";
import type { CodeMetaRepo, CodeStore } from "../../../src/core/code/store/types.js";
import { evidenceOf } from "../../../src/core/delivery/code-coverage.js";
import { codeLines } from "../../../src/core/delivery/code-format.js";
import { type LoaderCount, withUntested } from "../../../src/core/delivery/code-untested.js";
import type { CodeMeasure } from "../../../src/core/types/code.js";
import type {
  CodeCoverageEvidence,
  CodeDeltaEntry,
  CodeNews,
} from "../../../src/core/types/code-delivery.js";
import { WT } from "../../state/helpers.js";
import { type CoverageRig, consumer, coverageRig, sourceOf } from "../crap/rig.js";

/*
 * Row 015-81 (spec 015 D9 Delivery, amended 2026-10-27; `lessons.md`
 * Round 2 C4): one delivery reads one set of loader facts per source file,
 * and every line of that file that says why no test runs a function states
 * them, a function with no stored evidence too. A function's own hits and
 * CRAP stay its own.
 */

const S1 = consumer("s1");
const LIMIT = "Squeal does not measure worker threads or child processes.";
const PROCESS =
  "They may run it in a worker thread or a process they start, which Squeal does not measure.";
const EXCLUDE = "To stop checking such files, add them to coverage.exclude in squeal.config.json.";

const blobOf = (rig: CoverageRig, path: string) => rig.store.files.list(WT, [path])[0]?.blob ?? "";
const code = (lines: readonly string[]) =>
  lines.filter((l) => /^(- )?(FAIL|PASS|RESOLVED|STILL FAIL) |^\w+ \(src\/[^)]*\):$/.test(l));

/** `src/a.ts` run by `test/a.test.ts`, judged, and a session registered after. */
async function judged(): Promise<CoverageRig> {
  const rig = coverageRig();
  await rig.edit({ "src/a.ts": "hot 12 h1\n" });
  rig.loader("test/a.test.ts", {
    closure: ["src/a.ts"],
    record: [sourceOf("src/a.ts", blobOf(rig, "src/a.ts"), 1, [1])],
  });
  rig.step();
  await rig.register(S1);
  return rig;
}

/** Writes each file, then each of its loaders' records, which show `ran` of its functions. */
async function added(
  rig: CoverageRig,
  files: Record<string, { text: string; loaders: readonly string[]; ran: readonly number[] }>,
) {
  await rig.edit(Object.fromEntries(Object.entries(files).map(([p, f]) => [p, f.text])));
  for (const [path, { text, loaders, ran }] of Object.entries(files)) {
    const functions = text.trim().split("\n").length;
    for (const loader of loaders) {
      rig.loader(loader, {
        closure: [path],
        record: [sourceOf(path, blobOf(rig, path), functions, ran)],
      });
    }
  }
  rig.step();
}

/** The judged evidence of `path` without `name`'s: as when its join found nothing. */
function dropEvidence(rig: CoverageRig, path: string, name: string) {
  const evidence = readEvidence(rig.store.meta, WT, path);
  if (evidence === null) throw new Error(`no evidence for ${path}`);
  const gone = functionKey({ qualifiedName: name, occurrence: 0 });
  const functions = Object.fromEntries(
    Object.entries(evidence.functions).filter(([key]) => key !== gone),
  );
  writeEvidence(rig.store.meta, WT, path, { ...evidence, functions });
}

describe("one file's lines in one delivery (row 015-81)", () => {
  it("says no test file loads the file on each of its lines, the one with no evidence too", async () => {
    // cezar cd4cfd98: `readOwner` and `createTestSandbox`, one file, one delivery.
    const rig = await judged();
    await added(rig, { "src/b.ts": { text: "lone 2 l1\nbare 3 b1\n", loaders: [], ran: [] } });
    dropEvidence(rig, "src/b.ts", "bare");
    expect(code(await rig.told(S1))).toEqual([
      `FAIL untested: bare (src/b.ts:2): no test file loads this file. ${LIMIT}`,
      `FAIL untested: lone (src/b.ts:1): no test file loads this file (complexity 2, CRAP 6). ${LIMIT}`,
    ]);
  });

  it("gives a loaded file's count and process sentence to each of its lines, coverage.exclude once", async () => {
    const rig = await judged();
    const loaders = ["test/c.test.ts", "test/d.test.ts"];
    await added(rig, { "src/c.ts": { text: "one 2 o1\ntwo 3 t1\n", loaders, ran: [] } });
    dropEvidence(rig, "src/c.ts", "two");
    expect(code(await rig.told(S1))).toEqual([
      `FAIL untested: one (src/c.ts:1): no test runs it in the test's own thread; 2 test files load this file (complexity 2, CRAP 6). ${PROCESS} ${EXCLUDE}`,
      `FAIL untested: two (src/c.ts:2): no test runs it in the test's own thread; 2 test files load this file. ${PROCESS}`,
    ]);
  });

  it("keeps each file's facts its own", async () => {
    const rig = await judged();
    await added(rig, {
      "src/c.ts": { text: "one 2 o1\ntwo 3 t1\n", loaders: ["test/c.test.ts"], ran: [] },
      "src/d.ts": { text: "ran 2 r1\nidle 2 i1\n", loaders: ["test/d.test.ts"], ran: [1] },
      "src/e.ts": { text: "lone 2 l1\n", loaders: [], ran: [] },
    });
    dropEvidence(rig, "src/c.ts", "one");
    expect(code(await rig.told(S1))).toEqual([
      `FAIL untested: one (src/c.ts:1): no test runs it in the test's own thread; 1 test file loads this file. The test file may run it in a worker thread or a process it starts, which Squeal does not measure. ${EXCLUDE}`,
      "FAIL untested: two (src/c.ts:2): no test runs it in the test's own thread; 1 test file loads this file (complexity 3, CRAP 12). The test file may run it in a worker thread or a process it starts, which Squeal does not measure.",
      `FAIL untested: idle (src/d.ts:2): no test runs it in the test's own thread; 1 test file loads this file (complexity 2, CRAP 6). ${LIMIT}`,
      `FAIL untested: lone (src/e.ts:1): no test file loads this file (complexity 2, CRAP 6). ${LIMIT}`,
    ]);
  });
});

const check = (path: string, qualifiedName: string) =>
  ({ kind: "code", path, qualifiedName, occurrence: 0 }) as const;
const told = (
  measure: CodeMeasure,
  path: string,
  name: string,
  line: number,
  value: number | null,
  evidence?: CodeCoverageEvidence,
): CodeDeltaEntry => ({
  check: check(path, name),
  measure,
  kind: "first-seen-fail",
  value,
  threshold: measure === "crap" ? 30 : null,
  line,
  revision: 3,
  ...(evidence === undefined ? {} : { evidence }),
});
const news = (entries: CodeDeltaEntry[]): CodeNews => ({ v: 1, entries, more: 0 });
const none = (complexity: number): CodeCoverageEvidence => ({
  complexity,
  lines: 4,
  covered: 0,
  testFiles: 0,
  first: [],
});

/** `store` with each meta key read recorded. */
function readsOf(store: CodeStore): { store: CodeStore; reads: string[] } {
  const reads: string[] = [];
  const meta: CodeMetaRepo = {
    get: (key) => {
      reads.push(key);
      return store.meta.get(key);
    },
    set: (key, value) => store.meta.set(key, value),
    delete: (key) => store.meta.delete(key),
  };
  const wrapped = new Proxy(store, {
    get: (target, prop) => (prop === "meta" ? meta : Reflect.get(target, prop)),
  });
  return { store: wrapped, reads };
}

/** A loader reader with `counts` per path, each path it is asked about recorded. */
function countsOf(counts: Record<string, number>): { loaders: LoaderCount; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    loaders: () => (path) => {
      asked.push(path);
      return counts[path] ?? 0;
    },
  };
}

describe("the facts one delivery reads (row 015-81)", () => {
  it("reads each file's loaders and evidence once, however many of its functions are listed", async () => {
    const rig = await judged();
    await added(rig, {
      "src/c.ts": { text: "one 2 o1\ntwo 3 t1\n", loaders: ["test/c.test.ts"], ran: [] },
      "src/d.ts": { text: "ran 2 r1\nidle 2 i1\n", loaders: ["test/d.test.ts"], ran: [1] },
    });
    const entry = (path: string, name: string, line: number) => {
      const e = told("uncovered", path, name, line, null);
      return { ...e, ...evidenceOf(rig.store, WT, e) };
    };
    const { store, reads } = readsOf(rig.store);
    const { loaders, asked } = countsOf({ "src/c.ts": 2, "src/d.ts": 1 });
    const out = withUntested(
      store,
      S1,
      news([
        entry("src/c.ts", "one", 1),
        entry("src/d.ts", "idle", 2),
        entry("src/c.ts", "two", 2),
      ]),
      loaders,
    );
    expect(asked).toEqual(["src/c.ts", "src/d.ts"]);
    expect(reads.filter((key) => key.startsWith(`coverage:${WT}:`))).toEqual([
      `coverage:${WT}:src/c.ts`,
      `coverage:${WT}:src/d.ts`,
    ]);
    const [one, idle, two] = out?.entries ?? [];
    expect(one?.fileLoaders).toEqual({ count: 2, processes: true });
    expect(two?.fileLoaders).toBe(one?.fileLoaders);
    expect(idle?.fileLoaders).toEqual({ count: 1 });
    // Each function keeps its own evidence: its complexity and its CRAP.
    expect([one?.evidence?.complexity, two?.evidence?.complexity]).toEqual([2, 3]);
    expect([one?.evidence?.crap, two?.evidence?.crap]).toEqual([6, 12]);
  });

  it("gives a FAIL or STILL FAIL CRAP line no test ran the file's facts, and keeps its own score", () => {
    // 605ca21e: `startCoverage` had no count beside its file's `filesDirectory`.
    const { loaders } = countsOf({ "src/p.mjs": 2, "src/q.ts": 0 });
    const store = coverageRig().store;
    const out = withUntested(
      store,
      S1,
      news([
        told("crap", "src/p.mjs", "startCoverage", 63, 56, none(7)),
        told("uncovered", "src/p.mjs", "filesDirectory", 40, null, none(3)),
        { ...told("crap", "src/q.ts", "cold", 1, 42, none(6)), kind: "edited-after-fail" },
      ]),
      loaders,
    );
    expect(codeLines(out ?? news([]), "squeal")).toEqual([
      `FAIL CRAP: startCoverage (src/p.mjs:63): 56, over 30 (complexity 7; no test runs it in the test's own thread; 2 test files load this file). ${LIMIT}`,
      `FAIL untested: filesDirectory (src/p.mjs:40): no test runs it in the test's own thread; 2 test files load this file (complexity 3). ${LIMIT}`,
      `STILL FAIL CRAP: cold (src/q.ts:1): 42 after the edit, over 30 (complexity 6; no test file loads this file). ${LIMIT} Squeal stays quiet about it until it is at or under 30, and squeal code src/q.ts shows its CRAP.`,
    ]);
  });

  it("reads no loaders when no line says why no test runs a function", () => {
    const { loaders, asked } = countsOf({});
    const ran = { ...none(9), covered: 2, testFiles: 1, first: ["test/r.test.ts"] };
    const crap = told("crap", "src/r.ts", "parseRow", 12, 51, ran);
    expect(withUntested(coverageRig().store, S1, news([crap]), loaders)?.entries).toEqual([crap]);
    expect(asked).toEqual([]);
  });
});

describe("the facts a line reads (row 015-81)", () => {
  const lone = told("uncovered", "src/b.ts", "lone", 1, null, none(2));

  it("reads the file's facts before evidence an older Squeal wrote", () => {
    const both = { ...lone, evidence: { ...none(2), loaders: 5 }, fileLoaders: { count: 0 } };
    expect(codeLines(news([both]), "squeal")).toEqual([
      `FAIL untested: lone (src/b.ts:1): no test file loads this file (complexity 2). ${LIMIT}`,
    ]);
  });

  it("reads an older Squeal's evidence when the file's facts are absent", () => {
    const older = { ...lone, evidence: { ...none(2), loaders: 3, processes: true as const } };
    expect(codeLines(news([older]), "squeal")).toEqual([
      `FAIL untested: lone (src/b.ts:1): no test runs it in the test's own thread; 3 test files load this file (complexity 2). ${PROCESS}`,
    ]);
  });

  it("claims no count when neither was read: no line says no test file loads the file", () => {
    const bare = told("uncovered", "src/b.ts", "bare", 2, null);
    expect(codeLines(news([lone, bare]), "squeal")).toEqual([
      `FAIL untested: lone (src/b.ts:1): no test runs it in the test's own thread (complexity 2). ${LIMIT}`,
      `FAIL untested: bare (src/b.ts:2): no test runs it in the test's own thread. ${LIMIT}`,
    ]);
  });
});
