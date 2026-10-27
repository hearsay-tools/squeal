import { beforeEach, describe, expect, it } from "vitest";
import { formatCodeReport } from "../../../src/cli/code.js";
import { readCodeReport } from "../../../src/cli/code-report.js";
import { codeChanges, codeLines, codeTitleWords } from "../../../src/core/delivery/code-format.js";
import { createDelivery, formatDelta } from "../../../src/core/delivery/index.js";
import { createStateSink } from "../../../src/core/state/index.js";
import type { CodeNews } from "../../../src/core/types/code-delivery.js";
import type { Consumer } from "../../../src/core/types/index.js";
import { fixedStatus } from "../../delivery/fakes.js";
import { check, result, setKey, WT } from "../../state/helpers.js";
import { consumer, type Rig, rig } from "../pass/rig.js";

/*
 * Row 015-84 (lessons.md Round 2 C7): test news ends with the standing
 * code summary, `Code: ...`, once per change of it for each consumer. Its
 * signature is the counts and thresholds told over and every changed file
 * not judged with its reason; it is kept across a resume, cleared when the
 * summary goes, and written only by a delivery that carries it.
 */

const C1 = consumer("s1");
const C2 = consumer("s2");
const LIMIT = 64;
const T = check("a");
/** A file over `LIMIT` bytes. */
const big = (n: number) => `run 1 B${n}\n`.repeat(12);
const OVER = "(0 KiB, over the 0 KiB limit)";
const TAIL = "squeal code --told lists them.";
const told = (n: number) =>
  `Code: ${n} ${n === 1 ? "function" : "functions"} over 20 that this session was told about; ${TAIL}`;
const notJudged = (path: string) =>
  `Code: 1 file this session changed is not judged: ${path} ${OVER}; ${TAIL}`;

let r: Rig;
let sink: ReturnType<typeof createStateSink>;
let outcome: "pass" | "fail";

beforeEach(async () => {
  r = rig({ maxFileBytes: LIMIT });
  sink = createStateSink(r.main, { now: () => 1_000 });
  outcome = "pass";
  flip();
  await edit({ "src/a.ts": "settle 3 B1\npay 3 B2\n" });
});

/** Stores one revision of the paths written since the last, in the main store too, as the daemon's. */
function revise(): void {
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
}

/** Writes these files, stores one revision of them, and runs the pass; `commit` moves `HEAD` as a pull. */
async function edit(files: Record<string, string>, commit = false): Promise<void> {
  for (const [path, text] of Object.entries(files)) r.tree.write(path, text);
  if (commit) r.tree.commit(...Object.keys(files));
  revise();
  await r.pass();
}

/** A test result that flips, so the next delivery has test news. */
function flip(): void {
  outcome = outcome === "pass" ? "fail" : "pass";
  sink.applyResults(WT, 1, [result(T, outcome)], { checkpointId: null });
}

/** The `Code:` line of `c`'s next delivery after a test result flips; `undefined` when it has none. */
async function testNews(c: Consumer): Promise<string | undefined> {
  flip();
  const lines = await r.delivered(c);
  expect(lines.join("\n")).toMatch(/src\/a\.test\.ts > a/);
  return tailOf(lines);
}

/** The standing summary among `lines`, whatever its label. */
const tailOf = (lines: readonly string[]) =>
  lines.find((l) => l.endsWith(" code --told lists them."));

