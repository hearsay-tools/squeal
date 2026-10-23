import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadTsxGrammar, TSX_GRAMMAR_WASM } from "../../../src/core/code/count/wasm.js";
import { copyCodeGrammar } from "../../../src/harness/build.js";

const COUNT = join(import.meta.dirname, "../../../src/core/code/count");

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "sq-code-wasm-"));
  dirs.push(dir);
  return dir;
};

describe("the vendored TSX grammar (spec 015 D3)", () => {
  it("has the sha256 its README names", () => {
    const readme = readFileSync(join(COUNT, "README.md"), "utf8");
    const named = /\| sha256 \| `([0-9a-f]{64})` \|/.exec(readme)?.[1];
    const actual = createHash("sha256")
      .update(readFileSync(join(COUNT, TSX_GRAMMAR_WASM)))
      .digest("hex");
    expect(actual).toBe(named);
  });

  it("loads from the sources", () => {
    expect(loadTsxGrammar().length).toBe(readFileSync(join(COUNT, TSX_GRAMMAR_WASM)).length);
  });

  it("is copied into dist/code/, where a bundled CLI in dist/cli/ finds it", () => {
    const dist = join(scratch(), "dist");
    mkdirSync(join(dist, "code"), { recursive: true });
    writeFileSync(join(dist, "code", "stale.wasm"), "");
    copyCodeGrammar(dist);
    expect(readdirSync(join(dist, "code"))).toEqual([TSX_GRAMMAR_WASM]);
    const cli = pathToFileURL(join(dist, "cli", "squeal.mjs"));
    expect(
      Buffer.from(loadTsxGrammar(cli)).equals(readFileSync(join(COUNT, TSX_GRAMMAR_WASM))),
    ).toBe(true);
  });

  it("names the file when neither place has it", () => {
    const cli = pathToFileURL(join(scratch(), "dist", "cli", "squeal.mjs"));
    expect(() => loadTsxGrammar(cli)).toThrow(TSX_GRAMMAR_WASM);
    expect(() => copyCodeGrammar(scratch(), join(scratch(), "absent.wasm"))).toThrow("absent.wasm");
  });
});
