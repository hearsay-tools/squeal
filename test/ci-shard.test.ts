import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Row 010-35 (spec 010 D5): `scripts/ci-shard.mjs` splits the suite into CI shards by measured
 * duration. Every test file runs in exactly one shard, a pin holds its file in its shard, an
 * excluded file runs in none, and the shards weigh about the same.
 */
const ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(ROOT, "scripts/ci-shard.mjs");
const WORKFLOW = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");

interface Shard {
  files: string[];
  ms: number;
}
interface Options {
  index: number;
  count: number;
  pins: Map<string, number>;
  excludes: string[];
  print: boolean;
}
interface ShardModule {
  DEFAULT_MS: number;
  discover(root?: string): string[];
  readTimings(root?: string): Map<string, number>;
  parseArgs(argv: readonly string[]): Options;
  partition(
    files: readonly string[],
    count: number,
    timings: Map<string, number>,
    pins?: Map<string, number>,
  ): Shard[];
}
// A specifier TypeScript does not resolve: the script is plain JavaScript without declarations.
const MODULE: string = "../scripts/ci-shard.mjs";
const shard = (await import(MODULE)) as ShardModule;

const DISPOSE = "test/harness/opencode-dispose.test.ts";
/**
 * The test files that read this repository's own history: a release tag or an old commit.
 * Only shard 1 checks out the full history, so the workflow pins each there.
 */
const READS_HISTORY = /\b(?:lastRelease|hasCommit)\(|\breference\.commit\b/;
const COMPARE = "test/keys/validity/compare.test.ts";

/** The pins and the exclude the workflow passes the script, for any shard count. */
function workflowArgs(): string[] {
  const pins = [...WORKFLOW.matchAll(/--pin (\S+):1\b/g)].map((match) => match[1] ?? "");
  return [...new Set(pins)].flatMap((path) => ["--pin", `${path}:1`]).concat("--exclude", DISPOSE);
}

function printed(index: number, count: number, args: readonly string[]): string[] {
  const out = execFileSync(
    process.execPath,
    [SCRIPT, "--shard", `${index}/${count}`, ...args, "--print"],
    {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  return out.split("\n").filter((line) => line !== "");
}

describe("CI shards by duration (row 010-35)", () => {
  const files = shard.discover();
  const timings = shard.readTimings();

  it("finds the test files Vitest's config includes", () => {
    // Vitest's own bin under this Node: a Squeal run may have no pnpm on its PATH.
    const vitestBin = join(ROOT, "node_modules/vitest/vitest.mjs");
    const listed = spawnSync(process.execPath, [vitestBin, "list", "--filesOnly", "--json"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 1 << 26,
    });
    expect(listed.status).toBe(0);
    const vitest = (JSON.parse(listed.stdout) as { file: string }[])
      .map((entry) => relative(ROOT, entry.file))
      .sort();
    expect(files).toEqual(vitest);
  });

  it("names each file by a path no other file's path contains, as Vitest's filter matches", () => {
    const lower = files.map((path) => path.toLowerCase());
    const shadowed = lower.filter((path) =>
      lower.some((other) => other !== path && other.includes(path)),
    );
    expect(shadowed).toEqual([]);
  });

  it.each([6, 3])("splits the workflow's %i shards with no file twice or missing", (count) => {
    const args = workflowArgs();
    const shards = Array.from({ length: count }, (_, at) => printed(at + 1, count, args));
    const all = shards.flat();
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual(files.filter((path) => path !== DISPOSE));
    expect(shards[0]).toContain(COMPARE);
  });

  it("pins every test file that reads this repository's history to shard 1", () => {
    const reading = files.filter((path) =>
      READS_HISTORY.test(readFileSync(join(ROOT, path), "utf8")),
    );
    expect(reading.length).toBeGreaterThan(0);
    const args = workflowArgs();
    const pinned = [...shard.parseArgs(["--shard", "1/6", ...args]).pins.keys()];
    expect([COMPARE, ...reading].filter((path) => !pinned.includes(path))).toEqual([]);
    const first = printed(1, 6, args);
    expect(pinned.filter((path) => !first.includes(path))).toEqual([]);
  });

  it("packs the measured files so the shards differ by less than the longest file", () => {
    const shards = shard.partition(files, 6, timings);
    const loads = shards.map((each) => each.ms);
    const longest = Math.max(...timings.values());
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThan(longest);
    // With `ci/test-timings.json` at row 010-35, the six shards were within a second of each other.
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThan(5_000);
  });

  it("orders each shard's files longest first", () => {
    const weight = (path: string) => timings.get(path) ?? shard.DEFAULT_MS;
    for (const each of shard.partition(files, 6, timings)) {
      const weights = each.files.map(weight);
      expect(weights).toEqual([...weights].sort((a, b) => b - a));
    }
  });

  it("places pins first, unmeasured files by their path's hash, the same every time", () => {
    const measured = new Map([
      ["a", 9_000],
      ["b", 5_000],
      ["c", 4_000],
    ]);
    const paths = ["a", "b", "c", "new-1", "new-2", "new-3"];
    const pins = new Map([["c", 2]]);
    const first = shard.partition(paths, 2, measured, pins);
    expect(first[1]?.files).toContain("c");
    expect(shard.partition([...paths].reverse(), 2, measured, pins)).toEqual(first);
    // An unmeasured file keeps its shard when other files come and go.
    const where = (shards: Shard[], path: string) =>
      shards.findIndex((each) => each.files.includes(path));
    const fewer = shard.partition(["new-2"], 2, new Map());
    expect(where(fewer, "new-2")).toBe(where(first, "new-2"));
    const total = first.reduce((sum, each) => sum + each.ms, 0);
    expect(total).toBe(18_000 + 3 * shard.DEFAULT_MS);
  });

  it("refuses a pin or an exclude that names no test file, and a shard out of range", () => {
    const run = (args: readonly string[]) =>
      spawnSync(process.execPath, [SCRIPT, ...args, "--print"], { cwd: ROOT, encoding: "utf8" });
    const missing = run(["--shard", "1/6", "--pin", "test/gone.test.ts:1"]);
    expect([missing.status, missing.stderr]).toEqual([2, expect.stringContaining("no such test")]);
    const excluded = run(["--shard", "1/6", "--exclude", "test/gone.test.ts"]);
    expect(excluded.status).toBe(2);
    expect(() => shard.parseArgs(["--shard", "7/6"])).toThrow(/1 <= i <= n/);
    expect(() => shard.parseArgs(["--shard", "1/6", "--pin", `${COMPARE}:7`])).toThrow(/no shard/);
  });

  it("runs an excluded file in no shard", () => {
    const shards = Array.from({ length: 6 }, (_, at) => printed(at + 1, 6, ["--exclude", COMPARE]));
    expect(shards.flat()).not.toContain(COMPARE);
    expect(shards.flat().length).toBe(files.length - 1);
  });
});
