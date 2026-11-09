import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { exportCommand } from "../../src/cli/export.js";
import { importCommand } from "../../src/cli/import.js";
import type { CliIo } from "../../src/cli/main.js";
import { addMissingEntries, observedMetaKey } from "../../src/core/keys/observed.js";
import { readStatus } from "../../src/core/status/snapshot.js";
import { git } from "../hash/git-repo.js";
import { claimRepo, fileName, type Side, side } from "../scheduler/claims-fixture.js";

/*
 * Spec 018 D10 and D11 through the commands: an export made with `CI=true`
 * (Vitest's CI fields) at one commit, imported into a clone of that commit
 * whose store's observed union holds a path the export's lists lack, as a
 * busy store's does (`research/import-trial.md` count 2). Each file is
 * current where its content equals the export's, and only there.
 */

const COUNT = 3;
const EXTRA = "src/extra.ts";
const LOOKUP_ONLY = { baseline: { onStart: "lookup-only" as const } };
const SLOW = { timeout: 60_000 } as const;

/** A developer's resolved Vitest config, and CI's (`research/ci-step.md` 3). */
const HERE = {
  allowOnly: true,
  browser: { enabled: false, headless: false, screenshotFailures: false, ui: true },
  coverage: { provider: "squeal", version: 3 },
  root: "<root>",
};
const CI = {
  ...HERE,
  allowOnly: false,
  browser: { enabled: false, headless: true, screenshotFailures: true, ui: false },
  coverage: { enabled: false, provider: "v8" },
  watch: false,
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

/** The fake runner of `s` as a Vitest project resolved to `config`. */
function vitest(s: Side, config: object): Side {
  s.runner.environment = async () => [
    {
      project: "",
      runnerName: "vitest",
      runnerVersion: "4.1.10",
      adapterVersion: "1",
      resolvedConfig: JSON.stringify(config),
      files: [],
    },
  ];
  return s;
}

/** CI's run in a repository of `COUNT` files and `EXTRA`, exported; the file and the repository. */
async function ciExport(): Promise<{ file: string; repo: string }> {
  const { main } = claimRepo(COUNT, { [EXTRA]: "export const extra = 1;\n" });
  const ci = vitest(side(main, { count: COUNT, policy: LOOKUP_ONLY }), CI);
  await ci.scheduler.start();
  await ci.scheduler.requestFullSuite();
  await ci.scheduler.idle();
  expect(await exportCommand(["--out", "results.json.gz"], io(main))).toBe(0);
  return { file: join(main, "results.json.gz"), repo: main };
}

/**
 * What the clone's observed union adds to the first test file's list: a
 * file, the listing of a directory the commit holds and of one it does not.
 */
const UNION = [EXTRA, "src/", "test/", "gen/"];

/**
 * A clone of `repo` with a store of its own, whose observed union holds
 * `UNION` for the first test file, resolved to `config`; `edit` changes
 * files before its daemon starts. The daemon keyed its files and ran none.
 */
async function developer(
  repo: string,
  options: { edit?: Record<string, string>; config?: object } = {},
): Promise<Side> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "squeal-rekey-")));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const main = join(dir, "main");
  git(dir, ["clone", "-q", repo, main]);
  for (const [path, text] of Object.entries(options.edit ?? {})) {
    writeFileSync(join(main, path), text);
  }
  const dev = vitest(side(main, { count: COUNT, policy: LOOKUP_ONLY }), options.config ?? HERE);
  dev.store.transaction(() =>
    addMissingEntries(dev.store, observedMetaKey(""), { [fileName(0)]: UNION }),
  );
  await dev.scheduler.start();
  await dev.scheduler.idle();
  expect(dev.runner.runs).toEqual([]);
  return dev;
}

async function imported(dev: Side, file: string): Promise<string> {
  const run = io(dev.root);
  expect(await importCommand([file], run)).toBe(0);
  await dev.scheduler.handleBatch({ trigger: "interval", paths: [] });
  await dev.scheduler.idle();
  return run.out.join("");
}

describe("squeal import re-keys a CI export (018 D10, D11)", SLOW, () => {
  it("makes every file current at the export's content, the union's extra path and CI's fields aside", async () => {
    const { file, repo } = await ciExport();
    const dev = await developer(repo);
    const before = dev.keyOf(fileName(0));
    const out = await imported(dev, file);
    expect(out).toContain("Re-keyed 3 of 3 test files");
    expect(out).toContain(
      "Environment: equal to this worktree's for imported passes; config fields allowOnly, browser, coverage, watch differ",
    );
    expect(dev.passing()).toBe(COUNT);
    expect(dev.runner.runs).toEqual([]);
    expect(dev.keyOf(fileName(0))).toBe(before);
    expect(readStatus(dev.root)).toMatchObject({
      imports: [{ testFiles: 3, currentFiles: 3, currentResults: 6 }],
    });
  });

  for (const [name, edit] of [
    ["a file", { [EXTRA]: "export const extra = 2;\n" }],
    ["a listed directory", { "src/added.ts": "export {};\n" }],
  ] as const) {
    it(`leaves a file not current where ${name} of its list differs from the export's commit`, async () => {
      const { file, repo } = await ciExport();
      const dev = await developer(repo, { edit });
      await imported(dev, file);
      expect(dev.passing()).toBe(COUNT - 1);
      expect(readStatus(dev.root)).toMatchObject({
        imports: [{ currentFiles: 2, notCurrent: { content: 1 } }],
      });
    });
  }

  it("keeps another config field keyed: nothing is re-keyed", async () => {
    const { file, repo } = await ciExport();
    const dev = await developer(repo, { config: { ...HERE, root: "<elsewhere>" } });
    const out = await imported(dev, file);
    expect(out).not.toContain("Re-keyed");
    expect(dev.passing()).toBe(0);
  });
});
