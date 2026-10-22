import { describe, expect, it } from "vitest";
import { CASES } from "./cases/index.js";
import { failures, reportedChanges, wordingChanges } from "./compare.js";
// The validity path's entries and the harness, statically: esbuild reads them in a process no
// recorder sees (011 C12), so this import is what re-runs this file when one of them changes.
import "./driver.js";
import { comparisons, edited, FULL, lineOf, only, pythonsReady, read, SLOW } from "./self-test.js";

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

describe("the candidate against the last release", FULL, () => {
  it("runs every case at the release's tree and at the candidate", async () => {
    // An emitted line in each adapter with cases too, so they run whatever the release holds.
    const ran = (path: string) => ({ [path]: `${read(path)}export const validityRun = 1;\n` });
    const adapters = {
      ...ran("src/runners/vitest/adapter.ts"),
      ...ran("src/runners/pytest/adapter.ts"),
    };
    // Without uv's Pythons, off CI, the pytest cases are left out (`pythonsReady`).
    const cases = pythonsReady() ? CASES : CASES.filter((c) => c.kind !== "adapter:pytest");
    const result = await compare({ ...reworded(), ...adapters }, cases, tree());
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

  it("reports a file the candidate stores and the last release withheld, without failing (17->18)", async () => {
    const result = await compare(
      edited(
        "src/core/scheduler/stability.ts",
        "const barred = files.filter((ran) => touchedOf(ran).length > 0);",
        "const barred = files.filter(() => false);",
      ),
      only("store"),
    );
    expect(result.cases.every((c) => c.outputsEqual)).toBe(true);
    expect(failures(result, release())).toEqual([]);
    expect(reportedChanges(result)).toEqual([
      expect.stringMatching(
        /T1\)": test\/slow1.test.ts: requeue .*, store at ran:.* \(the candidate stores more\)$/,
      ),
      expect.stringMatching(
        /T2\)": test\/slow1.test.ts: unknown .*, store at ran:.* \(the candidate stores more\)$/,
      ),
    ]);
  });

  it("reports a file stored under another key as a re-key, without failing", async () => {
    const result = await compare(
      edited(
        "src/core/scheduler/store-decision.ts",
        'if (growth === undefined) return { kind: "store", at: "ran", current: file.key === key };',
        'if (growth === undefined) return { kind: "store", at: "grown", current: file.key === key };',
      ),
      only("store"),
    );
    expect(result.cases.every((c) => c.outputsEqual)).toBe(true);
    expect(failures(result, release())).toEqual([]);
    expect(reportedChanges(result)).toContainEqual(
      expect.stringMatching(
        /test\/stored.test.ts: store at ran:.*, store at moved:.* \(a re-key\)$/,
      ),
    );
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

  /** The format raised by one, with the formats read as one left as they are or emptied. */
  const raised = (emptied: boolean) => {
    const format = "src/core/keys/key-format.ts";
    const value = Number(/KEY_FORMAT_VERSION = (\d+);/.exec(read(format))?.[1]);
    const text = read(format).replace(
      `KEY_FORMAT_VERSION = ${value};`,
      `KEY_FORMAT_VERSION = ${value + 1};`,
    );
    const list = /(KEY_FORMATS_READ_AS_ONE[^=]*= )\{[^}]*\}/;
    return { [format]: emptied ? text.replace(list, "$1{}") : text };
  };
  const skipRows = () =>
    edited(
      "src/core/scheduler/records.ts",
      "if (skipped !== true) return listed;",
      "if (skipped !== null) return listed;",
    );

  it("passes a raised format with a case whose outputs differ and no format read as one (D6)", async () => {
    const result = await compare({ ...skipRows(), ...raised(true) }, only("rows"));
    const global = result.alarms.find((a) => a.component.name === "global");
    expect(Number(global?.versions.candidate)).toBe(Number(global?.versions.baseline) + 1);
    expect(result.cases.filter((c) => !c.outputsEqual).map((c) => c.name)).toEqual([
      "a module skip",
    ]);
    expect(failures(result, release())).toEqual([]);
  });

  it("fails a raise no case's outputs differ (D6)", async () => {
    const result = await compare({ ...reworded(), ...raised(true) }, only("rows"));
    expect(result.fired).toBe(true);
    expect(failures(result, release())).toEqual([
      expect.stringMatching(
        /^KEY_FORMAT_VERSION .* moved from \d+ at .* a raise needs a case whose outputs differ/,
      ),
    ]);
  });

  it("fails a raised format that leaves formats read as one (risk 6)", async () => {
    const result = await compare({ ...skipRows(), ...raised(false) }, only("rows"));
    expect(failures(result, release())).toEqual([
      expect.stringMatching(
        /^KEY_FORMAT_VERSION moved for a change of stored meaning, .* empty KEY_FORMATS_READ_AS_ONE, which lists 13, /,
      ),
    ]);
  });
});
