import { appendFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRepo, openHarness, openRepoStore } from "./helpers.js";

/*
 * Lessons, defect 19: after an environment change the queue held the whole
 * suite, and D5's order put the agent's new test file behind every known
 * failure of the backlog. Spec 001 D5 step 4 as amended (task 001-100): work
 * an edit caused runs ahead of the baseline, an environment change or
 * `run --all` at the next tier boundary.
 *
 * 200 test files, each importing its own module. 199 fail, so after the
 * config edit every one of them is a last known fail, the most urgent class;
 * `test/f123.test.ts` passes, and without the amendment its edit would run
 * it after all 199.
 */
const COUNT = 200;
const EDITED = 123;
const pad = (n: number) => String(n).padStart(3, "0");

describe("scheduler: an edit runs ahead of an environment change's backlog (D5, defect 19)", () => {
  it("runs the edited module's test file at the next tier boundary, before 190 of 200 queued files", {
    timeout: 300_000,
  }, async () => {
    const repo = createRepo("barrel-only");
    const at = (path: string) => join(repo.main, path);
    rmSync(at("test/aa-slow.test.ts"));
    rmSync(at("test/zz-fast.test.ts"));
    for (let i = 0; i < COUNT; i++) {
      writeFileSync(at(`src/m${pad(i)}.ts`), `export const value = ${i};\n`);
      writeFileSync(
        at(`test/f${pad(i)}.test.ts`),
        [
          `import { expect, it } from "vitest";`,
          `import { value } from "../src/m${pad(i)}.ts";`,
          `it("holds", () => expect(value).toBe(${i === EDITED ? i : -1}));`,
          "",
        ].join("\n"),
      );
    }
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, { tierSize: 4 });
    await h.scheduler.start();
    await h.scheduler.idle();
    const baseline = h.runner.runs.length;
    expect(h.runner.runs.flatMap((r) => r.files)).toHaveLength(COUNT);

    // An environment change: every key moves, all 200 files are queued again.
    appendFileSync(`${h.root}/vitest.config.ts`, "// environment change\n");
    let edited = false;
    h.runner.beforeRun = () => {
      if (edited) return;
      edited = true;
      // The agent edits while the backlog's first tier runs.
      h.write(`src/m${pad(EDITED)}.ts`, `export const value = ${EDITED}; // edited\n`);
      void h.batch(`src/m${pad(EDITED)}.ts`);
    };
    await h.batch("vitest.config.ts");
    await h.scheduler.idle();

    const order = h.runner.runs.slice(baseline).flatMap((r) => r.files.map((f) => f.path));
    const position = order.indexOf(`test/f${pad(EDITED)}.test.ts`);
    const after = new Set(order.slice(position + 1)).size;
    // Measured for the board (task 001-100): the edited file's place in the backlog.
    console.log(
      `001-100: test/f${pad(EDITED)}.test.ts ran at position ${position + 1} of ${order.length}, before ${after} queued files`,
    );
    expect(new Set(order).size).toBe(COUNT);
    expect(after).toBeGreaterThanOrEqual(190);
  });
});