describe("the standing summary at test news (row 015-84)", () => {
  it("starts `Code:` and comes once while its numbers stand", async () => {
    await r.register(C1);
    await edit({ "src/a.ts": "settle 3 B1\npay 23 B3\n" });
    expect(await r.told(C1)).toEqual([expect.stringMatching(/^FAIL complexity: pay /)]);
    expect(await testNews(C1)).toBe(told(1));
    expect(await testNews(C1)).toBeUndefined();
    expect(await testNews(C1)).toBeUndefined();
  });

  it("comes again when a count changes, and not for an edit that leaves it", async () => {
    await r.register(C1);
    await edit({ "src/a.ts": "settle 3 B1\npay 23 B3\n" });
    await r.delivered(C1);
    expect(await testNews(C1)).toBe(told(1));
    await edit({ "src/a.ts": "settle 24 B4\npay 23 B3\n" });
    await r.delivered(C1);
    expect(await testNews(C1)).toBe(told(2));
    await edit({ "src/a.ts": "settle 25 B5\npay 23 B3\n" });
    await r.delivered(C1);
    expect(await testNews(C1)).toBeUndefined();
  });

  it("comes again after it went and came back", async () => {
    await r.register(C1);
    await edit({ "src/a.ts": "settle 3 B1\npay 23 B3\n" });
    await r.delivered(C1);
    expect(await testNews(C1)).toBe(told(1));
    await edit({ "src/a.ts": "settle 3 B1\npay 18 B4\n" });
    await r.delivered(C1);
    expect(await testNews(C1)).toBeUndefined();
    await edit({ "src/a.ts": "settle 3 B1\npay 23 B3\n" });
    await r.delivered(C1);
    expect(await testNews(C1)).toBe(told(1));
  });

  it("comes again for another changed file not judged, though the count is the same", async () => {
    await r.register(C1);
    await edit({ "src/b1.ts": big(1) });
    await r.delivered(C1);
    expect(await testNews(C1)).toBe(notJudged("src/b1.ts"));
    await edit({ "src/b1.ts": big(2) });
    await r.delivered(C1);
    expect(await testNews(C1)).toBeUndefined();
    await edit({ "src/b1.ts": "run 1 B9\n", "src/b2.ts": big(3) });
    await r.delivered(C1);
    expect(await testNews(C1)).toBe(notJudged("src/b2.ts"));
  });

  it("comes again when a file past the third named changes, the line's text the same", async () => {
    await r.register(C1);
    await edit({ "src/b1.ts": big(1) });
    await edit({ "src/b2.ts": big(2), "src/b3.ts": big(3), "src/b4.ts": big(4) });
    await r.delivered(C1);
    const line = `Code: 4 files this session changed are not judged: src/b2.ts ${OVER}, src/b3.ts ${OVER}, src/b4.ts ${OVER} and 1 more; ${TAIL}`;
    expect(await testNews(C1)).toBe(line);
    // The fourth, unnamed, is now `src/b0.ts`: new evidence of the same size.
    await edit({ "src/b1.ts": "run 1 B9\n", "src/b0.ts": big(5) });
    await edit({ "src/b2.ts": big(6), "src/b3.ts": big(7), "src/b4.ts": big(8) });
    await r.delivered(C1);
    expect(await testNews(C1)).toBe(line);
    expect(await testNews(C1)).toBeUndefined();
  });

  it("keeps each consumer's summary apart", async () => {
    await r.register(C1);
    await r.register(C2);
    await edit({ "src/a.ts": "settle 3 B1\npay 23 B3\n" });
    await r.delivered(C1);
    await r.delivered(C2);
    expect(await testNews(C1)).toBe(told(1));
    expect(await testNews(C1)).toBeUndefined();
    expect(await testNews(C2)).toBe(told(1));
    expect(await testNews(C2)).toBeUndefined();
  });

  it("keeps the summary sent across a resume", async () => {
    await r.register(C1);
    await edit({ "src/b1.ts": big(1) });
    await r.delivered(C1);
    expect(await testNews(C1)).toBe(notJudged("src/b1.ts"));
    await r.end(C1);
    await r.register(C1);
    expect(await testNews(C1)).toBeUndefined();
  });
});

