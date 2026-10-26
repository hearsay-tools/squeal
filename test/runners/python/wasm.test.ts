import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GRAMMAR_WASM, loadWasm } from "../../../src/runners/python/wasm.js";

const PYTHON = join(import.meta.dirname, "../../../src/runners/python");

describe("the vendored grammar (spec 007 D4)", () => {
  it("has the sha256 its README names", () => {
    const readme = readFileSync(join(PYTHON, "README.md"), "utf8");
    const named = /\| sha256 \| `([0-9a-f]{64})` \|/.exec(readme)?.[1];
    const actual = createHash("sha256")
      .update(readFileSync(join(PYTHON, GRAMMAR_WASM)))
      .digest("hex");
    expect(actual).toBe(named);
  });

  it("loads both files from the sources", () => {
    const wasm = loadWasm();
    expect([wasm.runtime.length > 0, wasm.grammar.length > 0]).toEqual([true, true]);
  });
});
