import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blobHash } from "../../../src/core/hash/index.js";
import type { LintEnvironment, LintProvider } from "../../../src/core/lint/pass/index.js";
import { underModules } from "../../../src/core/lint/pass/keys.js";
import { FakeWorktree } from "../../code/pass/helpers.js";
import { commonDir } from "../helpers.js";
import { cli } from "../provider/helpers.js";
import { daemon, fixture } from "./helpers.js";

/*
 * Wave 1.7's read set with the real provider and pass, on ESLint 9 and 10:
 * every file the worker read outside the listing and `node_modules` is in
 * the key at the blob of the bytes it read, and the worker reads each
 * input whole, so none is unobserved (C3).
 */

/** `made` with the environment of its last answer kept in `seen`. */
function watched(made: LintProvider, seen: { env: LintEnvironment | null }): LintProvider {
  const keep = <T>(answer: T): T => {
    if (typeof answer === "object" && answer !== null && !("off" in answer)) {
      seen.env = answer as unknown as LintEnvironment;
    }
    return answer;
  };
  return {
    open: (format) => made.open(format),
    refresh: async (level) => keep(await made.refresh(level)),
    inputs: (paths) => made.inputs(paths),
    lint: async (files) => keep(await made.lint(files)),
    close: () => made.close(),
  };
}

const messages = (tree: FakeWorktree, path: string) => {
  const result = cli(tree.root, [path]).get(path);
  return result !== undefined && "findings" in result ? result.findings.map((f) => f.message) : [];
};

/**
 * The project fixture with its local rule modules, `u.ts`, which `t.ts`
 * imports, and `b.js`, which a rule reads as it lints `a.js`, outside the
 * listing.
 */
const UNLISTED = ["eslint/local.js", "eslint/rules/no-foo.js", "src/b.js", "src/u.ts"];

/** Whose key holds each unlisted file: every key holds a closure file, `t.ts`'s the program. */
const KEYED_IN: Readonly<Record<string, string>> = {
  "eslint/local.js": "src/a.js",
  "eslint/rules/no-foo.js": "src/a.js",
  "src/b.js": "src/a.js",
  "src/u.ts": "src/t.ts",
};

describe.each([9, 10] as const)(
  "ESLint %i: each file the worker read outside the listing",
  (major) => {
    it("is in the key at the blob of the bytes it read, and none is unobserved", async () => {
      const tree = new FakeWorktree("w1", commonDir());
      fixture(tree, "project", undefined, UNLISTED, major);
      const seen: { env: LintEnvironment | null } = { env: null };
      const one = daemon(tree, undefined, (made) => watched(made, seen));
      const keys = new Map<string, string | undefined>();
      for (const path of ["src/a.js", "src/t.ts"])
        keys.set(path, (await one.run(path)).state?.judged?.key);

      const held = seen.env?.held ?? new Map();
      const outside = [...held.keys()].filter(
        (p) => !underModules(p) && tree.source.file(p) === null,
      );
      expect(outside.sort()).toEqual(UNLISTED);
      for (const [path, uses] of held) {
        expect(uses.unobserved, path).toBeUndefined();
        if (!outside.includes(path)) continue;
        const blob = blobHash(readFileSync(join(tree.root, path)), "sha1");
        expect([uses.typescript, ...uses.others].filter((b) => b !== undefined)).toEqual(
          expect.arrayContaining([blob]),
        );
        for (const bytes of [uses.typescript, ...uses.others]) {
          if (bytes !== undefined) expect(bytes, path).toBe(blob);
        }
      }

      // An edit to each moves the key that holds it, and the stored findings are fresh ESLint's.
      for (const path of UNLISTED) {
        const file = KEYED_IN[path] as string;
        appendFileSync(join(tree.root, path), "\n// an edit outside the listing\n");
        const after = await one.run(file);
        expect(after.state?.judged?.key, path).not.toBe(keys.get(file));
        expect(after.state, path).toMatchObject({ stale: false });
        expect(after.messages, path).toEqual(messages(tree, file));
        keys.set(file, after.state?.judged?.key);
      }
      await one.close();
    }, 300_000);
  },
);

describe("the TypeScript config fixture", () => {
  it("has no input the worker read in a way it cannot hash (C3)", async () => {
    const tree = new FakeWorktree("w1", commonDir());
    fixture(tree, "ts-config", undefined, ["rule.ts"]);
    const seen: { env: LintEnvironment | null } = { env: null };
    const one = daemon(tree, undefined, (made) => watched(made, seen));
    expect((await one.run("src/a.js")).messages).toEqual(messages(tree, "src/a.js"));
    const held = [...(seen.env?.held ?? new Map())];
    expect(held.map(([path]) => path)).toEqual(
      expect.arrayContaining(["eslint.config.ts", "rule.ts"]),
    );
    for (const [path, uses] of held) expect(uses.unobserved, path).toBeUndefined();
    await one.close();
  }, 120_000);
});
