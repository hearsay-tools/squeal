import { describe, expect, it } from "vitest";
import { observe } from "./helpers.js";

/*
 * Row 023-47: the files a run read and also wrote stay out of its reads,
 * as before, and are named apart as `rewritten`, for the core to key the
 * ones git tracks (`inputsOfReads`). The recorder keeps no order, so a
 * file written and then read back is named too.
 */

describe("observedInputs: files the run read and wrote (row 023-47)", { timeout: 60_000 }, () => {
  it("names a file read then rewritten, one written then read, and one read then removed", () => {
    const seen = observe({
      "main.mjs": [
        'import { readFileSync, rmSync, writeFileSync } from "node:fs";',
        'if (readFileSync("data.txt", "utf8") === "1") writeFileSync("data.txt", "2");',
        'writeFileSync("out.txt", "o");',
        'readFileSync("out.txt", "utf8");',
        'readFileSync("gone.txt", "utf8");',
        'rmSync("gone.txt");',
        'readFileSync("in.txt", "utf8");',
      ].join("\n"),
      "data.txt": "1",
      "gone.txt": "g",
      "in.txt": "i",
    });
    const [inputs] = seen.inputs;
    expect(inputs?.rewritten).toEqual(["data.txt", "gone.txt", "out.txt"]);
    expect(inputs?.paths).toContain("in.txt");
    expect(inputs?.paths).not.toEqual(expect.arrayContaining(["data.txt"]));
    expect(inputs?.paths.filter((p) => inputs.rewritten?.includes(p))).toEqual([]);
  });

  it("names none for a run that wrote no file it read", () => {
    const seen = observe({
      "main.mjs": [
        'import { readFileSync, writeFileSync } from "node:fs";',
        'writeFileSync("out.txt", "o");',
        'readFileSync("in.txt", "utf8");',
      ].join("\n"),
      "in.txt": "i",
    });
    expect(seen.inputs[0]?.paths).toContain("in.txt");
    expect(seen.inputs[0]).not.toHaveProperty("rewritten");
  });

  it("names a file a CommonJS run read and rewrote in one statement", () => {
    const seen = observe(
      {
        "main.cjs": [
          'const { readFileSync, writeFileSync } = require("node:fs");',
          'writeFileSync("data.txt", readFileSync("data.txt", "utf8") + "!");',
        ].join("\n"),
        "data.txt": "1",
      },
      "main.cjs",
    );
    expect(seen.inputs[0]?.rewritten).toEqual(["data.txt"]);
  });
});
