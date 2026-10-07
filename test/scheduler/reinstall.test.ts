import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { REINSTALL_NOTE } from "../../src/core/scheduler/index.js";
import { InstallStamps } from "../../src/core/scheduler/install-stamp.js";
import type { RunnerAdapter } from "../../src/core/types/index.js";
import {
  createRepo,
  type Harness,
  type HarnessOptions,
  openHarness,
  openRepoStore,
  SLOW,
} from "./helpers.js";

/*
 * Task 001-113, decided by the human after review wave 11c (B1, B2): when
 * the install goes under a running scheduler (`npm ci` removes
 * `node_modules` first), it stores nothing more, tells its daemon once, and
 * the daemon exits. The next daemon starts fresh: it waits for the install
 * with no runner open, and the edits no runner saw run first against the new
 * code. Before, an in-process wait kept the old Vitest instance, whose
 * transforms passed an edited test (B2), and an edit during it spun the
 * pump (B1). Review wave 11 S1 stays covered: a tier whose run overlapped a
 * change of the install stores nothing.
 *
 * `test/dep.test.ts` reads a file of an installed package, so it fails
 * exactly while `node_modules` is gone.
 */
const LOCKFILE = (version: string) =>
  JSON.stringify({ packages: { "node_modules/dep": { version } } });
const DEP = "test/dep.test.ts";
const PKG = "test/dep-import.test.ts";
const MATH = "test/math.test.ts";
const SUBTRACTS = "export const add = (a: number, b: number) => a - b;\n";

