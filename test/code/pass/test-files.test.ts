import { describe, expect, it } from "vitest";
import { readRecount } from "../../../src/core/code/pass/cursor.js";
import { WT } from "../../state/helpers.js";
import { COVERED, type CoverageRig, consumer, coverageRig, sourceOf } from "../crap/rig.js";
import { daemonPass } from "./helpers.js";

/*
 * Spec 020 D11.6 (row 020-07b): test files are counted in the daemon, and
 * each test file is its own loader. A new test file is counted at once,
 * with no wait for a runner listing (the 015-52 hold is gone). An upgrade
 * counts them in one `include` recount: one summary line, never a line per
 * function (015 D6).
 */

const TEST = "test/a.test.ts";
const SEED = "test/seed.test.ts";
/** A test file's functions, one over 20. */
const SEED_TEXT = "seeds.<it> 2 s1\nseeds 25 s2\n";
const S1 = consumer("s1");

/** `src/a.ts` and its test file `test/a.test.ts`, counted by the daemon's pass, with S1 registered. */
async function counted() {
  const rig = coverageRig();
  rig.tree.write("src/a.ts", "a 3 a1\n").write(TEST, "cases.<it> 2 t1\n").revise();
  rig.loader(TEST, { closure: ["src/a.ts"] });
  const run = daemonPass(rig.tree, {
    policy: () => COVERED,
    now: () => rig.clock,
    coverage: { main: rig.main, closures: () => rig.closures, writing: () => false },
  });
  await settle(rig, run);
  await rig.register(S1);
  return { rig, run };
}

/** One pass of the daemon's code pass, as a batch nudges it. */
async function settle(rig: CoverageRig, run: ReturnType<typeof daemonPass>) {
  rig.clock += 1_000;
  run.code.nudge();
  await run.code.idle();
}

const rows = (rig: CoverageRig) => rig.store.files.list(WT).map((f) => f.path);
const complexity = (rig: CoverageRig, path: string, name: string) =>
  rig.store.transitions
    .history(WT, { kind: "code", path, qualifiedName: name, occurrence: 0 })
    .filter((t) => t.measure === "complexity")
    .map((t) => t.kind);
/** The lines that name `path`, and the lines of a block whose head names it (row 015-65). */
function naming(lines: readonly string[], path: string): string[] {
  let named = false;
  return lines.filter((l) => {
    if (l.startsWith("- ")) return named;
    named = l.includes(path) && l.endsWith("):");
    return l.includes(path);
  });
}

describe("test files counted in the daemon (spec 020 D11.6)", () => {
  it("tells a test callback an edit adds over 20 as a first-seen fail", async () => {
    const { rig, run } = await counted();
    expect(rows(rig)).toEqual(["src/a.ts", TEST]);
    rig.tree.write(TEST, "cases.<it> 2 t1\ncases.<it> 25 t2\n").revise();
    await settle(rig, run);
    expect(
      rig.store.transitions
        .history(WT, { kind: "code", path: TEST, qualifiedName: "cases.<it>", occurrence: 1 })
        .map((t) => `${t.measure} ${t.kind}`),
    ).toContain("complexity first-seen-fail");
    expect(naming(await rig.told(S1), TEST)).toEqual([
      `FAIL complexity: cases.<it> (occurrence 2) (${TEST}:2) is 25, over 20 (ESLint rule)`,
    ]);
    await run.code.close();
  });

  it("counts a new test file at once, before any runner lists it", async () => {
    const { rig, run } = await counted();
    // Revision 2 brings a test file; no listing names it yet.
    rig.tree.write(SEED, SEED_TEXT).revise();
    await settle(rig, run);
    expect(rows(rig)).toEqual(["src/a.ts", TEST, SEED]);
    expect(complexity(rig, SEED, "seeds")).toEqual(["first-seen-fail"]);
    expect(naming(await rig.told(S1), SEED)).toEqual([
      `FAIL complexity: seeds (${SEED}:2) is 25, over 20 (ESLint rule)`,
    ]);
    // Its runner lists it later: it stays counted, with nothing more told.
    rig.loader(SEED, { closure: [] });
    rig.tree.write("src/a.ts", "a 4 a2\n").revise();
    await settle(rig, run);
    expect(rows(rig)).toEqual(["src/a.ts", TEST, SEED]);
    expect(complexity(rig, SEED, "seeds")).toEqual(["first-seen-fail"]);
    expect(naming(await rig.told(S1), SEED)).toEqual([]);
    await run.code.close();
  });
});

