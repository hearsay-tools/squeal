import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { failures } from "./compare.js";
// The validity path's entries, statically, so a change to one re-runs this file (`compare.test.ts`).
import "./driver.js";
import { comparisons, edited, only, SLOW } from "./self-test.js";
import { ROOT } from "./trees.js";

/*
 * Risk 4 of task 011-37 (design section 6, amended 2026-10-20): a decision
 * of acceptance that lands where no entry reaches it changes what is
 * stored or accepted with no alarm. Each decision here is mutated once:
 * the alarm must fire and the changed line must run in a case. A store
 * decision that refuses what the last release stores fails the comparison
 * as a raise. Under D1 (a) both compared accept decisions are the
 * candidate's, so an overlay on the accept rule, the held fail or the
 * states cannot fail it: a weakened accept rule is risk 5's, caught by the
 * scheduler's tests. Each test fails while no entry reaches its decision.
 */

const { compare, release } = comparisons();

describe("each decision reaches the alarm (risk 4)", SLOW, () => {
  it.each([
    [
      "the accept rule holds no fail",
      () =>
        edited(
          "src/core/scheduler/accept.ts",
          "const held = heldFailure(store, worktreeId, hits) !== undefined;",
          "const held = false;",
        ),
    ],
    [
      "the held fail holds none",
      () =>
        edited(
          "src/core/state/inherited.ts",
          "return foreign.find((r) => confirmed.get(checkIdentity(r.check)) !== r.key);",
          "return undefined;",
        ),
    ],
    [
      "the states a fail gives carry no fingerprint",
      () =>
        edited(
          "src/core/state/derive.ts",
          "const fingerprint = failed ? (result.fingerprint ?? fallback?.fingerprint ?? null) : null;",
          "const fingerprint = null;",
        ),
    ],
  ])("fires and runs the changed line when %s, and cannot fail it (D1 (a))", async (_, overlay) => {
    const result = await compare(overlay(), only("accept"));
    expect(result.fired).toBe(true);
    expect(result.uncovered).toEqual([]);
    expect(result.cases.every((c) => c.outputsEqual)).toBe(true);
    expect(failures(result, release())).toEqual([]);
  });

  it("fails when the store decision withholds a stable completed file", async () => {
    const result = await compare(
      edited(
        "src/core/scheduler/store-decision.ts",
        'if (growth === undefined) return { kind: "store", at: "ran", current: file.key === key };',
        'if (growth === undefined) return { kind: "withheld" };',
      ),
      only("store"),
    );
    expect(result.fired).toBe(true);
    expect(result.uncovered).toEqual([]);
    expect(failures(result, release())).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^store case "every per-file outcome of a completed tier": .* raise KEY_FORMAT_VERSION/,
        ),
      ]),
    );
  });

  it("fails when the barrier withholds every file of a touched tier (011-47)", async () => {
    const result = await compare(
      edited(
        "src/core/scheduler/stability.ts",
        "const barred = files.filter((ran) => touchedOf(ran).length > 0);",
        "const barred = touched.length === 0 ? [] : [...files];",
      ),
      only("store"),
    );
    expect(result.fired).toBe(true);
    expect(result.uncovered).toEqual([]);
    const differing = result.cases.filter((c) => !c.outputsEqual).map((c) => c.name);
    expect(differing).toEqual([
      "a touch of one file's input (013-01 test 11, T1)",
      "the same touch on the run once more (013-01 test 11, T2)",
    ]);
    expect(failures(result, release())).toHaveLength(2);
  });
});

/** Every `.ts` file under `src/`, repository-relative. */
function sources(): string[] {
  return readdirSync(join(ROOT, "src"), { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".ts"))
    .map((path) => `src/${path.split("\\").join("/")}`);
}

// Risk 4's scan, as the guard's SEAMS scanned imports: a module that writes rows is a decision.
it("finds no module but store-results.ts and accept.ts writing a result row", () => {
  const writers = sources().filter((path) => {
    const text = readFileSync(join(ROOT, path), "utf8");
    if (path.startsWith("src/core/store/")) return /\bINTO results\b/.test(text);
    return /\.(?:putMany|copyNewest)\(/.test(text);
  });
  expect(writers.sort()).toEqual([
    "src/core/scheduler/accept.ts",
    "src/core/scheduler/store-results.ts",
    "src/core/store/repos/results.ts",
  ]);
});
