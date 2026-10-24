import { describe, expect, it, vi } from "vitest";
import { Language, Parser } from "web-tree-sitter";

/*
 * Review 0.1.293 B3: the Python grammar fails to load once, after
 * web-tree-sitter's runtime is initialised. The next count loads the
 * grammar again and never initialises the live runtime a second time: a
 * second `Parser.init` would replace it under every parser made (spec 015
 * D4).
 */

describe("the counter's grammars (review 0.1.293 B3)", () => {
  it("loads the Python grammar again at the next count, on the runtime already live", async () => {
    const init = vi.spyOn(Parser, "init");
    const load = vi.spyOn(Language, "load");
    load.mockRejectedValueOnce(new Error("EIO: transient Python grammar load"));
    const { countFile } = await import("../../../src/core/code/count/index.js");
    const python = "def g(x):\n    if x:\n        return 1\n";
    await expect(countFile(python, "python")).rejects.toThrow("EIO");
    expect(init).toHaveBeenCalledTimes(1);
    const count = await countFile(python, "python");
    expect(count.functions.map((f) => `${f.qualifiedName} ${f.complexity}`)).toEqual(["g 2"]);
    const ts = await countFile("function f(x) { if (x) return 1; }", "typescript");
    expect(ts.functions.map((f) => `${f.qualifiedName} ${f.complexity}`)).toEqual(["f 2"]);
    expect(init).toHaveBeenCalledTimes(1);
    // The failed Python load, the Python load again, then TSX's.
    expect(load).toHaveBeenCalledTimes(3);
  });
});
