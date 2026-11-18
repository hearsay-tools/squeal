import { describe, expect, it } from "vitest";
import { fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { prove } from "./proof-kit.js";
import { clean } from "./status-at-kit.js";

/*
 * Row 023-18 D1 for `squeal proof`: a side whose run reads a path its static
 * closure lacks is kept at the key with that read (020 row 020-39). The side
 * reads its outcome at that key: `stored: true` on the first call, and the
 * second call reads both sides from the store.
 */

const TEST = ref("test/a.test.ts");

/** Expects `value` 2 and reads `data/a.txt` at run time, through `fs`. */
const TEST_TEXT = [
  'import { readFileSync } from "node:fs";',
  'import { expect, it } from "vitest";',
  'import { value } from "../src/a";',
  'const data = readFileSync(new URL("../data/a.txt", import.meta.url), "utf8").trim();',
  'it("value", () => { expect(data).toBe("a"); expect(value).toBe(2); });',
  "",
].join("\n");

describe("squeal proof reads each run side at its stored key (row 023-18 D1)", {
  timeout: 240_000,
}, () => {
  it("says both sides are stored on the first call, and reads them on the second", async () => {
    const f = fixture({
      "squeal.config.json": "{}\n",
      "src/a.ts": "export const value = 1;\n",
      "data/a.txt": "a\n",
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "src/a.ts": "export const value = 2;\n", [TEST.path]: TEST_TEXT });
    const options = { cacheRoot: f.cacheRoot, install: linkInstall().install };

    const first = await prove(f, { files: [TEST.path], base: a }, options);
    expect(first.code, first.why).toBe(0);
    expect(first.files[0]).toMatchObject({
      verdict: "proven",
      red: { end: "fail", from: "run", stored: true, notStored: null },
      green: { end: "pass", from: "run", stored: true, notStored: null },
    });
    clean(f);

    const second = await prove(f, { files: [TEST.path], base: a }, options);
    expect(second.code, second.why).toBe(0);
    expect(second.report.runs).toBe(0);
    expect(second.files[0]).toMatchObject({ red: { from: "store" }, green: { from: "store" } });
    expect(second.files[0]?.red.failures[0]?.text).toContain("expected 1 to be 2");
    clean(f);
  });
});
