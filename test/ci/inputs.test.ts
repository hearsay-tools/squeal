import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listingHash, readEvidence, readRecorded, uncertified } from "../../src/core/ci/inputs.js";
import { ABSENT_LISTING } from "../../src/core/keys/observed.js";

/*
 * Spec 018 D8 and D9 (2026-11-09, reviews of 0.1.421 B1, "one owner for
 * input evidence"): the evidence a command's processes took as they read,
 * and what the export compares it with. A path has evidence only with one
 * value and no write during the command; an input is certified only by
 * evidence equal to the export's content. No commit blob, clean checkout or
 * unreported path stands for evidence.
 */

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "squeal-ci-inputs-"));
  temps.push(dir);
  return dir;
}

/** `lines` as the files `evidence.cjs` appends, one per process. */
function evidenceDir(files: Record<string, readonly unknown[]>): string {
  const dir = temp();
  for (const [name, lines] of Object.entries(files)) {
    writeFileSync(join(dir, name), lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
  }
  return dir;
}

describe("readEvidence", () => {
  it("keeps each path's one value across processes, sorted", () => {
    const dir = evidenceDir({
      "1-0.ndjson": [{ e: { "src/b.ts": "b", "gone.txt": null } }, { e: { "data/": "names" } }],
      "2-0.ndjson": [{ e: { "src/b.ts": "b", "src/a.ts": "a" } }],
    });
    expect(Object.entries(readEvidence(dir))).toEqual([
      ["data/", "names"],
      ["gone.txt", null],
      ["src/a.ts", "a"],
      ["src/b.ts", "b"],
    ]);
  });

  it("drops a path read with two contents, and one written, even when restored", () => {
    const dir = evidenceDir({
      "1-0.ndjson": [{ e: { "a.txt": "one", "b.txt": "same", "c.txt": "c" } }],
      "2-0.ndjson": [
        { e: { "a.txt": "two" } },
        { w: ["b.txt"], t: [] },
        { e: { "b.txt": "same" } },
      ],
    });
    expect(readEvidence(dir)).toEqual({ "c.txt": "c" });
  });

  it("drops every path and listing below a path written with all below it", () => {
    const dir = evidenceDir({
      "1-0.ndjson": [
        { e: { "out/x.txt": "x", "out/": "names", "out/deep/": "deep", "outer.txt": "o" } },
        { w: ["./"], t: ["out"] },
      ],
    });
    expect(readEvidence(dir)).toEqual({ "outer.txt": "o" });
  });

  it("drops every path when the root is written with all below it (a withheld run)", () => {
    const dir = evidenceDir({
      "1-0.ndjson": [{ e: { "a.txt": "a", "./": "names", "src/b.ts": "b" } }, { w: [], t: [""] }],
    });
    expect(readEvidence(dir)).toEqual({});
  });

  it("skips a line cut short, and reads a missing directory as no evidence", () => {
    const dir = temp();
    writeFileSync(join(dir, "1-0.ndjson"), `${JSON.stringify({ e: { "a.txt": "a" } })}\n{"e":{"b`);
    expect(readEvidence(dir)).toEqual({ "a.txt": "a" });
    expect(readEvidence(join(dir, "missing"))).toEqual({});
  });
});

describe("readRecorded (row 018-29)", () => {
  it("sums each process's latest clock time, counts the processes that wrote one, and keeps the evidence", () => {
    const lines: Record<string, readonly Record<string, unknown>[]> = {
      "1-0.ndjson": [{ e: { "a.txt": "a" }, o: 1.5 }, { w: ["b.txt"], t: [], o: 4 }, { o: 6.25 }],
      "2-0.ndjson": [{ e: { "c.txt": "c" }, o: 2 }, { o: 1 }],
      "3-0.ndjson": [{ e: { "d.txt": "d" } }],
      "4-0.ndjson": [{ o: "7" }, { o: -1 }, { o: null }],
    };
    const recorded = readRecorded(evidenceDir(lines));
    expect(recorded.hooks).toEqual({ ms: 8.25, threads: 2 });
    // The time is beside the evidence, never in it: the same paths as without it.
    const plain = Object.fromEntries(
      Object.entries(lines).map(([name, file]) => [
        name,
        file.map(({ o: _o, ...line }) => line).filter((line) => Object.keys(line).length > 0),
      ]),
    );
    expect(recorded.evidence).toEqual(readEvidence(evidenceDir(plain)));
    expect(recorded.evidence).toEqual({ "a.txt": "a", "c.txt": "c", "d.txt": "d" });
    expect(readRecorded(join(temp(), "missing")).hooks).toEqual({ ms: 0, threads: 0 });
  });
});

describe("uncertified (spec 018 D9)", () => {
  const here = (hashes: Record<string, string | null>) => (path: string) => hashes[path];

  it("certifies an input only by read-time evidence equal to this checkout's content", () => {
    const evidence = { "data/v.txt": "good", "data/": "names", "gone.txt": null };
    const paths = Object.keys(evidence);
    expect(uncertified(paths, evidence, here({ ...evidence }))).toEqual([]);
    const changed = here({ ...evidence, "data/v.txt": "bad", "gone.txt": "back" });
    expect(uncertified(paths, evidence, changed)).toEqual(["data/v.txt", "gone.txt"]);
  });

  it("never certifies an input without evidence, nor one this checkout has no hash of", () => {
    // A commit's file or an absent path is not taken as read: the run's evidence must hold it.
    const now = here({
      "src/a.ts": "blob-a",
      "test/__snapshots__/a.snap": null,
      "data/v.txt": "v",
    });
    const paths = ["src/a.ts", "test/__snapshots__/a.snap", "data/v.txt"];
    expect(uncertified(paths, { "data/v.txt": "v" }, now)).toEqual(paths.slice(0, 2));
    expect(uncertified(["unknown.ts"], { "unknown.ts": "u" }, now)).toEqual(["unknown.ts"]);
  });
});

describe("listingHash", () => {
  it("hashes the names on disk, a marker for a directory that is not there", () => {
    const root = temp();
    mkdirSync(join(root, "fix/a"), { recursive: true });
    writeFileSync(join(root, "fix/b.txt"), "b");
    expect(listingHash(root, "fix")).not.toBe(listingHash(root, "fix/a"));
    expect(listingHash(root, "none")).toBe(ABSENT_LISTING);
  });
});
