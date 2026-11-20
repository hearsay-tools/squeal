import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as own from "../../src/core/ci/own-map.js";

/*
 * Row 018-59 (reviews 0.1.582 B1, 0.1.582-r2 B2): the CI record, part and
 * export code builds every map keyed by a path or a name through one
 * helper, `src/core/ci/own-map.ts`, and the hooks through its copy
 * `src/runners/ci-runtime/own-map.cjs`. The two behave alike on keys named
 * like `Object.prototype` members, and the code holds no other builder:
 * no object filled by assignment to a computed key, no empty object
 * literal held in a variable, no `Object.fromEntries` or
 * `Object.create(null)` of its own. The end-to-end guard is
 * `export-object-names.test.ts`.
 */

const ROOT = resolve(import.meta.dirname, "../..");
const copy = createRequire(import.meta.url)(
  join(ROOT, "src/runners/ci-runtime/own-map.cjs"),
) as typeof own;

const NAMES = ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf", "a/__proto__"];

describe.each([
  ["own-map.ts", own],
  ["own-map.cjs", copy],
] as const)("%s", (_name, { ownMap, ownValue }) => {
  it("keeps every key an own entry, through JSON too", () => {
    const map = ownMap(NAMES.map((name, at) => [name, `v${at}`] as const));
    expect(Object.keys(map)).toEqual(NAMES);
    for (const [at, name] of NAMES.entries()) {
      expect(Object.hasOwn(map, name), name).toBe(true);
      expect(ownValue(map, name)).toBe(`v${at}`);
    }
    const back = JSON.parse(JSON.stringify(map)) as Record<string, string>;
    expect(NAMES.map((name) => ownValue(back, name))).toEqual(NAMES.map((_, at) => `v${at}`));
  });

  it("keeps a null value, and a later entry of one key wins", () => {
    const map = ownMap<string, string | null>([
      ["__proto__", null],
      ["x", "a"],
      ["x", "b"],
    ]);
    expect(ownValue(map, "__proto__")).toBeNull();
    expect(ownValue(map, "x")).toBe("b");
  });

  it("reads no inherited member", () => {
    const map = ownMap<string, string>([]);
    for (const name of NAMES) expect(ownValue(map, name), name).toBeUndefined();
  });
});

it("the two copies give the same map", () => {
  const entries = NAMES.map((name) => [name, name.length] as const);
  expect(JSON.stringify(copy.ownMap(entries))).toBe(JSON.stringify(own.ownMap(entries)));
});

/** The CI record, part and export code (row 018-59, 1). */
function ciCode(): string[] {
  const below = (dir: string): string[] =>
    readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? below(join(dir, entry.name))
        : /\.(ts|cjs|mjs)$/.test(entry.name)
          ? [join(dir, entry.name)]
          : [],
    );
  const named = (dir: string, prefix: string) =>
    readdirSync(join(ROOT, dir))
      .filter((name) => name.startsWith(prefix) && name.endsWith(".ts"))
      .map((name) => join(dir, name));
  const runners = readdirSync(join(ROOT, "src/runners"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join("src/runners", entry.name));
  return [
    ...below("src/core/ci"),
    ...below("src/runners/ci-runtime"),
    ...runners
      .filter((dir) => dir !== "src/runners/ci-runtime")
      .flatMap((dir) => [
        ...named(dir, "ci-"),
        ...(readdirSync(join(ROOT, dir)).includes("ci-runtime")
          ? below(join(dir, "ci-runtime"))
          : []),
      ]),
    ...named("src/cli", "ci"),
  ].sort();
}

const HELPERS = ["src/core/ci/own-map.ts", "src/runners/ci-runtime/own-map.cjs"];

/** Builders allowed outside the helpers, each with its reason. */
const OWN_BUILDERS: Readonly<Record<string, string>> = {
  // It imports only Node built-ins and the daemon's reporter (review of 0.1.579 B3);
  // `Object.fromEntries` is the builder `ownMap` wraps.
  "src/runners/node-test/ci-runtime/node-test-reporter.mjs": "env: Object.fromEntries(",
};

/** Assignments to a computed key that fill no map: argument slots, a replaced method, this process's env. */
const NOT_MAPS = [/^(args|call)\[at\]$/, /^target\[name\]$/, /^process\.env\[[A-Z_]+\]$/];

const code = (path: string) =>
  readFileSync(join(ROOT, path), "utf8")
    .split("\n")
    .map((line, at) => ({ line, at: at + 1 }))
    .filter(({ line }) => !/^\s*(\/\/|\/?\*)/.test(line));

describe("the CI code builds its maps through the helper", () => {
  const files = ciCode();

  it("finds the code", () => {
    expect(files).toEqual(expect.arrayContaining([...HELPERS, "src/cli/ci.ts"]));
    expect(files).toEqual(
      expect.arrayContaining([
        "src/runners/ci-runtime/evidence.cjs",
        "src/runners/vitest/ci-runtime/vitest-ci.cjs",
        "src/runners/node-test/ci-record.ts",
      ]),
    );
  });

  it("holds no builder of its own", () => {
    const found = files
      .filter((path) => !HELPERS.includes(path))
      .flatMap((path) =>
        code(path)
          .filter(({ line }) => /Object\.(fromEntries\(|create\(null\))/.test(line))
          .filter(({ line }) => !line.includes(OWN_BUILDERS[path] ?? "\0"))
          .map(({ line, at }) => `${path}:${at}: ${line.trim()}`),
      );
    expect(found).toEqual([]);
  });

  it("fills no object by assignment to a computed key", () => {
    const assigned = /([\w$.]+\[[^\]]+\])\s*(?:=(?!=)|\+=|\?\?=|\|\|=)/g;
    const found = files.flatMap((path) =>
      code(path).flatMap(({ line, at }) =>
        [...line.matchAll(assigned)]
          .filter(([, target]) => !NOT_MAPS.some((allowed) => allowed.test(target ?? "")))
          .map(() => `${path}:${at}: ${line.trim()}`),
      ),
    );
    expect(found).toEqual([]);
  });

  it("holds no empty object literal in a variable", () => {
    const empty = /\b(?:const|let|var)\s+[\w$]+(?:\s*:[^=;]+)?\s*=\s*\{\s*\}/;
    const found = files.flatMap((path) =>
      code(path)
        .filter(({ line }) => empty.test(line))
        .map(({ line, at }) => `${path}:${at}: ${line.trim()}`),
    );
    // `inspector.cjs`'s `holder` takes a stack trace, not a map.
    expect(found).toEqual([
      expect.stringMatching(
        /^src\/runners\/vitest\/ci-runtime\/inspector\.cjs:\d+: const holder = \{\};$/,
      ),
    ]);
  });
});
