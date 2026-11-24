#!/usr/bin/env node
/*
 * Row 010-35 (spec 010 D5): one CI shard's test files, balanced by duration.
 *
 *   node scripts/ci-shard.mjs --shard <i>/<n> [--pin <path>:<shard>]... [--exclude <path>]... [--print]
 *
 * It finds the files `vitest.config.ts` includes (`test/**` and `src/**` `*.test.ts`, outside
 * `test/fixtures`), weighs each by `ci/test-timings.json` (a file not listed weighs 500 ms) and
 * packs them into n shards: pinned files first, then each unlisted file in the shard its path's
 * sha1 names, then the listed files, longest first, each into the lightest shard. `--print` writes
 * shard i's files, one per line; without it the script runs `pnpm exec vitest run` on them.
 * Vitest orders files by its results cache, so the script writes their weights there first and
 * the longest file starts first. Plain Node, no package: CI runs it before anything else is built.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_MS = 500;
const TIMINGS = "ci/test-timings.json";

/** The test files Vitest includes under `root`, sorted. Dot directories and fixtures stay out. */
export function discover(root = ROOT) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(join(root, dir), { withFileTypes: true });
    } catch (error) {
      // A test removes its scratch directory at any time (014-18); one gone mid-walk holds no test.
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (
          !entry.name.startsWith(".") &&
          entry.name !== "node_modules" &&
          path !== "test/fixtures"
        )
          walk(path);
      } else if (entry.name.endsWith(".test.ts")) found.push(path);
    }
  };
  walk("test");
  walk("src");
  return found.sort();
}

/** The measured milliseconds per test file. */
export function readTimings(root = ROOT) {
  return new Map(Object.entries(JSON.parse(readFileSync(join(root, TIMINGS), "utf8")).files));
}

const fail = (message) => {
  throw new Error(`ci-shard: ${message}`);
};

/** `--shard i/n`, `--pin path:shard` and `--exclude path`, repeatable, and `--print`. */
export function parseArgs(argv) {
  const options = { index: 0, count: 0, pins: new Map(), excludes: [], print: false };
  for (let at = 0; at < argv.length; at++) {
    const flag = argv[at];
    if (flag === "--print") {
      options.print = true;
      continue;
    }
    const value = argv[++at];
    if (value === undefined) fail(`${flag} needs a value`);
    if (flag === "--shard") {
      const match = /^(\d+)\/(\d+)$/.exec(value);
      if (!match) fail(`--shard takes <i>/<n>, not ${value}`);
      options.index = Number(match[1]);
      options.count = Number(match[2]);
    } else if (flag === "--pin") {
      const match = /^(.+):(\d+)$/.exec(value);
      if (!match) fail(`--pin takes <path>:<shard>, not ${value}`);
      options.pins.set(match[1], Number(match[2]));
    } else if (flag === "--exclude") options.excludes.push(value);
    else fail(`unknown argument ${flag}`);
  }
  if (options.count < 1 || options.index < 1 || options.index > options.count)
    fail("--shard <i>/<n> needs 1 <= i <= n");
  for (const [path, shard] of options.pins)
    if (shard < 1 || shard > options.count) fail(`--pin ${path}:${shard} names no shard`);
  return options;
}

const hashShard = (path, count) =>
  Number.parseInt(createHash("sha1").update(path).digest("hex").slice(0, 8), 16) % count;

/**
 * `files` in `count` shards, each `{ files, ms }` with its files longest first. Every pin must
 * name one of `files`. The same input always gives the same shards.
 */
export function partition(files, count, timings, pins = new Map()) {
  const shards = Array.from({ length: count }, () => ({ files: [], ms: 0 }));
  const weight = (path) => timings.get(path) ?? DEFAULT_MS;
  const place = (path, shard) => {
    shards[shard].files.push(path);
    shards[shard].ms += weight(path);
  };
  const known = new Set(files);
  for (const [path, shard] of pins) {
    if (!known.has(path)) fail(`--pin ${path}: no such test file`);
    place(path, shard - 1);
  }
  const rest = files.filter((path) => !pins.has(path));
  for (const path of rest) if (!timings.has(path)) place(path, hashShard(path, count));
  const timed = rest.filter((path) => timings.has(path));
  timed.sort((a, b) => weight(b) - weight(a) || (a < b ? -1 : 1));
  for (const path of timed) {
    let lightest = 0;
    for (let shard = 1; shard < count; shard++)
      if (shards[shard].ms < shards[lightest].ms) lightest = shard;
    place(path, lightest);
  }
  for (const shard of shards) shard.files.sort((a, b) => weight(b) - weight(a) || (a < b ? -1 : 1));
  return shards;
}

/** Shard `index` of `options` (1-based) over the repository's files, with excludes applied. */
export function plan(options, root = ROOT) {
  const files = discover(root);
  for (const path of options.excludes)
    if (!files.includes(path)) fail(`--exclude ${path}: no such test file`);
  const kept = files.filter((path) => !options.excludes.includes(path));
  return partition(kept, options.count, readTimings(root), options.pins)[options.index - 1];
}

/**
 * Vitest runs the files its results cache has no duration for first, then the longest. It
 * finds each by `<project>:<path>` in `node_modules/.vite/vitest/<sha1 of "">/results.json`.
 */
function seedOrder(files, timings) {
  // `--json` last: it takes an optional path, and before a file it would write the list there.
  const listed = spawnSync("pnpm", ["exec", "vitest", "list", ...files, "--filesOnly", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 26,
  });
  if (listed.status !== 0) fail(`vitest list exited ${listed.status}: ${listed.stderr}`);
  const entries = JSON.parse(listed.stdout).map((entry) => ({
    path: relative(ROOT, entry.file).split("\\").join("/"),
    project: entry.projectName ?? "",
  }));
  // Vitest keeps a file whose path contains a filter, so the filters must select these files only.
  const selected = [...new Set(entries.map((entry) => entry.path))].sort();
  const wanted = [...files].sort();
  if (selected.join("\n") !== wanted.join("\n"))
    fail(`vitest selects ${selected.length} files for this shard's ${wanted.length}`);
  const dir = join(ROOT, "node_modules/.vite/vitest", createHash("sha1").update("").digest("hex"));
  const path = join(dir, "results.json");
  let cache = { version: "5.0.0", results: [] };
  try {
    cache = JSON.parse(readFileSync(path, "utf8"));
  } catch {}
  const results = new Map(cache.results);
  for (const entry of entries) {
    const key = `${entry.project}:${entry.path}`;
    results.set(key, {
      duration: timings.get(entry.path) ?? DEFAULT_MS,
      failed: results.get(key)?.failed ?? false,
    });
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify({ version: cache.version, results: [...results] }));
}

function main(argv) {
  const options = parseArgs(argv);
  const shard = plan(options);
  const label = `shard ${options.index}/${options.count}`;
  process.stderr.write(`${label}: ${shard.files.length} files, ${Math.round(shard.ms / 1000)} s\n`);
  if (options.print) {
    if (shard.files.length > 0) process.stdout.write(`${shard.files.join("\n")}\n`);
    return 0;
  }
  // No filter would run every file.
  if (shard.files.length === 0) return 0;
  seedOrder(shard.files, readTimings());
  const run = spawnSync("pnpm", ["exec", "vitest", "run", ...shard.files], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (run.error) throw run.error;
  return run.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}
