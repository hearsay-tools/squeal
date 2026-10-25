import { beforeEach, describe, expect, it } from "vitest";
import { formatCodeReport } from "../../../src/cli/code.js";
import { readCodeReport } from "../../../src/cli/code-report.js";
import {
  COUNT_ATTEMPTS,
  readUncountable,
  writeUncountable,
} from "../../../src/core/code/pass/failed.js";
import type { Counter } from "../../../src/core/code/pass/index.js";
import { createStateSink } from "../../../src/core/state/index.js";
import type { Consumer } from "../../../src/core/types/index.js";
import { check, result, WT } from "../../state/helpers.js";
import { fakeCounter } from "../pass/helpers.js";
import { consumer, type Rig, rig } from "../pass/rig.js";

/*
 * Row 015-49 (issue #96, the human's option (a)): while a file the
 * session's own edit changed is not judged, over `complexity.maxFileBytes`
 * or could not be counted, test news's complexity line names it with the
 * reason, at most 3, the newest edit first, on every such delivery, and
 * `squeal code --told` lists them all from the same read.
 */

const C0 = consumer("s0");
const C1 = consumer("s1");
const LIMIT = 64;
const T = check("a");
/** A file over `LIMIT` bytes: lines the fake counter would count. */
const big = (n: number) => `run 1 B${n}\n`.repeat(12);
/** A file the counter throws on, as on a grammar that does not load. */
const broken = (n: number) => `run 1 B${n}\nBROKEN\n`;
const OVER = "(0 KiB, over the 0 KiB limit)";
const TAIL = "squeal code --told lists them.";

/** `fakeCounter`, throwing on a file with a `BROKEN` line. */
function brokenCounter(): Counter {
  const inner = fakeCounter();
  return {
    version: inner.version,
    count: (text, language) =>
      text.includes("BROKEN")
        ? Promise.reject(new Error("tree-sitter: out of memory"))
        : inner.count(text, language),
  };
}

let r: Rig;
let sink: ReturnType<typeof createStateSink>;
let outcome: "pass" | "fail";

beforeEach(async () => {
  r = rig({ maxFileBytes: LIMIT });
  sink = createStateSink(r.main, { now: () => 1_000 });
  outcome = "pass";
  tests();
  r.tree.write("src/a.ts", "settle 3 B1\n").write("src/old.ts", big(0)).commit();
  revise();
  await r.pass(brokenCounter());
});

/** Stores one revision of the paths written since the last, in the main store too, as the daemon's. */
function revise(): number {
  const n = r.tree.revise();
  while ((r.main.revisions.latest(WT)?.number ?? 0) < n) {
    r.main.revisions.append({
      worktreeId: WT,
      createdAt: n,
      head: null,
      dirty: true,
      trigger: "watch",
      changes: [],
    });
  }
  return n;
}

/** Writes these files, stores one revision of them, and runs the pass, each failed count spent. */
async function edit(files: Record<string, string | null>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    if (text === null) r.tree.remove(path);
    else r.tree.write(path, text);
  }
  revise();
  await r.pass(brokenCounter());
  // Row 015-18: a count fails three times before it reads `could not count`.
  const failed = readUncountable(r.store.meta, WT);
  for (const [path, f] of failed) {
    failed.set(path, { ...f, attempts: COUNT_ATTEMPTS, retryAt: null });
  }
  writeUncountable(r.store.meta, WT, failed);
}

/** A test result that flips, so the next delivery has test news. */
function tests(): void {
  outcome = outcome === "pass" ? "fail" : "pass";
  sink.applyResults(WT, 1, [result(T, outcome)], { checkpointId: null });
}

/** The complexity line of `c`'s next delivery; `undefined` when it has none. */
async function line(c: Consumer): Promise<string | undefined> {
  return (await r.delivered(c)).find((l) => l.startsWith("Complexity: "));
}

/** The line after a test result flips. */
async function testNews(c: Consumer): Promise<string | undefined> {
  tests();
  return line(c);
}

/** `squeal code --told` for `c`'s session: its not-judged files, and its text. */
function told(c: Consumer) {
  const report = readCodeReport(r.main, r.store, WT, r.complexity, {
    paths: null,
    changed: false,
    told: true,
    shell: { session: c.sessionId, agent: null },
  });
  return { files: report.files.map((f) => [f.path, f.reason]), text: formatCodeReport(report) };
}

