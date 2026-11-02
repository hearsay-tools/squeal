import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  hasNestedConfig,
  LOOKUP_FLAG,
  lookupEslint,
  withFlag,
} from "../../../src/core/lint/provider/lookup.js";

/*
 * Row 017-24 (D3 step 4): the worker's choice of `ESLINT_FLAGS`, beside the
 * real ESLint 9 and 10 cases in `nested.test.ts`. An ESLint 9 older than
 * the flag or the variable is not installed here, so it stands as a fake
 * that reads the variable as such a version does.
 */

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tree(paths: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), "squeal-lint-lookup-"));
  roots.push(root);
  for (const path of paths) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), "export default [];\n");
  }
  return root;
}

/** An ESLint that reads `env.ESLINT_FLAGS` when made, as ESLint 9.39 does, or as an older one does. */
function eslintOf(env: Record<string, string | undefined>, knows: "flag" | "unknown" | "ignored") {
  const made: (string | undefined)[] = [];
  const make = () => {
    const flags = env.ESLINT_FLAGS;
    made.push(flags);
    const on = (flags ?? "").split(",").includes(LOOKUP_FLAG);
    if (on && knows === "unknown") throw new Error(`Unknown flag '${LOOKUP_FLAG}'.`);
    return { flags, hasFlag: (flag: string) => knows === "flag" && on && flag === LOOKUP_FLAG };
  };
  return { make, made };
}

describe("a nested flat config (row 017-24)", () => {
  it("is one in a folder below the root, outside metadata and dependency folders", () => {
    expect(hasNestedConfig(tree(["eslint.config.js", "src/a.js"]))).toBe(false);
    expect(hasNestedConfig(tree(["src/eslint.config.json"]))).toBe(false);
    for (const folder of [".git", ".hg", ".svn", ".jj", "node_modules/p", "bower_components/p"]) {
      expect(hasNestedConfig(tree([`${folder}/eslint.config.js`])), folder).toBe(false);
    }
    for (const folder of [".pnpm-store/v3", ".yarn/cache"]) {
      expect(hasNestedConfig(tree([`${folder}/eslint.config.js`])), folder).toBe(false);
    }
    for (const name of ["js", "mjs", "cjs", "ts", "mts", "cts"]) {
      expect(hasNestedConfig(tree([`packages/a/src/eslint.config.${name}`])), name).toBe(true);
    }
  });

  it("is one in a dot folder that holds sources, as `.storybook` (review 0.1.392 B2)", () => {
    expect(hasNestedConfig(tree([".storybook/eslint.config.js"]))).toBe(true);
    expect(hasNestedConfig(tree([".config/lint/eslint.config.mjs"]))).toBe(true);
  });
});

describe("ESLINT_FLAGS with the lookup flag (row 017-24)", () => {
  it("adds the flag once to the daemon's flags", () => {
    expect(withFlag(undefined, LOOKUP_FLAG)).toBe(LOOKUP_FLAG);
    expect(withFlag("", LOOKUP_FLAG)).toBe(LOOKUP_FLAG);
    expect(withFlag("a", LOOKUP_FLAG)).toBe(`a,${LOOKUP_FLAG}`);
    expect(withFlag(` a , ${LOOKUP_FLAG} `, LOOKUP_FLAG)).toBe(` a , ${LOOKUP_FLAG} `);
  });

  it.each([undefined, "a"])("is set when ESLint takes it (daemon's flags %s)", (given) => {
    const env: Record<string, string | undefined> = {};
    const { make, made } = eslintOf(env, "flag");
    const eslint = lookupEslint(make, true, given, env);
    expect(eslint.flags).toBe(withFlag(given, LOOKUP_FLAG));
    expect(env.ESLINT_FLAGS).toBe(eslint.flags);
    expect(made).toHaveLength(1);
  });

  it.each([
    ["refuses it as unknown", "unknown"],
    ["does not read the variable", "ignored"],
  ] as const)("is the daemon's alone when an older ESLint 9 %s", (_, knows) => {
    for (const given of [undefined, "a"]) {
      const env: Record<string, string | undefined> = {};
      const { make, made } = eslintOf(env, knows);
      const eslint = lookupEslint(make, true, given, env);
      expect(eslint.flags).toBe(given);
      expect(env.ESLINT_FLAGS).toBe(given);
      expect("ESLINT_FLAGS" in env).toBe(given !== undefined);
      expect(made).toEqual([withFlag(given, LOOKUP_FLAG), given]);
    }
  });

  it("is the daemon's alone without a nested config, made once", () => {
    const env: Record<string, string | undefined> = { ESLINT_FLAGS: "stale" };
    const { make, made } = eslintOf(env, "flag");
    expect(lookupEslint(make, false, "a", env).flags).toBe("a");
    expect(lookupEslint(make, false, undefined, env).flags).toBe(undefined);
    expect(made).toEqual(["a", undefined]);
  });

  it("lets another error in making ESLint surface", () => {
    const env: Record<string, string | undefined> = {};
    const make = () => {
      throw new Error("Invalid Options");
    };
    expect(() => lookupEslint(make, true, undefined, env)).toThrow("Invalid Options");
  });
});