describe("a test file is its own loader (spec 020 D11.6)", () => {
  it("judges a test callback from its own file's record", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": "a 3 a1\n", [TEST]: "cases.<it> 4 t1\nhelper 6 t2\n" });
    const blob = rig.store.files.list(WT, [TEST])[0]?.blob ?? "";
    rig.loader(TEST, {
      closure: ["src/a.ts"],
      record: [sourceOf(TEST, blob, 2, [1])],
    });
    rig.step();
    // `cases.<it>` ran: CRAP is its CC; `helper` did not: 6² + 6 = 42.
    expect(
      rig.store.states
        .list(WT, { paths: [TEST], measure: "crap" })
        .map((s) => `${s.check.qualifiedName} ${s.outcome} ${s.value}`),
    ).toEqual(["cases.<it> pass 4", "helper fail 42"]);
    expect(
      rig.store.states
        .list(WT, { paths: [TEST], measure: "uncovered" })
        .map((s) => `${s.check.qualifiedName} ${s.outcome}`),
    ).toEqual(["cases.<it> pass", "helper fail"]);
  });
});

describe("the upgrade that counts test files (spec 020 D11.6)", () => {
  it("recounts once, as an include change, with one summary line and no line per function", async () => {
    const { rig, run } = await counted();
    await run.code.close();
    // The store an older daemon left: its cursor has no counting rules, and it never counted the test file.
    rig.store.files.removeMany(WT, [TEST]);
    rig.store.states.removeMany(
      WT,
      rig.store.states.list(WT, { paths: [TEST] }).map((s) => s.check),
    );
    const key = `pass:${WT}`;
    const { rules: _, ...older } = JSON.parse(rig.store.meta.get(key) ?? "{}") as Record<
      string,
      unknown
    >;
    rig.store.meta.set(key, JSON.stringify(older));
    rig.tree.write(TEST, SEED_TEXT).revise();
    // Its record ran `seeds.<it>`, not `seeds`: CRAP and untested fail there once coverage judges it.
    rig.loader(TEST, {
      closure: ["src/a.ts"],
      key: "key-upgraded",
      record: [sourceOf(TEST, rig.tree.source.file(TEST)?.hash ?? "", 2, [1])],
    });
    const next = daemonPass(rig.tree, {
      policy: () => COVERED,
      now: () => rig.clock,
      coverage: { main: rig.main, closures: () => rig.closures, writing: () => false },
    });
    await settle(rig, next);
    expect(next.reports.map((r) => `${r.mode} ${r.transitions}`)).toEqual(["include 0"]);
    expect(readRecount(rig.store.meta, WT)?.reason).toBe("include");
    expect(rows(rig)).toEqual(["src/a.ts", TEST]);
    expect(complexity(rig, TEST, "seeds")).toEqual([]);
    expect(
      rig.store.states
        .list(WT, { paths: [TEST] })
        .filter((s) => s.check.qualifiedName === "seeds")
        .map((s) => `${s.measure} ${s.outcome}`)
        .sort(),
    ).toEqual(["complexity fail", "crap fail", "uncovered fail"]);
    expect(rig.transitions(TEST, ["seeds.<it>", "seeds"])).toEqual([]);
    const told = await rig.told(S1);
    expect(naming(told, TEST)).toEqual([]);
    expect(told).toContain(
      "Complexity counted again, the included files changed: 1 function over 20; squeal code lists them.",
    );
    // The next pass follows the revisions: the recount is not made again.
    rig.tree.write("src/a.ts", "a 4 a2\n").revise();
    await settle(rig, next);
    expect(next.reports.map((r) => r.mode)).toEqual(["include", "edit"]);
    await next.code.close();
  });
});
