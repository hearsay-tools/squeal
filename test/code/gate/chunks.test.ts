import { describe, expect, it } from "vitest";
import { CHUNK_SECONDS, chunksFor } from "../../../src/core/code/gate/chunks.js";
import type { RelativePath } from "../../../src/core/types/common.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import type { RunnerAdapter } from "../../../src/core/types/runner.js";

/*
 * Row 020-59 (the parent's choice C2): a runner's files go in chunks only
 * when their stored estimate covers at least two chunks of
 * `CHUNK_SECONDS` each; each chunk holds at least that much estimated
 * work, a short last chunk joining the one before. No stored duration, or
 * a shorter estimate: one run, as before.
 */

const refs = (n: number): TestFileRef[] =>
  Array.from({ length: n }, (_, i) => ({ project: "", path: `t/${i}.test.ts` as RelativePath }));

/** A node:test pick whose files run `width` at once. */
const pick = (width = 1) => ({
  kind: "node-test" as const,
  adapter: { traits: { tierWidth: () => width } } as unknown as RunnerAdapter,
});

/** Each chunk's estimated work, in seconds, at `width`. */
const workOf = (chunks: TestFileRef[][], seconds: (ref: TestFileRef) => number, width = 1) =>
  chunks.map((chunk) => chunk.reduce((sum, ref) => sum + seconds(ref), 0) / width);

describe("chunksFor (row 020-59)", () => {
  it("is 300 s of estimated work a chunk", () => {
    expect(CHUNK_SECONDS).toBe(300);
  });

  it("runs every file in one run with no stored duration", () => {
    const files = refs(500);
    expect(chunksFor(pick(), files, { tierSize: 4 })).toEqual([files]);
    expect(chunksFor(pick(), files, { tierSize: 4, durations: () => null })).toEqual([files]);
  });

  it("runs a short gate in one run: under twice the bound", () => {
    const files = refs(10);
    expect(chunksFor(pick(), files, { tierSize: 1, durations: () => 59 })).toEqual([files]);
  });

  it("splits a long gate into chunks of at least the bound each, in order", () => {
    // 23 files at 70 s: four chunks of five (350 s), and three left (210 s) join the last.
    const files = refs(23);
    const seconds = () => 70;
    const chunks = chunksFor(pick(), files, { tierSize: 1, durations: seconds });
    expect(chunks.flat()).toEqual(files);
    expect(chunks.map((c) => c.length)).toEqual([5, 5, 5, 8]);
    for (const work of workOf(chunks, seconds)) expect(work).toBeGreaterThanOrEqual(CHUNK_SECONDS);
  });

  it("divides the work by the width the files run at", () => {
    const files = refs(25);
    expect(chunksFor(pick(4), files, { tierSize: 4, durations: () => 70 })).toEqual([files]);
    const wide = chunksFor(pick(2), refs(40), { tierSize: 2, durations: () => 70 });
    for (const work of workOf(wide, () => 70, 2))
      expect(work).toBeGreaterThanOrEqual(CHUNK_SECONDS);
    expect(wide.length).toBe(4);
  });

  it("counts a file with no stored duration at the median of the stored ones", () => {
    const files = refs(9);
    const durations = (ref: TestFileRef) => (ref.path === "t/0.test.ts" ? 100 : null);
    // Nine files at 100 s each: 900 s, three chunks of three.
    expect(chunksFor(pick(), files, { tierSize: 1, durations }).map((c) => c.length)).toEqual([
      3, 3, 3,
    ]);
  });

  it("takes a file count from `chunkFiles` instead, for tests", () => {
    expect(chunksFor(pick(), refs(5), { tierSize: 1, chunkFiles: 2 }).map((c) => c.length)).toEqual(
      [2, 2, 1],
    );
  });
});
