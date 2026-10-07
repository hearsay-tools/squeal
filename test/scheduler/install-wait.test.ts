import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatRegistration } from "../../src/core/delivery/index.js";
import { readDaemonNotes } from "../../src/core/notes.js";
import { AWAITING_INSTALL_REASON, awaitsInstall } from "../../src/core/scheduler/index.js";
import { ALL_TEST_FILES, createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Lessons, defect 18: a worktree without its own installed dependencies ran
 * the suite against its parent's `node_modules`, pushed every "cannot find
 * package" to the agent, and discarded it all at the install. Spec 001 D5 as
 * amended (task 001-100): when the root `package.json` declares dependencies
 * and the root has no installed lockfile, nothing is listed or run until an
 * install.
 */
describe("awaitsInstall (D5 as amended, task 001-100)", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });
  const root = (manifest: unknown, lockfile?: string): string => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "squeal-install-")));
    roots.push(dir);
    if (manifest !== undefined) {
      const text = typeof manifest === "string" ? manifest : JSON.stringify(manifest);
      writeFileSync(join(dir, "package.json"), text);
    }
    if (lockfile !== undefined) {
      mkdirSync(join(dir, lockfile, ".."), { recursive: true });
      writeFileSync(join(dir, lockfile), "{}");
    }
    return dir;
  };

  it("waits when the root declares dependencies of any kind and has no installed lockfile", async () => {
    for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
      expect(await awaitsInstall(root({ [field]: { vitest: "^4" } }))).toBe(true);
    }
    expect(await awaitsInstall(root({ workspaces: ["packages/*"] }))).toBe(true);
    expect(await awaitsInstall(root({ workspaces: { packages: ["packages/*"] } }))).toBe(true);
  });

  it("does not wait once an installed lockfile is at the root", async () => {
    const deps = { devDependencies: { vitest: "^4" } };
    expect(await awaitsInstall(root(deps, "node_modules/.package-lock.json"))).toBe(false);
    expect(await awaitsInstall(root(deps, ".pnp.cjs"))).toBe(false);
    // A lockfile below the root is a workspace package's, not the root's.
    expect(await awaitsInstall(root(deps, "packages/a/node_modules/.package-lock.json"))).toBe(
      true,
    );
  });

  it("never waits for a project that declares nothing (spec 003's node:test projects)", async () => {
    expect(await awaitsInstall(root({ name: "plain", type: "module" }))).toBe(false);
    expect(
      await awaitsInstall(root({ dependencies: {}, devDependencies: {}, workspaces: [] })),
    ).toBe(false);
    expect(await awaitsInstall(root(undefined))).toBe(false);
    expect(await awaitsInstall(root("{ not json"))).toBe(false);
  });
});

describe("scheduler: a worktree without installed dependencies (defect 18)", SLOW, () => {
  it("lists and runs nothing and reports no failure, then validates after an install", async () => {
    // Inside this repository, so Vitest resolves from the parent's `node_modules`, as in defect 18.
    const repo = createRepo("basic");
    writeFileSync(
      join(repo.main, "package.json"),
      JSON.stringify({ name: "fresh", type: "module", devDependencies: { vitest: "*" } }),
    );
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir);
    const calls: string[] = [];
    for (const name of ["environment", "testFiles", "closure", "invalidate", "affected"] as const) {
      const call = h.runner[name] as (...args: unknown[]) => Promise<unknown>;
      h.runner[name] = ((...args: unknown[]) => {
        calls.push(name);
        return call(...args);
      }) as never;
    }
    await h.scheduler.start();
    await h.scheduler.idle();

    expect(calls).toEqual([]);
    expect(h.runner.runs).toEqual([]);
    expect(h.header()).toMatchObject({ awaitingInstall: true, runnerPartPending: false });
    const notes = readDaemonNotes(store, h.worktreeId).map((n) => n.text);
    expect(notes.filter((t) => t.startsWith(AWAITING_INSTALL_REASON))).toHaveLength(1);

    const { delivery, consumer } = await h.consumer();
    const registration = await delivery.register(consumer);
    expect(registration.knownFailures).toEqual([]);
    expect(formatRegistration(registration)).toContain(
      "No dependencies are installed in this worktree; Squeal lists and runs no tests until an install.",
    );

    // The agent edits: a revision, still nothing for the runner and nothing to report.
    h.write("src/math.ts", "export const add = (a: number, b: number) => a + b + 0;\n");
    await h.batch("src/math.ts");
    await h.scheduler.idle();
    expect(calls).toEqual([]);
    expect(h.runner.runs).toEqual([]);
    expect(h.header()).toMatchObject({ revision: 1, runnerPartPending: false });
    expect(await delivery.onToolBoundary(consumer)).toBeNull();

    // The install writes only ignored files; the next reconciliation pass sees it.
    h.write("node_modules/.package-lock.json", "{}");
    await h.scheduler.handleBatch({ trigger: "interval", paths: [] });
    await h.scheduler.idle();
    expect(calls).toContain("testFiles");
    expect(h.runner.runs.flatMap((r) => r.files.map((f) => f.path)).sort()).toEqual(ALL_TEST_FILES);
    expect(h.header().awaitingInstall).toBeUndefined();
    expect(h.header().counts.current).toBeGreaterThan(0);
  });

  it("validates a project that declares no dependencies as before", async () => {
    const repo = createRepo("basic");
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir);
    await h.scheduler.start();
    await h.scheduler.idle();
    expect(h.runner.runs.flatMap((r) => r.files.map((f) => f.path)).sort()).toEqual(ALL_TEST_FILES);
    expect(h.header().awaitingInstall).toBeUndefined();
  });
});