describe("the complexity line names the changed files not judged (row 015-49)", () => {
  it("names a file over the limit the session edited, with no function told, on every test news", async () => {
    await r.register(C1);
    await edit({ "src/big.ts": big(1) });
    await r.delivered(C1);
    const named = `Complexity: 1 file this session changed is not judged: src/big.ts ${OVER}; ${TAIL}`;
    expect(await testNews(C1)).toBe(named);
    expect(await testNews(C1)).toBe(named);
    await edit({ "src/big.ts": big(2) });
    expect(await testNews(C1)).toBe(named);
  });

  it("adds the files to the functions told over", async () => {
    await r.register(C1);
    await edit({ "src/a.ts": "settle 23 B2\n", "src/big.ts": big(1) });
    await r.delivered(C1);
    expect(await testNews(C1)).toBe(
      `Complexity: 1 function over 20 that this session was told about; 1 file this session changed is not judged: src/big.ts ${OVER}; ${TAIL}`,
    );
  });

  it("never names another session's file, or one the session did not edit", async () => {
    await r.register(C0);
    await edit({ "src/big.ts": big(1) });
    await r.register(C1);
    // A recount writes every files row at its revision: no edit (015-36).
    revise();
    expect(await r.pass(fakeCounter(2))).toMatchObject({ mode: "counter" });
    await r.delivered(C0);
    await r.delivered(C1);
    expect(await testNews(C1)).toBeUndefined();
    expect(told(C1).files).toEqual([]);
    expect(await line(C0)).toBe(
      `Complexity: 1 file this session changed is not judged: src/big.ts ${OVER}; ${TAIL}`,
    );
  });

  it("reads `could not count` for a file whose count failed, and drops a file once it counts or shrinks", async () => {
    await r.register(C1);
    await edit({ "src/big.ts": big(1) });
    await edit({ "src/run.ts": broken(1) });
    await r.delivered(C1);
    expect(await testNews(C1)).toBe(
      `Complexity: 2 files this session changed are not judged: src/run.ts (could not count) and src/big.ts ${OVER}; ${TAIL}`,
    );
    await edit({ "src/run.ts": "run 1 B9\n" });
    await r.delivered(C1);
    expect(await testNews(C1)).toBe(
      `Complexity: 1 file this session changed is not judged: src/big.ts ${OVER}; ${TAIL}`,
    );
    await edit({ "src/big.ts": "run 1 B8\n" });
    await r.delivered(C1);
    expect(await testNews(C1)).toBeUndefined();
  });

  it("drops a file once it is deleted", async () => {
    await r.register(C1);
    await edit({ "src/big.ts": big(1), "src/run.ts": broken(1) });
    await edit({ "src/big.ts": null, "src/run.ts": null });
    await r.delivered(C1);
    expect(await testNews(C1)).toBeUndefined();
  });

  it("names 3 of 5, the newest edit first, and --told lists all 5 with the same reasons", async () => {
    await r.register(C1);
    await edit({ "src/b1.ts": big(1) });
    await edit({ "src/b2.ts": broken(2) });
    await edit({ "src/b3.ts": big(3) });
    await edit({ "src/b4.ts": big(4) });
    await edit({ "src/b5.ts": broken(5) });
    await r.delivered(C1);
    const named = await testNews(C1);
    expect(named).toBe(
      `Complexity: 5 files this session changed are not judged: src/b5.ts (could not count), src/b4.ts ${OVER}, src/b3.ts ${OVER} and 2 more; ${TAIL}`,
    );
    const { files, text } = told(C1);
    // The line names the first 3 that --told lists, in its order.
    const inLine = [...(named ?? "").matchAll(/ (src\/b\d\.ts) \(/g)].map((m) => m[1]);
    expect(inLine).toEqual(files.slice(0, 3).map(([path]) => path));
    // A shell whose session is not registered here reads every registered session's (015-27).
    expect(told(consumer("elsewhere")).files).toEqual(files);
    expect(files).toEqual([
      ["src/b5.ts", "could-not-count"],
      ["src/b4.ts", "too-big"],
      ["src/b3.ts", "too-big"],
      ["src/b2.ts", "could-not-count"],
      ["src/b1.ts", "too-big"],
    ]);
    expect(text.split("\n").slice(-7)).toEqual([
      "Not judged:",
      "  src/b5.ts: unknown: could not count (tree-sitter: out of memory)",
      "  src/b4.ts: 0 KiB, over the 0 KiB limit; its functions are not counted",
      "  src/b3.ts: 0 KiB, over the 0 KiB limit; its functions are not counted",
      "  src/b2.ts: unknown: could not count (tree-sitter: out of memory)",
      "  src/b1.ts: 0 KiB, over the 0 KiB limit; its functions are not counted",
      "",
    ]);
  });
});
