import { describe, expect, it } from "vitest";
import { CASES } from "./cases/index.js";
import { failures, wordingChanges } from "./compare.js";
// The validity path's entries and the harness, statically: esbuild reads them in a process no
// recorder sees (011 C12), so this import is what re-runs this file when one of them changes.
import "./driver.js";
import { comparisons, edited, lineOf, only, read, SLOW } from "./self-test.js";

/*
 * Task 011-39 (011 C3, task 011-37 sections 3 and 6): the candidate against
 * the last release, read from its tag with `git archive` into a temporary
 * directory. The self-tests compare this checkout with itself under an
 * overlay, a change unmade, so they hold whatever the checkout changed since
 * the release. The bundles import the validity path through `driver.ts`,
 * which this file's closure holds, so Squeal re-runs it when one changes.
 */

const { compare, release, tree } = comparisons();

/** A wording-only change: it fires the comparison and moves no output. */
const reworded = () =>
  edited(
    "src/core/state/fingerprint.ts",
    '"error after its tests ran: "',
    '"error once its tests ran: "',
  );

describe("the candidate against the last release", SLOW, () => {
  it("keeps every stored meaning, or raises", async () => {
    const result = await compare({}, CASES, tree());
    expect(failures(result, release())).toEqual([]);
  });

  it("runs every case at the release's tree and at the candidate", async () => {
    const result = await compare(reworded(), CASES, tree());
    expect(result.fired).toBe(true);
    const thrown = result.cases.flatMap((c) =>
      [c.baseline.error, c.candidate.error].flatMap((e) =>
        e === undefined ? [] : [`${c.name}: ${e}`],
      ),
    );
    expect(thrown).toEqual([]);
  });
});

describe("the comparison, under a change unmade", SLOW, () => {
  it("reports differing keys without failing", async () => {
    const path = "src/core/keys/check-key.ts";
    const result = await compare(
      edited(path, '"squeal-check-key/2"', '"squeal-check-key/9"'),
      only("key"),
    );
    expect(result.fired).toBe(true);
    expect(result.cases.filter((c) => c.kind === "key").every((c) => !c.keysEqual)).toBe(true);
    expect(failures(result, release())).toEqual([]);
  });

  it("fails on dropped skip rows (9->10), naming the case and the version to raise", async () => {
    const path = "src/core/scheduler/records.ts";
    const result = await compare(
      edited(path, "if (skipped !== true) return listed;", "if (skipped !== null) return listed;"),
      only("rows"),
    );
    const differing = result.cases.filter((c) => !c.outputsEqual).map((c) => c.name);
    expect(differing).toEqual(["a module skip"]);
    expect(failures(result, release())).toEqual([
      expect.stringMatching(/^rows case "a module skip": .* raise KEY_FORMAT_VERSION/),
    ]);
  });

  it("fails on a changed line no case runs, naming its source line (risk 1)", async () => {
    const path = "src/core/scheduler/records.ts";
    const text = "    durationMs: 0,\n    location,";
    const plain = CASES.filter((c) => c.name === "plain rows");
    const result = await compare(edited(path, text, "    durationMs: 1,\n    location,"), plain);
    expect(result.cases.every((c) => c.outputsEqual)).toBe(true);
    const line = lineOf(path, text.split("\n")[0] ?? "");
    expect(result.uncovered).toEqual([
      expect.stringMatching(`^${path}:${line} \\(baseline`),
      expect.stringMatching(`^${path}:${line} \\(candidate`),
    ]);
    expect(failures(result, release())).toEqual([
      expect.stringContaining(`changed lines no case runs, each needing a case`),
    ]);
  });

  it("passes the same change once a case runs it, and lists the duration with the wording", async () => {
    const path = "src/core/scheduler/records.ts";
    const text = "    durationMs: 0,\n    location,";
    const result = await compare(
      edited(path, text, "    durationMs: 1,\n    location,"),
      only("rows"),
    );
    expect(failures(result, release())).toEqual([]);
    expect(wordingChanges(result)).toEqual(["a load error"]);
  });

  it("passes an unchanged meaning in code only the decisions run, at both trees (review of cand/0.1.228, B1)", async () => {
    const path = "src/core/scheduler/accept.ts";
    const result = await compare(
      edited(
        path,
        "  let hits = store.results.byKey(key, now());",
        "  const clock = now;\n  let hits = store.results.byKey(key, clock());",
      ),
      only("accept"),
    );
    expect(result.fired).toBe(true);
    expect(result.cases.every((c) => c.outputsEqual)).toBe(true);
    expect(result.uncovered).toEqual([]);
    expect(failures(result, release())).toEqual([]);
  });

  it("passes a summary-only change and lists the wording, every kind equal (11->12)", async () => {
    const result = await compare(reworded());
    expect(result.fired).toBe(true);
    expect(failures(result, release())).toEqual([]);
    expect(wordingChanges(result)).toEqual(["an error after the tests ran"]);
  });

  it("fails when the recorder stops recording stat'ed paths, naming its version (risk 2)", async () => {
    const path = "src/runners/observe/fs.cjs";
    const stats = '["stat", "statSync", "lstat", "lstatSync", "exists", "existsSync"]';
    const result = await compare(
      edited(path, `for (const name of ${stats})`, "for (const name of [])"),
    );
    expect(result.fired).toBe(true);
    const differing = result.cases.filter((c) => !c.outputsEqual).map((c) => c.name);
    expect(differing).toEqual(["a stat, a read and a listing"]);
    expect(result.uncovered).toEqual([]);
    expect(failures(result, release())).toEqual([
      expect.stringMatching(
        /^observe case "a stat, a read and a listing": .* raise RECORDER_VERSION/,
      ),
    ]);
  });

  it("reports a raised format's differing cases without failing it, until the alarm (011-41)", async () => {
    const records = "src/core/scheduler/records.ts";
    const format = "src/core/keys/key-format.ts";
    const raised = /KEY_FORMAT_VERSION = (\d+);/.exec(read(format))?.[1];
    const result = await compare({
      ...edited(
        records,
        "if (skipped !== true) return listed;",
        "if (skipped !== null) return listed;",
      ),
      ...edited(
        format,
        `KEY_FORMAT_VERSION = ${raised};`,
        `KEY_FORMAT_VERSION = ${Number(raised) + 1};`,
      ),
    });
    expect(result.versions.candidate).toBe(result.versions.baseline + 1);
    expect(result.cases.filter((c) => !c.outputsEqual).map((c) => c.name)).toEqual([
      "a module skip",
    ]);
    expect(failures(result, release())).toEqual([]);
  });
});
