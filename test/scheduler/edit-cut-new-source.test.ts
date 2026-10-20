import { describe, expect, it } from "vitest";
import type { CatchUpFile } from "./catch-up-fixture.js";
import { editAndRun, expectCut, FOUR_SHORT, importers, started } from "./edit-cut-fixture.js";

/*
 * Review wave 6, B1 (spec 011 C4 step 4 as amended for 011-25): a source
 * the closures hold only once the runner part re-resolved them is a source
 * all the same. Adding `src/a.js` beside `src/a.ts` makes an extensionless
 * `../src/a` resolve to it, so no stored closure named it before the
 * revision; its namesake, or with none every direct importer, stays an
 * edit's work.
 */
const OLD = "src/a.ts";
const NEW = "src/a.js";

/**
 * Files importing `OLD`, whose imports the test re-points at `NEW`: `own`
 * slower than the four shortest others, so only the namesake rule keeps it,
 * and the two of 5 and 6 s too slow to fill a kept file's tier.
 */
function pointing(own: string): { files: CatchUpFile[]; imports: string[][] } {
  const imports = [[OLD], ...FOUR_SHORT.map(() => [OLD])];
  const files: CatchUpFile[] = [
    { path: own, ms: 900, imports: imports[0] ?? [] },
    ...importers("d", OLD, FOUR_SHORT).map((f, i) => ({ ...f, imports: imports[i + 1] ?? [] })),
  ];
  return { files, imports };
}

const repoint = (imports: string[][]) => {
  for (const list of imports) list.splice(0, list.length, NEW);
};

describe("scheduler: a source the runner part first finds keeps its edit work (review wave 6, B1)", {
  timeout: 120_000,
}, () => {
  it("keeps the new source's namesake and the 4 shortest other direct importers", async () => {
    const { files, imports } = pointing("test/a.test.ts");
    const { side } = await started(files, {}, [NEW]);
    repoint(imports);
    const result = await editAndRun(side, NEW);
    const [own, ...others] = files;
    expectCut(result, [own as CatchUpFile, ...others.slice(0, 4)], others.slice(4));
  });

  it("keeps every direct importer of a new source with no namesake", async () => {
    const { files, imports } = pointing("test/behavior.test.ts");
    const { side } = await started(files, {}, [NEW]);
    repoint(imports);
    const result = await editAndRun(side, NEW);
    expectCut(result, files, []);
    expect(result.catchUpPaths).toEqual([]);
  });

  it("keeps a new bare source's importers beside a known source's namesake", async () => {
    const { files, imports } = pointing("test/behavior.test.ts");
    const known: CatchUpFile = { path: "src/c.test.ts", ms: 900, imports: ["src/c.ts"] };
    const { side } = await started([...files, known], {}, [NEW, "src/c.ts"]);
    repoint(imports);
    const result = await editAndRun(side, NEW, "src/c.ts");
    expectCut(result, [...files, known], []);
    expect(result.catchUpPaths).toEqual([]);
  });
});
