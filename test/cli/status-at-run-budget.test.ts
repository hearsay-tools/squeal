import { describe, expect, it } from "vitest";
import { fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { result } from "../store/helpers.js";
import { check, clean, run, testOf, withStore } from "./status-at-kit.js";

/*
 * Row 023-19 (lessons P3) on `$TMPDIR` git fixtures with the real Vitest
 * adapter. In the dogfood, `--run` ran 1,338 files as one gate run, which
 * outlived its budget; the parent killed it 60 s later and no result was
 * kept or reported. Here a Vitest `globalTeardown` holds the gate's close
 * once `z.test.ts` ran, as a run that cannot end in time does. The files
 * of an earlier batch are kept and reported, the command ends at its
 * budget, the held batch's file is read at its key (the gate kept it as
 * its run ended), and a file no batch started reads `not run (budget)`.
 */

const A1 = ref("test/a1.test.ts");
const A2 = ref("test/a2.test.ts");
const Z = ref("test/z.test.ts");
const ZZ = ref("test/zz.test.ts");

/** A global setup whose teardown holds for 10 minutes once `z.test.ts` marked that it ran. */
const HOLD = [
  'import { existsSync } from "node:fs";',
  'import { tmpdir } from "node:os";',
  'import { join } from "node:path";',
  "export default function setup() {",
  "  return () =>",
  '    existsSync(join(tmpdir(), "z-ran")) ? new Promise((done) => setTimeout(done, 600_000)) : undefined;',
  "}",
  "",
].join("\n");

const MARK_TEST = [
  'import { writeFileSync } from "node:fs";',
  'import { tmpdir } from "node:os";',
  'import { join } from "node:path";',
  'import { expect, it } from "vitest";',
  'import { value } from "../src/a";',
  'it("marks", () => {',
  '  writeFileSync(join(tmpdir(), "z-ran"), "");',
  "  expect(value).toBe(2);",
  "});",
  "",
].join("\n");

/** Commit A, and HEAD changing `src/a.ts`, which all three tests read. */
function held() {
  const f = fixture({
    "squeal.config.json": "{}\n",
    "vitest.config.mjs":
      'export default { test: { include: ["test/**/*.test.ts"], globalSetup: ["./hold.mjs"] } };\n',
    "hold.mjs": HOLD,
    "src/a.ts": "export const value = 2;\n",
    [A1.path]: testOf("a", 2),
    [A2.path]: testOf("a", 2),
    [Z.path]: MARK_TEST,
    [ZZ.path]: testOf("a", 2),
  });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 2; // b\n" });
  return { f, a };
}

type JsonFile = { path: string; at: { state: string; reason?: string; origin?: object } };
const at = (out: string, path: string) =>
  (JSON.parse(out).files as JsonFile[]).find((x) => x.path === path)?.at;

describe("status --at --run at its budget (row 023-19, P3)", SLOW, () => {
  it("keeps and reports a batch that completed, and ends at the budget when a later one cannot", async () => {
    const { f, a } = held();
    const budget = 45;
    // Row 023-29: the commit side only, which this test holds at its budget.
    const options = {
      cacheRoot: f.cacheRoot,
      install: linkInstall().install,
      batchFiles: 1,
      workingTree: false,
    } as const;
    const ran = await run(
      f,
      { commit: a, json: true, run: { allMissing: false, timeoutSeconds: budget } },
      options,
    );
    expect(ran.code).toBe(3);
    const value = JSON.parse(ran.out);
    // Z's run ended and was kept before its close held: read at its key, not lost to the stop.
    for (const path of [A1.path, A2.path, Z.path])
      expect(at(ran.out, path)).toMatchObject({
        state: "pass",
        origin: { kind: "run", stored: true },
      });
    expect(at(ran.out, ZZ.path)).toEqual({ state: "not run", reason: "budget" });
    expect(value.run).toMatchObject({ selected: 4, ran: 3, stored: 3, notRun: 1, timedOut: true });
    // The hard stop: at the budget, not a minute past it.
    expect(value.run.usedMs).toBeLessThan((budget + 10) * 1000);
    expect(value.run.rerun).toMatch(/^squeal status --at [0-9a-f]+ --run --timeout \d+$/);
    clean(f);

    // The kept files are the commit's results for the next call.
    const next = await run(f, { commit: a, json: true });
    expect(at(next.out, A1.path)).toMatchObject({ state: "pass" });
    expect(at(next.out, A2.path)).toMatchObject({ state: "pass" });
    expect(at(next.out, Z.path)).toMatchObject({ state: "pass" });
    expect(at(next.out, ZZ.path)).toMatchObject({ state: "no result" });
    clean(f);
  });

  it("tells the estimate and how to narrow it before a selection over half the budget", async () => {
    const { f, a } = held();
    withStore(f, (store) =>
      store.results.putMany(
        [A1, A2].map((file) => ({ ...result(check(file.path), "elsewhere"), durationMs: 900_000 })),
      ),
    );
    const cut = await run(f, { commit: a, run: { allMissing: false, timeoutSeconds: 3 } });
    expect(cut.err).toMatch(
      new RegExp(
        `squeal: --run: 4 test files with no result at ${a.slice(0, 9)} to run, up to \\d+ at once: about \\d+ s from the stored durations of 2 \\(the others at their median\\); the budget is 3 s, the checkout and install included; to narrow it, name test files or folders: squeal status --at ${a} <path>\\.\\.\\. --run\n`,
      ),
    );
    // Row 023-29 (R4): 900 s each, stored: no rerun up to the cap fits, so none is offered.
    expect(cut.out).toMatch(
      /\n8 not run \(budget: 4 at [0-9a-f]{9}, 4 now\); from their stored durations they need about \d+ (min|h)/,
    );
    expect(cut.out).not.toContain("A rerun that fits");
    clean(f);
  });
});
