import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { exportCommand } from "../../src/cli/export.js";
import { importCommand } from "../../src/cli/import.js";
import type { CliIo } from "../../src/cli/main.js";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";
import { formatStatus } from "../../src/core/status/format-status.js";
import { formatWhy } from "../../src/core/status/format-why.js";
import { readStatus } from "../../src/core/status/snapshot.js";
import { readWhy } from "../../src/core/status/why.js";
import { git } from "../hash/git-repo.js";
import { claimRepo, fileName, side } from "../scheduler/claims-fixture.js";

/*
 * Spec 018 D2 to D4 through the commands: `squeal export` in one repository,
 * `squeal import` in another with the same files, and what `status --full`
 * and `why` then say of an imported result.
 */

const COUNT = 3;
const LOOKUP_ONLY = { baseline: { onStart: "lookup-only" as const } };
const SLOW = { timeout: 60_000 } as const;
const NONE = {
  sameKeyKept: 0,
  sameKeyNotAdopted: 0,
  environment: 0,
  closure: 0,
  observed: 0,
  content: 0,
  noKey: 0,
};

function io(cwd: string): CliIo & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    cwd,
    env: {},
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  };
}

/** A repository whose suite ran, and the file `squeal export --out` wrote there. */
async function exported(): Promise<{ file: string; commit: string; text: string }> {
  const { main } = claimRepo(COUNT);
  const a = side(main, { count: COUNT, policy: LOOKUP_ONLY });
  await a.scheduler.start();
  await a.scheduler.requestFullSuite();
  await a.scheduler.idle();
  const run = io(main);
  expect(await exportCommand(["--out", "results.json.gz"], run)).toBe(0);
  return {
    file: join(main, "results.json.gz"),
    commit: git(main, ["rev-parse", "HEAD"]).trim(),
    text: run.out.join(""),
  };
}

describe("squeal export and squeal import (018 D2 to D4)", SLOW, () => {
  it("round trip: status --full and why name the import", async () => {
    const { file, commit, text } = await exported();
    expect(text).toBe(`Exported 3 test files, 6 results, to ${file}.\n`);
    const { main } = claimRepo(COUNT);
    const run = io(main);
    expect(await importCommand([file], run)).toBe(0);
    const source = `local export at ${commit.slice(0, 8)}`;
    expect(run.out.join("")).toBe(
      `Imported 6 results of 3 test files from ${source}.\nAdded where the store had none: 3 closure lists.\n` +
        "Environment: none recorded for this worktree yet; squeal status --full compares them once its daemon keyed the files\n",
    );

    const b = side(main, { count: COUNT, policy: LOOKUP_ONLY });
    await b.scheduler.start();
    await b.scheduler.idle();
    expect(b.runner.runs).toEqual([]);
    const status = formatStatus(readStatus(main), Date.now(), "squeal", { full: true });
    expect(status).toContain(
      `Inherited from other worktrees: none\nImported: 3 of 3 test files current from ${source} (6 current results)\n`,
    );
    expect(readStatus(main)).toMatchObject({
      imports: [{ testFiles: 3, currentFiles: 3, currentResults: 6, notCurrent: NONE }],
    });
    const why = formatWhy(readWhy(main, `${fileName(0)} > passes`));
    expect(why).toContain(`  Origin: Imported PASS from ${source}`);
    expect(why).toContain(`imported from ${source}, revision 0, commit ${commit.slice(0, 7)}`);
    expect(why).toContain("log: none, an imported result has no run log");
    expect(why).toContain(`Run log: none, the result was imported from ${source}`);
  });

  it("after this worktree's daemon keyed its files, the import says the environments are equal", async () => {
    const { file } = await exported();
    const { main } = claimRepo(COUNT);
    const b = side(main, { count: COUNT, policy: LOOKUP_ONLY });
    await b.scheduler.start();
    await b.scheduler.idle();
    const run = io(main);
    expect(await importCommand([file], run)).toBe(0);
    expect(run.out.join("")).toContain("\nEnvironment: equal to this worktree's\n");
    await b.scheduler.handleBatch({ trigger: "interval", paths: [] });
    await b.scheduler.idle();
    expect(b.passing()).toBe(COUNT);
  });

  it("results this worktree ran at the same keys stay its own, and status says so (review B1)", async () => {
    const { file, commit } = await exported();
    const { main } = claimRepo(COUNT);
    const b = side(main, { count: COUNT, policy: LOOKUP_ONLY });
    b.runner.failing.add(fileName(0));
    await b.scheduler.start();
    await b.scheduler.requestFullSuite();
    await b.scheduler.idle();
    expect(await importCommand([file], io(main))).toBe(0);
    await b.scheduler.handleBatch({ trigger: "interval", paths: [] });
    await b.scheduler.idle();
    const snapshot = readStatus(main);
    expect(snapshot).toMatchObject({
      imports: [
        {
          testFiles: 3,
          currentFiles: 0,
          currentResults: 0,
          notCurrent: { ...NONE, sameKeyKept: 3 },
        },
      ],
    });
    const source = `local export at ${commit.slice(0, 8)}`;
    expect(formatStatus(snapshot, Date.now(), "squeal", { full: true })).toContain(
      `Imported: 0 of 3 test files current from ${source} (0 current results)\n  Not current: 3 another result kept at the same key\n`,
    );
    expect(formatStatus(snapshot, Date.now(), "squeal")).not.toContain("Imported");
  });

  it("a dry run writes nothing", async () => {
    const { file } = await exported();
    const { main } = claimRepo(COUNT);
    const run = io(main);
    expect(await importCommand([file, "--dry-run"], run)).toBe(0);
    expect(run.out.join("")).toMatch(/^Dry run, nothing written: would import 6 results/);
    const again = io(main);
    expect(await importCommand([file], again)).toBe(0);
    expect(again.out.join("")).toMatch(/^Imported 6 results/);
  });

  it("refuses an unknown format and another key format, naming both", async () => {
    const { file } = await exported();
    const bundle = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8"));
    const { main } = claimRepo(COUNT);
    const older = join(main, "older.json.gz");
    const header = { ...bundle.header, keyFormat: KEY_FORMAT_VERSION - 1 };
    writeFileSync(older, gzipSync(JSON.stringify({ ...bundle, header })));
    const run = io(main);
    expect(await importCommand([older], run)).toBe(1);
    expect(run.err.join("")).toBe(
      `squeal import: refuses ${older}: the export's key format is ${KEY_FORMAT_VERSION - 1}; this Squeal's is ${KEY_FORMAT_VERSION}\n`,
    );
    const other = join(main, "other.json.gz");
    writeFileSync(other, gzipSync(JSON.stringify({ ...bundle, format: "squeal-results/9" })));
    const second = io(main);
    expect(await importCommand([other], second)).toBe(1);
    expect(second.err.join("")).toContain(
      "unknown format squeal-results/9; this Squeal reads squeal-results/1",
    );
  });

  it("export with no key computed says so and writes nothing", async () => {
    const { main } = claimRepo(COUNT);
    const a = side(main, { count: COUNT, policy: LOOKUP_ONLY });
    a.store.meta.get("x");
    const run = io(main);
    expect(await exportCommand([], run)).toBe(1);
    expect(run.err.join("")).toBe(
      "squeal export: no test file of this worktree has a key yet: the daemon computes keys (squeal start); wrote nothing\n",
    );
  });
});
