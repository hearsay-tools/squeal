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

/**
 * The base's code tries to read `src/package.json`, which no commit holds: a
 * path first seen during the red side's run. Row 023-42: HEAD's code does
 * not read it, so the green side's run on the commit daemon, asked before
 * the red side runs, does not see it first.
 */
const reading = [
  'import { readFileSync } from "node:fs";',
  "let manifest = null;",
  'try { manifest = readFileSync(new URL("./package.json", import.meta.url), "utf8"); } catch {}',
  "export const value = manifest === null ? 1 : 0;",
  "",
].join("\n");

const TEST_TEXT = [
  'import { expect, it } from "vitest";',
  'import { value } from "../src/a";',
  'it("value", () => { expect(value).toBe(2); });',
  "",
].join("\n");

function notKeptFix() {
  const f = fixture({ "squeal.config.json": "{}\n", "src/a.ts": reading });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 2;\n", [TEST.path]: TEST_TEXT });
  return { f, a, options: { cacheRoot: f.cacheRoot, install: linkInstall().install } };
}

describe("a run file the gate does not keep names the gate's reason (row 023-18 D2)", SLOW, () => {
  it("squeal proof", async () => {
    const { f, a, options } = notKeptFix();
    const first = await prove(f, { files: [TEST.path], base: a }, options);
    expect(first.code, first.why).toBe(0);
    expect(first.files[0]?.red).toMatchObject({ end: "fail", stored: false });
    expect(first.files[0]?.red.notStored).toContain("first seen during the run");
    clean(f);
  });
});
