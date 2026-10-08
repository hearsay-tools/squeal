import { describe, expect, it } from "vitest";
import {
  asyncLoaders,
  holdsRequire,
  preloadSpecifiers,
  tokenizeNodeOptions,
} from "../../../src/runners/node-test/run/node-options.js";

/**
 * `NODE_OPTIONS` as Node splits it (`ParseNodeOptionsEnvVar` in
 * `src/node_options.cc`, identical at v22.23.3 and v24.21.0; review wave
 * 2.6, B1): only a space separates outside double quotes, a quote toggles
 * and is dropped, and inside quotes a backslash takes the next character.
 */

describe("tokenizeNodeOptions", () => {
  it.each([
    ["--require ./a.cjs", ["--require", "./a.cjs"]],
    ['"--require" ./scripts/setup.cjs', ["--require", "./scripts/setup.cjs"]],
    ['"--require=./scripts/setup.cjs"', ["--require=./scripts/setup.cjs"]],
    ['--re"qui"re x', ["--require", "x"]],
    ["  -r   x  ", ["-r", "x"]],
    ["--require\t./a.cjs", ["--require\t./a.cjs"]],
    ['"a b\\"c\\\\d"', ['a b"c\\d']],
    ["a\\b", ["a\\b"]],
    ['--x "" y', ["--x", "y"]],
    ['a""b', ["ab"]],
    ["", []],
  ])("splits %j as Node does", (value, tokens) => {
    expect(tokenizeNodeOptions(value)).toEqual(tokens);
  });

  it.each([
    ['"--require ./a.cjs', "unterminated string"],
    ['"a\\', "invalid escape"],
  ])("cannot parse %j (%s)", (value) => {
    expect(tokenizeNodeOptions(value)).toBeNull();
  });
});

describe("holdsRequire", () => {
  it.each([
    "--require ./a.cjs",
    "-r ./a.cjs",
    "--require=./a.cjs",
    "-r=./a.cjs",
    '"--require" ./scripts/setup.cjs',
    '"--require=./scripts/setup.cjs"',
    '--max-old-space-size=100 "-r" a.cjs',
    // Node would refuse it; an extra recorder only records more.
    '"--require ./a.cjs',
  ])("is true for %j", (value) => {
    expect(holdsRequire(value)).toBe(true);
  });

  it.each(["", "--import ./a.mjs", "--enable-source-maps", '"--required" x', "--require-module"])(
    "is false for %j",
    (value) => {
      expect(holdsRequire(value)).toBe(false);
    },
  );
});

describe("asyncLoaders", () => {
  it("names each --loader and --experimental-loader value in order", () => {
    expect(
      asyncLoaders([
        "--loader",
        "./a.mjs",
        "--import",
        "tsx",
        "--experimental-loader",
        "./b.mjs",
        "--experimental-loader=./c.mjs",
        "--loader=d",
      ]),
    ).toEqual(["./a.mjs", "./b.mjs", "./c.mjs", "d"]);
  });

  it("is empty without one", () => {
    expect(asyncLoaders(["--require", "./a.cjs", "--import", "tsx"])).toEqual([]);
  });
});

describe("preloadSpecifiers", () => {
  it("names each --import, --require and -r value in order, loaders left out", () => {
    expect(
      preloadSpecifiers([
        "--require",
        "./a.cjs",
        "--loader",
        "./l.mjs",
        "--import=tsx",
        "-r",
        "pkg",
        "--require=./b.cjs",
        "--no-deprecation",
        "--import",
      ]),
    ).toEqual(["./a.cjs", "tsx", "pkg", "./b.cjs"]);
  });
});