describe("what does not take the summary (row 015-84)", () => {
  it("a delivery with code news only, `squeal code --told`, and formatting the delivery twice", async () => {
    await r.register(C1);
    await edit({ "src/a.ts": "settle 3 B1\npay 23 B3\n" });
    await r.delivered(C1);
    await edit({ "src/a.ts": "settle 3 B1\npay 24 B4\n", "src/b1.ts": big(1) });
    expect(tailOf(await r.delivered(C1))).toBeUndefined();
    const report = readCodeReport(r.main, r.store, WT, r.complexity, {
      paths: null,
      changed: false,
      told: true,
      shell: { session: C1.sessionId, agent: null },
    });
    expect(formatCodeReport(report)).toContain("that this session was told about");
    // The next delivery tells a FAIL and test news, so it carries both code lines and the summary.
    await edit({ "src/a.ts": "settle 24 B5\npay 24 B4\n" });
    flip();
    const delta = await createDelivery(r.main, {
      status: fixedStatus(),
      now: () => 99_000,
      code: r.source,
    }).onToolBoundary(C1);
    const text = formatDelta(delta ?? expect.fail("no delta"));
    const both = `Code: 2 functions over 20 that this session was told about; 1 file this session changed is not judged: src/b1.ts ${OVER}; ${TAIL}`;
    expect(text.endsWith(`\n\n${both}`)).toBe(true);
    expect(formatDelta(delta ?? expect.fail("no delta"))).toBe(text);
    // The code part's own formatters do not read the summary: it stays a separate tail.
    const full = delta?.code ?? expect.fail("no code");
    const { toldOver, notJudged: files, ...code } = full;
    expect([toldOver, files].every((p) => p !== undefined)).toBe(true);
    expect(codeLines(code, "squeal")).toEqual([expect.stringMatching(/^FAIL complexity: settle /)]);
    const words = (n: CodeNews) => [codeLines(n, "squeal"), codeChanges(n), codeTitleWords(n)];
    expect(words(full)).toEqual(words(code));
    expect(await testNews(C1)).toBeUndefined();
  });

  it("a registration, a resumed one too, before the summary's first test news", async () => {
    await r.register(C1);
    await edit({ "src/b1.ts": big(1) });
    expect(await r.delivered(C1)).toContain(
      "src/b1.ts is 0 KiB, over the 0 KiB limit; its functions are not counted.",
    );
    await r.end(C1);
    await r.register(C1);
    await r.register(C2);
    expect(await testNews(C1)).toBe(notJudged("src/b1.ts"));
    const forC2 = await r.delivered(C2);
    expect(forC2.join("\n")).toMatch(/src\/a\.test\.ts > a/);
    expect(tailOf(forC2)).toBeUndefined();
  });

  it("an idle waiter's test news takes it once, as a tool boundary's does", async () => {
    await r.register(C1);
    await edit({ "src/a.ts": "settle 3 B1\npay 23 B3\n" });
    await r.delivered(C1);
    const deliver = createDelivery(r.main, {
      status: fixedStatus(),
      now: () => 99_000,
      code: r.source,
    });
    const waited = async () => {
      setKey(r.main, "k1", { pending: "queued" });
      await deliver.endTurn(C1);
      flip();
      setKey(r.main, "k1");
      const delta = await deliver.waitForDelta(C1, { timeoutMs: 40 });
      return tailOf(formatDelta(delta ?? expect.fail("no delta")).split("\n"));
    };
    expect(await waited()).toBe(told(1));
    expect(await waited()).toBeUndefined();
    expect(await testNews(C1)).toBeUndefined();
  });

  it("a pull's FAIL changes the count, so the summary comes again", async () => {
    await r.register(C1);
    await edit({ "src/a.ts": "settle 3 B1\npay 23 B3\n" });
    await r.delivered(C1);
    expect(await testNews(C1)).toBe(told(1));
    await edit({ "src/c.ts": "fresh 25 B6\n" }, true);
    expect(await r.told(C1)).toEqual([expect.stringMatching(/^FAIL complexity: fresh /)]);
    expect(await testNews(C1)).toBe(told(2));
  });
});
