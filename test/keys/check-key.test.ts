import { describe, expect, it } from "vitest";
import { assembleClosure, checkKey } from "../../src/core/keys/index.js";
import type { Closure } from "../../src/core/types/index.js";

const closure: Closure = assembleClosure(
  { testFile: { project: "unit", path: "test/a.test.ts" }, paths: ["src/a.ts", "src/b.ts"] },
  [],
);
const hashes: Record<string, string> = {
  "src/a.ts": "a1",
  "src/b.ts": "b1",
  "test/a.test.ts": "t1",
};
const hashOf = (path: string): string | null => hashes[path] ?? null;

describe("checkKey", () => {
  const key = checkKey("env1", closure, hashOf);

  it("is a lowercase sha256 hex digest and deterministic", () => {
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(checkKey("env1", closure, hashOf)).toBe(key);
  });

  it("changes with the environment hash", () => {
    expect(checkKey("env2", closure, hashOf)).not.toBe(key);
  });

  it("changes with the project name and the test path", () => {
    expect(
      checkKey("env1", { ...closure, testFile: { ...closure.testFile, project: "e2e" } }, hashOf),
    ).not.toBe(key);
    expect(
      checkKey(
        "env1",
        { ...closure, testFile: { ...closure.testFile, path: "test/b.test.ts" } },
        hashOf,
      ),
    ).not.toBe(key);
  });

  it("changes with any closure file hash", () => {
    expect(checkKey("env1", closure, (p) => (p === "src/b.ts" ? "b2" : hashOf(p)))).not.toBe(key);
  });

  it("changes when a closure file is missing", () => {
    expect(checkKey("env1", closure, (p) => (p === "src/b.ts" ? null : hashOf(p)))).not.toBe(key);
  });

  it("changes when a path joins or leaves the closure", () => {
    const larger = { ...closure, paths: [...closure.paths, "src/c.ts"] };
    expect(checkKey("env1", larger, (p) => (p === "src/c.ts" ? "c1" : hashOf(p)))).not.toBe(key);
  });

  it("does not confuse which path a hash belongs to", () => {
    const swapped = (p: string) => (p === "src/a.ts" ? "b1" : p === "src/b.ts" ? "a1" : hashOf(p));
    expect(checkKey("env1", closure, swapped)).not.toBe(key);
  });
});
