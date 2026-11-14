import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { countFile } from "../../../src/core/code/count/index.js";
import { joinCoverage } from "../../../src/core/code/crap/join.js";
import { collectEvidence } from "../../../src/core/code/gate/collect.js";
import { ADAPTERS, changedSet, project, SLOW } from "./collect-fixture.js";
import { quiet } from "./host-load.js";

/*
 * Spec 020 D2, D3 (row 020-03; research `quality-gate.md` Q5, `vi.mock`
 * factories): a changed test file is selected for itself, and its record
 * holds its own functions, the `vi.mock` factories and the functions they
 * return included, each of which ran.
 */

describe("collectEvidence: a changed test file with vi.mock factories", () => {
  it("runs it, and its record shows each factory ran", SLOW, async () => {
    const root = project("selection");
    const path = "test/mock.test.ts";
    const changed = await changedSet(root, [path]);
    const evidence = await collectEvidence(root, changed, {
      hostLoad: quiet,
      tests: [],
      budgetSeconds: 600,
      adapters: ADAPTERS,
    });
    const file = evidence.testFiles.find((f) => f.path === path);
    expect(file).toMatchObject({ runner: "vitest", completed: true, failed: [] });
    const own = file?.record?.sources.find((s) => s.path === path);
    expect(own?.blob).toBe(changed.counted[0]?.blob);

    const text = readFileSync(join(root, path), "utf8");
    const count = await countFile(text, "typescript");
    const joined = joinCoverage(count.functions, own === undefined ? [] : [own]);
    const ran = Object.fromEntries(
      count.functions.map((fn, i) => [`${fn.qualifiedName}#${fn.occurrence}`, joined[i]?.ran]),
    );
    expect(ran).toEqual({
      // The expression factory and the `dep` it returns.
      "<mock>#0": true,
      "<mock>.dep#0": true,
      // The async factory with `importOriginal`, and its `hostname`.
      "<mock>#1": true,
      "<mock>.hostname#0": true,
      "<describe>#0": true,
      "<describe>.<it>#0": true,
      "<describe>.<it>#1": true,
    });
  });
});
