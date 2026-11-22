import { describe, expect, it } from "vitest";
import { fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { prove } from "./proof-kit.js";
import { clean } from "./status-at-kit.js";

/*
 * Row 023-18 D2 (`tasks/023-09-notes.md`): with coverage on, a run file the
 * gate does not keep is not stored for the gate's own reason (here: the run
 * read a path first seen during it, as `mark-binding.test.ts` read absent
 * `package.json` files). The report names that reason, never coverage.
 */

const TEST = ref("test/a.test.ts");

/** Tries to read `src/package.json`, which no commit holds: a path first seen during the run. */
const writing = (value: number) =>
  [
    'import { readFileSync } from "node:fs";',
    'import { expect, it } from "vitest";',
    'import { value } from "../src/a";',
    "let manifest = null;",
    'try { manifest = readFileSync(new URL("../src/package.json", import.meta.url), "utf8"); } catch {}',
    `it("value", () => { expect(manifest).toBeNull(); expect(value).toBe(${value}); });`,
    "",
  ].join("\n");

function notKeptFix() {
  const f = fixture({
    "squeal.config.json": "{}\n",
    "src/a.ts": "export const value = 1;\n",
    [TEST.path]: writing(1),
  });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 2;\n", [TEST.path]: writing(2) });
  return { f, a, options: { cacheRoot: f.cacheRoot, install: linkInstall().install } };
}

describe("a run file the gate does not keep names the gate's reason (row 023-18 D2)", SLOW, () => {
  it("squeal proof", async () => {
    const { f, options } = notKeptFix();
    const a = git(f.root, "rev-parse", "HEAD~1").trim();
    const first = await prove(f, { files: [TEST.path], base: a }, options);
    expect(first.code, first.why).toBe(0);
    expect(first.files[0]?.red).toMatchObject({ end: "fail", stored: false });
    expect(first.files[0]?.red.notStored).toContain("first seen during the run");
    clean(f);
  });
});
