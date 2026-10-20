import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Case, CaseKind } from "./case.js";
import { CASES } from "./cases/index.js";
import { compareTrees, failures, wordingChanges } from "./compare.js";
import { extractTree, lastRelease, type Overlay, ROOT } from "./trees.js";

/*
 * Task 011-39 (011 C3, task 011-37 sections 3 and 6): the candidate against
 * the last release, read from its tag with `git archive` into a temporary
 * directory. The self-tests compare the last release with this checkout under
 * an overlay, a change unmade. The bundles import the validity path through
 * `driver.ts`, which this file's closure holds, so Squeal re-runs it when one
 * of them changes.
 */

let work: string;
let release: string;
let tree: string;
let runs = 0;

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "squeal-validity-"));
  release = lastRelease();
  tree = join(work, "release");
  extractTree(release, tree);
});

afterAll(() => {
  if (work !== undefined) rmSync(work, { recursive: true, force: true });
});

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** `path` with `from` replaced by `to`, which must apply. */
function edited(path: string, from: string, to: string): Overlay {
  const before = read(path);
  expect(before, `the edit of ${path} no longer applies`).toContain(from);
  return { [path]: before.replace(from, to) };
}

/** The 1-based line of `path` holding `text`. */
const lineOf = (path: string, text: string) =>
  read(path)
    .split("\n")
    .findIndex((line) => line.includes(text)) + 1;

const compare = (overlay: Overlay, cases: readonly Case[] = CASES) =>
  compareTrees({ baseline: tree, cases, overlay, work: join(work, `run-${runs++}`) });

/** The corpus's cases of `kinds`: a self-test runs the kinds its change reaches. */
const only = (...kinds: CaseKind[]) => CASES.filter((c) => kinds.includes(c.kind));

// A full comparison bundles twice and runs the corpus in four child processes.
const SLOW = { timeout: 120_000 };

describe("the candidate against the last release", SLOW, () => {
  it("keeps every stored meaning, or raises", async () => {
    const result = await compare({});
    expect(failures(result, release)).toEqual([]);
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
    expect(failures(result, release)).toEqual([]);
  });

  it("fails on dropped skip rows (9->10), naming the case and the version to raise", async () => {
    const path = "src/core/scheduler/records.ts";
    const result = await compare(
      edited(path, "if (skipped !== true) return listed;", "if (skipped !== null) return listed;"),
      only("rows"),
    );
    const differing = result.cases.filter((c) => !c.outputsEqual).map((c) => c.name);
    expect(differing).toEqual(["a module skip"]);
    expect(failures(result, release)).toEqual([
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
    expect(failures(result, release)).toEqual([
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
    expect(failures(result, release)).toEqual([]);
    expect(wordingChanges(result)).toEqual(["a load error"]);
  });

  it("passes a summary-only change and lists the wording, every kind equal (11->12)", async () => {
    const path = "src/core/state/fingerprint.ts";
    const result = await compare(
      edited(path, '"error after its tests ran: "', '"error once its tests ran: "'),
    );
    expect(result.fired).toBe(true);
    expect(failures(result, release)).toEqual([]);
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
    expect(failures(result, release)).toEqual([
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
    expect(failures(result, release)).toEqual([]);
  });
});
