import { describe, expect, it, vi } from "vitest";
import { Parser } from "web-tree-sitter";

/*
 * Review 0.1.293 B3: a grammar load that failed is made again at the next
 * count (spec 015 D4). Here the read of the runtime and the Python grammar
 * throws once, before web-tree-sitter's runtime is initialised: every
 * language waits on that load, so the next TypeScript count must make it.
 */

let failures = 1;
let reads = 0;

vi.mock("../../../src/runners/pytest/graph/wasm.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../src/runners/pytest/graph/wasm.js")>();
  return {
    ...real,
    loadWasm: () => {
      reads++;
      if (failures-- > 0) throw new Error("EIO: transient Python grammar read");
      return real.loadWasm(new URL("../../../src/runners/pytest/graph/wasm.ts", import.meta.url));
    },
  };
});

describe("the counter's grammars (review 0.1.293 B3)", () => {
  it("makes the runtime's load again at the next count after a read that failed before it", async () => {
    const init = vi.spyOn(Parser, "init");
    const { countFile } = await import("../../../src/core/code/count/index.js");
    const text = "function f(x) { if (x) return 1; }";
    await expect(countFile(text, "typescript")).rejects.toThrow("EIO");
    expect(init).not.toHaveBeenCalled();
    const count = await countFile(text, "typescript");
    expect(count.functions.map((f) => `${f.qualifiedName} ${f.complexity}`)).toEqual(["f 2"]);
    await countFile("def g(x):\n    if x:\n        return 1\n", "python");
    expect(reads).toBe(2);
    expect(init).toHaveBeenCalledTimes(1);
  });
});