function write(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function install(root: string, dir: string, version = "1.0.0"): void {
  const at = (path: string) => (dir === "" ? path : `${dir}/${path}`);
  write(
    root,
    at("node_modules/dep/package.json"),
    JSON.stringify({ name: "dep", version, type: "module", exports: "./index.js" }),
  );
  write(root, at("node_modules/dep/index.js"), "export const value = 42;\n");
  write(root, at("node_modules/dep/value.txt"), "42\n");
  write(root, at("node_modules/.package-lock.json"), LOCKFILE(version));
}

/** Files are written before the harness opens: its Vitest lists them once, at open. */
async function installedRepo(
  options: HarnessOptions = {},
): Promise<Harness & { readonly commonDir: string }> {
  const repo = createRepo("basic");
  write(
    repo.main,
    "package.json",
    JSON.stringify({ name: "reinstall", type: "module", devDependencies: { dep: "1.0.0" } }),
  );
  install(repo.main, "");
  write(
    repo.main,
    DEP,
    [
      `import { readFileSync } from "node:fs";`,
      `import { expect, it } from "vitest";`,
      `it("reads its dependency", () => {`,
      `  expect(readFileSync(new URL("../node_modules/dep/value.txt", import.meta.url), "utf8")).toBe("42\\n");`,
      `});`,
      "",
    ].join("\n"),
  );
  // Slower than the rest and listed after `PKG`, so only the recent group can put it first (D5 step 4).
  write(
    repo.main,
    MATH,
    [
      `import { expect, it } from "vitest";`,
      `import { add } from "../src/math.ts";`,
      `it("adds", async () => {`,
      `  await new Promise((done) => setTimeout(done, 300));`,
      `  expect(add(1, 2)).toBe(3);`,
      `});`,
      "",
    ].join("\n"),
  );
  // Imports the package, so its key holds the package's version (D3, scheme B).
  write(
    repo.main,
    PKG,
    [
      `import { value } from "dep";`,
      `import { expect, it } from "vitest";`,
      `it("imports its dependency", () => expect(value).toBe(42));`,
      "",
    ].join("\n"),
  );
  const store = openRepoStore(repo.commonDir);
  const h = await openHarness(repo.main, store, repo.commonDir, { tierSize: 2, ...options });
  return { ...h, commonDir: repo.commonDir };
}

/** Copies of `node_modules` taken and put back as `npm ci` removes and writes it. */
function uninstall(h: Harness): () => void {
  const saved = `${h.root}.node_modules`;
  cpSync(join(h.root, "node_modules"), saved, { recursive: true });
  rmSync(join(h.root, "node_modules"), { recursive: true, force: true });
  return () => {
    cpSync(saved, join(h.root, "node_modules"), { recursive: true });
    rmSync(saved, { recursive: true, force: true });
  };
}

/** Makes the next run of `DEP` call `during` around the real run. */
function aroundNextRun(h: Harness, during: () => () => void): void {
  const run = h.runner.run.bind(h.runner) as RunnerAdapter["run"];
  let done = false;
  h.runner.run = (async (files, options) => {
    if (done || !files.some((f) => f.path === DEP)) return run(files, options);
    done = true;
    const after = during();
    try {
      return await run(files, options);
    } finally {
      after();
    }
  }) as RunnerAdapter["run"];
}

function failuresStored(h: Harness): number {
  return h.sink.calls
    .filter((call) => call.method === "applyResults")
    .flatMap((call) => call.results)
    .filter((result) => result.outcome === "fail").length;
}

describe("scheduler: an install replaced under a running daemon (review wave 11, S1)", SLOW, () => {
  it("stores no failure from a tier during which node_modules was removed and restored", async () => {
    const h = await installedRepo();
    await h.scheduler.start();
    await h.scheduler.idle();
    expect(failuresStored(h)).toBe(0);

    // `npm ci` in the middle of a tier: the packages vanish, then the same install comes back.
    aroundNextRun(h, () => uninstall(h));
    await h.scheduler.requestFullSuite({ force: true });
    await h.scheduler.idle();

    const depRuns = h.runsOf(DEP);
    // The overlapped run saw the package missing, and its result was never stored.
    expect(depRuns.at(-2)?.report.results.some((r) => r.outcome === "fail")).toBe(true);
    expect(depRuns.at(-1)?.report.results.every((r) => r.outcome === "pass")).toBe(true);
    expect(failuresStored(h)).toBe(0);
    expect(h.header().counts).toMatchObject({ current: expect.any(Number), unknown: 0 });
    expect(h.header().awaitingInstall).toBeUndefined();
  });
});

describe("scheduler: a reinstall under a running daemon exits it (task 001-113)", SLOW, () => {
  it("stores nothing more after an edit during npm ci, and the next scheduler runs the edit first and fails it (review wave 11c, B1 and B2)", async () => {
    const told: string[] = [];
    const h = await installedRepo({ onReinstall: (note) => told.push(note) });
    await h.scheduler.start();
    await h.scheduler.idle();
    const runs = h.runner.runs.length;

    // `npm ci` removes node_modules; the agent edits meanwhile, and the watcher reports both.
    uninstall(h);
    h.write("src/math.ts", SUBTRACTS);
    await h.batch("node_modules/.package-lock.json", "src/math.ts");
    await h.scheduler.idle();
    expect(told).toEqual([REINSTALL_NOTE]);
    const revision = h.store.revisions.latest(h.worktreeId)?.number;

    // B1: another edit neither spins the pump nor queues, records nor runs anything.
    h.write("src/math.ts", `${SUBTRACTS}// again\n`);
    await h.batch("src/math.ts");
    await h.scheduler.idle();
    const record = await h.scheduler.requestFullSuite();
    expect(h.store.checkpoints.get(record.id)?.end).toBe("abandoned");
    expect(h.store.revisions.latest(h.worktreeId)?.number).toBe(revision);
    expect(h.runner.runs).toHaveLength(runs);
    expect(told).toHaveLength(1);
    expect(failuresStored(h)).toBe(0);
    // No wait under a running daemon any more: it exits instead.
    expect(h.header().awaitingInstall).toBeUndefined();
    await h.scheduler.close();

    // The install ends with another version, so the file importing the package misses too.
    install(h.root, "", "1.0.1");
    const next = await openHarness(h.root, h.store, h.commonDir, { tierSize: 1 });
    await next.scheduler.start();
    await next.scheduler.idle();
    // B2: a fresh Vitest instance runs the edited module's test first, against the new code.
    expect(next.runner.runs[0]?.files.map((f) => f.path)).toEqual([MATH]);
    expect(next.runsOf(PKG)).toHaveLength(1);
    expect(next.runsOf(MATH)[0]?.report.results.map((r) => r.outcome)).toEqual(["fail"]);
    expect(next.header().counts).toMatchObject({ unknown: 0, pending: 0 });
  });

  it("exits at the check before a tier when node_modules went during the one before", async () => {
    const told: string[] = [];
    const h = await installedRepo({ onReinstall: (note) => told.push(note) });
    await h.scheduler.start();
    await h.scheduler.idle();
    const runs = h.runner.runs.length;

    // No batch reports it: the next tier's check finds the install gone.
    aroundNextRun(h, () => {
      uninstall(h);
      return () => {};
    });
    const record = await h.scheduler.requestFullSuite({ force: true });
    await h.scheduler.idle();

    expect(told).toEqual([REINSTALL_NOTE]);
    const after = h.runner.runs.slice(runs);
    expect(after.at(-1)?.files.map((f) => f.path)).toContain(DEP);
    expect(failuresStored(h)).toBe(0);
    expect(h.store.checkpoints.get(record.id)?.end).toBe("abandoned");
  });

  it("persists the note itself when no daemon listens", async () => {
    const h = await installedRepo();
    await h.scheduler.start();
    await h.scheduler.idle();
    uninstall(h);
    await h.batch("node_modules/.package-lock.json");
    await h.scheduler.idle();
    const notes = JSON.parse(h.store.meta.get(`notes.${h.worktreeId}`) ?? "[]") as {
      text: string;
    }[];
    expect(notes.map((note) => note.text).filter((text) => text === REINSTALL_NOTE)).toHaveLength(
      1,
    );
  });
});

describe(
  "scheduler: a reinstall inside a workspace (task 001-113, review wave 11c S1)",
  SLOW,
  () => {
    async function workspaceRepo(options: HarnessOptions = {}): Promise<Harness> {
      const repo = createRepo("basic");
      write(
        repo.main,
        "package.json",
        JSON.stringify({ name: "root", type: "module", workspaces: ["packages/*"] }),
      );
      for (const name of ["a", "b"]) {
        write(
          repo.main,
          `packages/${name}/package.json`,
          JSON.stringify({ name, dependencies: { dep: "1.0.0" } }),
        );
        install(repo.main, `packages/${name}`);
      }
      const store = openRepoStore(repo.commonDir);
      return openHarness(repo.main, store, repo.commonDir, { tierSize: 2, ...options });
    }

    it("names the workspace whose install went, though the root has none of its own", async () => {
      const h = await workspaceRepo();
      const stamps = new InstallStamps(h.root);
      expect((await stamps.check()).missing).toBeNull();
      rmSync(join(h.root, "packages/a/node_modules"), { recursive: true, force: true });
      expect((await stamps.check()).missing).toEqual({ workspaces: ["packages/a"] });
    });

    it("exits at the next reconciliation pass", async () => {
      const told: string[] = [];
      const h = await workspaceRepo({ onReinstall: (note) => told.push(note) });
      await h.scheduler.start();
      await h.scheduler.idle();
      expect(h.header().awaitingInstall).toBeUndefined();
      const runs = h.runner.runs.length;

      // `node_modules` is not watched below the root: the interval pass finds it.
      rmSync(join(h.root, "packages/a/node_modules"), { recursive: true, force: true });
      await h.scheduler.handleBatch({ trigger: "interval", paths: [] });
      await h.scheduler.idle();
      expect(told).toEqual([REINSTALL_NOTE]);

      await h.scheduler.requestFullSuite({ force: true });
      await h.scheduler.idle();
      expect(h.runner.runs).toHaveLength(runs);
    });
  },
);
