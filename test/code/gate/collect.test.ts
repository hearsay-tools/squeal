import { describe, expect, it } from "vitest";
import {
  type CollectOptions,
  CollectUsageError,
  collectEvidence,
} from "../../../src/core/code/gate/collect.js";
import { FILE_ERROR } from "../../../src/core/code/gate/evidence.js";
import { gitHashObject } from "../../hash/git-repo.js";
import {
  ADAPTERS,
  changedSet,
  NO_ADAPTERS,
  ownTmpdir,
  project,
  SLOW,
  status,
} from "./collect-fixture.js";
import { quiet } from "./host-load.js";

/*
 * Spec 020 D3 (row 020-03): the one-shot collector selects the test files
 * whose import closure loads a changed source, every changed test file and
 * the `--test` files, runs them with Squeal's coverage provider and no
 * daemon, and keeps each completed file's record. Nothing is written to the
 * project, and its temporary files are removed.
 */

/** Row 020-54: below the rerun's load threshold, so the failing files run once whatever the host. */
const options = (tests: readonly string[] = []): CollectOptions => ({
  tests,
  budgetSeconds: 600,
  adapters: ADAPTERS,
  hostLoad: quiet,
});

const summary = (files: readonly { runner: string; path: string; completed: boolean }[]) =>
  files.map((f) => [f.runner, f.path, f.completed]);

const sourcesOf = (file: { record: { sources: readonly { path: string }[] } | null } | undefined) =>
  file?.record?.sources.map((s) => s.path);

describe("collectEvidence: selection (spec 020 D3.1)", () => {
  it(
    "runs only the test file that loads the changed source, and its record holds it",
    SLOW,
    async () => {
      const root = project("selection");
      const before = status(root);
      const leftInTmp = ownTmpdir();
      const evidence = await collectEvidence(
        root,
        await changedSet(root, ["src/changed.ts"]),
        options(),
      );
      expect(evidence.timedOut).toBe(false);
      expect(evidence.budgetSeconds).toBe(600);
      expect(summary(evidence.testFiles)).toEqual([["vitest", "test/loads.test.ts", true]]);
      const [file] = evidence.testFiles;
      expect(file?.failed).toEqual([]);
      expect(file?.loads).toContain("src/changed.ts");
      expect(file?.loads).not.toContain("src/other.ts");
      const source = file?.record?.sources.find((s) => s.path === "src/changed.ts");
      expect(source?.blob).toBe(gitHashObject(root, "src/changed.ts"));
      // D3.5: nothing written to the project, nothing left under $TMPDIR.
      expect(status(root)).toBe(before);
      expect(leftInTmp()).toEqual([]);
    },
  );

  it("selects no test file for a source no test loads", SLOW, async () => {
    const root = project("selection");
    const changed = await changedSet(root, ["src/orphan.ts"]);
    const evidence = await collectEvidence(root, changed, options());
    expect(evidence).toEqual({ testFiles: [], timedOut: false, budgetSeconds: 600 });
  });

  it("adds the --test files to what the changed sources select", SLOW, async () => {
    const root = project("selection");
    const changed = await changedSet(root, ["src/changed.ts"]);
    const evidence = await collectEvidence(root, changed, options(["test/other.test.ts"]));
    expect(summary(evidence.testFiles)).toEqual([
      ["vitest", "test/loads.test.ts", true],
      ["vitest", "test/other.test.ts", true],
    ]);
    expect(sourcesOf(evidence.testFiles[1])).toContain("src/other.ts");
  });
});

describe("collectEvidence: failures (spec 020 D3, D5 test-failed)", () => {
  it("names each failed test of a completed file, and keeps its record", SLOW, async () => {
    const root = project("selection");
    const evidence = await collectEvidence(
      root,
      await changedSet(root, ["src/fails.ts"]),
      options(),
    );
    expect(summary(evidence.testFiles)).toEqual([["vitest", "test/fails.test.ts", true]]);
    expect(evidence.testFiles[0]?.failed).toEqual(["half > is wrong"]);
    expect(sourcesOf(evidence.testFiles[0])).toContain("src/fails.ts");
  });

  it("names a file that throws at import as a file-level failure", SLOW, async () => {
    const root = project("selection");
    const evidence = await collectEvidence(
      root,
      await changedSet(root, ["src/broken.ts"]),
      options(),
    );
    expect(summary(evidence.testFiles)).toEqual([["vitest", "test/broken.test.ts", true]]);
    expect(evidence.testFiles[0]?.failed).toEqual([FILE_ERROR]);
  });
});

describe("collectEvidence: nothing to run", () => {
  it("starts no adapter with no changed function and no --test file", async () => {
    const changed = await changedSet(project("selection"), []);
    const evidence = await collectEvidence("/nowhere", changed, {
      tests: [],
      budgetSeconds: 600,
      adapters: NO_ADAPTERS,
    });
    expect(evidence).toEqual({ testFiles: [], timedOut: false, budgetSeconds: 600 });
  });
});

describe("collectEvidence: usage (spec 020 D3.1)", () => {
  it("rejects --test paths no runner lists as a test file", SLOW, async () => {
    const root = project("selection");
    const changed = await changedSet(root, ["src/changed.ts"]);
    const error = await collectEvidence(
      root,
      changed,
      options(["src/other.ts", "test/none.test.ts"]),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CollectUsageError);
    expect((error as Error).message).toBe(
      "--test src/other.ts, test/none.test.ts: no Vitest or node:test project lists them as a test file",
    );
  });
});
