import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RunnerAdapter } from "../../src/core/types/index.js";
import { createRepo, type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Review wave 11, S1 (task 001-107, D5 as amended): `npm ci` removes
 * `node_modules` before it installs. Under a running daemon every test file
 * then ran against missing packages and each passing check became a pushed
 * `PASS -> FAIL`. Now the wait starts when the install goes, and a tier
 * whose run overlapped the removal or a lockfile change stores nothing.
 *
 * `test/dep.test.ts` reads a file of an installed package, so it fails
 * exactly while `node_modules` is gone.
 */
const LOCKFILE = JSON.stringify({ packages: { "node_modules/dep": { version: "1.0.0" } } });
const DEP = "test/dep.test.ts";

/** Files are written before the harness opens: its Vitest lists them once, at open. */
async function installedRepo(tierSize = 2): Promise<Harness> {
  const repo = createRepo("basic");
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(repo.main, path)), { recursive: true });
    writeFileSync(join(repo.main, path), content);
  };
  write(
    "package.json",
    JSON.stringify({ name: "reinstall", type: "module", devDependencies: { dep: "1.0.0" } }),
  );
  write("node_modules/dep/package.json", JSON.stringify({ name: "dep", version: "1.0.0" }));
  write("node_modules/dep/value.txt", "42\n");
  write("node_modules/.package-lock.json", LOCKFILE);
  write(
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
  const store = openRepoStore(repo.commonDir);
  return openHarness(repo.main, store, repo.commonDir, { tierSize });
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

  it("waits while node_modules is gone, and validates again after the install", async () => {
    const h = await installedRepo();
    await h.scheduler.start();
    await h.scheduler.idle();
    let restore: (() => void) | null = null;
    aroundNextRun(h, () => {
      restore = uninstall(h);
      return () => {};
    });
    await h.scheduler.requestFullSuite({ force: true });
    await h.scheduler.idle();
    // The watcher reports the lockfile gone; the tier's failure was never stored.
    await h.batch("node_modules/.package-lock.json");
    await h.scheduler.idle();
    const runs = h.runner.runs.length;
    expect(failuresStored(h)).toBe(0);
    expect(h.header()).toMatchObject({ awaitingInstall: true });
    expect(h.header().counts.current).toBe(0);

    // A run --all while waiting runs nothing and claims nothing (B1).
    const record = await h.scheduler.requestFullSuite();
    expect(h.store.checkpoints.get(record.id)?.end).toBe("abandoned");
    expect(h.runner.runs).toHaveLength(runs);

    (restore as unknown as () => void)();
    await h.scheduler.handleBatch({ trigger: "interval", paths: [] });
    await h.scheduler.idle();
    expect(h.header().awaitingInstall).toBeUndefined();
    expect(h.header().counts.unknown).toBe(0);
    expect(failuresStored(h)).toBe(0);
  });
});
