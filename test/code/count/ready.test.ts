import { describe, expect, it, vi } from "vitest";

/*
 * Row 015-18: a grammar that did not load is loaded again at the next
 * count, so the pass's retry of a failed count can succeed in the same
 * daemon. The first load of the TSX grammar throws here, as a transient
 * read error would.
 */

let failures = 1;

vi.mock("../../../src/core/code/count/wasm.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../src/core/code/count/wasm.js")>();
  return {
    ...real,
    loadTsxGrammar: () => {
      if (failures-- > 0) throw new Error("EIO: i/o error, read");
      return real.loadTsxGrammar(new URL("../../../src/core/code/count/wasm.ts", import.meta.url));
    },
  };
});

describe("the counter's grammars (row 015-18)", () => {
  it("loads them again at the next count after a load that failed", async () => {
    const { countFile } = await import("../../../src/core/code/count/index.js");
    await expect(countFile("function f(x) { if (x) return 1; }", "typescript")).rejects.toThrow(
      "EIO: i/o error, read",
    );
    const count = await countFile("function f(x) { if (x) return 1; }", "typescript");
    expect(count.functions.map((f) => `${f.qualifiedName} ${f.complexity}`)).toEqual(["f 2"]);
  });
});
