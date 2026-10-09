import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createRecoveringRunner } from "../../src/core/daemon/runner.js";
import { withSlowInstance } from "../../src/core/daemon/slow-instance.js";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";
import { createVitestAdapter, VITEST_ADAPTER_VERSION } from "../../src/runners/vitest/index.js";
import { git } from "../hash/git-repo.js";
import { type Harness, openHarness, openRepoStore, SLOW } from "../scheduler/helpers.js";

/*
 * Review wave-13 B2, the reviewer's probe under the real scheduler, store and
 * Vitest adapter: a project configured through its own config file has a
 * Vite server of its own. While the first closure walk runs, `src/mod.ts`
 * holds bytes the test passes on, and is restored to bytes it fails on
 * before anything hashes it again. The scheduler's keys name the restored
 * bytes, so what it stores as current must be what they give: the file
 * loads, and its test fails.
 */

/** Inside the repository, so the fixture resolves `vitest` from its `node_modules`. Git-ignored. */
const scratch = join(
  resolve(import.meta.dirname, "../fixtures/vitest/.tmp"),
  `stamps-${randomUUID()}`,
);
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const NEW = 'export const which = "new";\n';
const OLD = 'export const which = "old";\n';

const FILES: Readonly<Record<string, string>> = {
  ".gitignore": "node_modules/\n",
  "package.json": `${JSON.stringify({ name: "stamps", private: true, type: "module" })}\n`,
  "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { projects: ["./vitest.unit.config.ts"] } });\n`,
  "vitest.unit.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { name: "unit", include: ["test/*.test.ts"] } });\n`,
  "src/mod.ts": OLD,
  "test/mod.test.ts": [
    'import { expect, it } from "vitest";',
    'import { which } from "../src/mod.ts";',
    'it("restored bytes", () => expect(which).toBe("new"));',
    "",
  ].join("\n"),
};

/*
 * Review wave-13b B2: two projects with config files of their own, so two
 * Vite servers, import the same module. The first closure walk caches the
 * transient bytes in one server; the other loads the restored bytes after.
 * Each server's transform is checked against what that server read.
 */
const project = (name: string) =>
  `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { name: "${name}", include: ["test/*.test.ts"] } });\n`;
const TWO: Readonly<Record<string, string>> = {
  ...FILES,
  "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { projects: ["./vitest.a.config.ts", "./vitest.b.config.ts"] } });\n`,
  "vitest.unit.config.ts": "",
  "vitest.a.config.ts": project("a"),
  "vitest.b.config.ts": project("b"),
};

function createRepo(files: Readonly<Record<string, string>> = FILES): {
  main: string;
  commonDir: string;
} {
  const main = join(scratch, randomUUID());
  for (const [path, text] of Object.entries(files)) {
    if (text === "") continue;
    mkdirSync(dirname(join(main, path)), { recursive: true });
    writeFileSync(join(main, path), text);
  }
  git(main, ["init", "-q", "-b", "main"]);
  git(main, ["add", "-A"]);
  git(main, ["commit", "-qm", "fixture"]);
  return { main: realpathSync(main), commonDir: realpathSync(join(main, ".git")) };
}

/**
 * The reviewer's probe: the first closure walk reads `src/mod.ts` while it
 * holds the bytes the test passes on, and it is restored before anything
 * hashes it again. Then the scheduler runs to idle.
 */
async function probe(h: Harness): Promise<void> {
  const closure = h.runner.closure;
  let transient = true;
  h.runner.closure = async (testFile) => {
    if (!transient) return closure(testFile);
    transient = false;
    h.write("src/mod.ts", NEW);
    try {
      return await closure(testFile);
    } finally {
      h.write("src/mod.ts", OLD);
    }
  };
  await h.scheduler.start();
  await h.scheduler.idle();
  expect(transient).toBe(false);
}

/** Each project's stored `test` check of `test/mod.test.ts`. */
const stored = (h: Harness) =>
  h.sink
    .states()
    .filter((s) => s.check.testPath === "test/mod.test.ts" && s.check.kind === "test")
    .map((s) => [s.check.project, s.validity, s.outcome])
    .sort();

describe("a project with its own config file (review wave-13 B2)", () => {
  it.each([true, false])(
    "stores no transform read during a closure walk as current (observe %s)",
    SLOW,
    async (observe) => {
      const repo = createRepo();
      const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
        observe,
      });
      await probe(h);
      const states = h.sink.states().filter((s) => s.check.testPath === "test/mod.test.ts");
      expect(states.map((s) => [s.check.kind, s.validity, s.outcome])).toEqual([
        ["file", "current", "pass"],
        ["test", "current", "fail"],
      ]);
    },
  );
});

describe("two projects with config files of their own (review wave-13b B2)", () => {
  it("fail on the bytes on disk under a fresh adapter (the control)", SLOW, async () => {
    const repo = createRepo(TWO);
    const adapter = await createVitestAdapter({ root: repo.main });
    try {
      const refs = ["a", "b"].map((p) => ({ project: p, path: "test/mod.test.ts" }));
      const report = await adapter.run(refs, {
        runId: randomUUID(),
        logDir: join(repo.main, ".squeal-logs"),
        timeoutMs: null,
      });
      expect(report.results.map((r) => [r.check.project, r.outcome]).sort()).toEqual([
        ["a", "fail"],
        ["b", "fail"],
      ]);
    } finally {
      await adapter.close();
    }
  });

  it.each([true, false])(
    "store no server's transient transform as current (observe %s)",
    SLOW,
    async (observe) => {
      const repo = createRepo(TWO);
      const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
        observe,
      });
      await probe(h);
      expect(stored(h)).toEqual([
        ["a", "current", "fail"],
        ["b", "current", "fail"],
      ]);
    },
  );

  // Spec 004 D2 (task 004-18): a slow file runs in a Vitest instance of its
  // own, made per pass, as the daemon composes it; closure walks stay in the
  // fast instance.
  it("store no server's transient transform as current in the slow instance", SLOW, async () => {
    const repo = createRepo(TWO);
    const slotDir = mkdtempSync(join(tmpdir(), "squeal-001-154-slot-"));
    const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
      tierSize: 4,
      policy: { slow: { ...DEFAULT_POLICY.slow, include: ["test/mod.test.ts"] } },
      slow: { slotDir, recheckMs: 50, load: () => [0], cpus: () => 1 },
    });
    let made = 0;
    const lanes = withSlowInstance({ ...h.runner }, () =>
      createRecoveringRunner({
        name: "vitest",
        adapterVersion: VITEST_ADAPTER_VERSION,
        create: () => {
          made += 1;
          return createVitestAdapter({ root: repo.main });
        },
        onFailure: (text) => h.errors.push(new Error(text)),
      }),
    );
    h.runner.run = lanes.run;
    h.runner.invalidate = lanes.invalidate;
    h.runner.releaseLane = (lane) => lanes.releaseLane?.(lane) ?? Promise.resolve();
    h.runner.close = async () => {
      await lanes.close();
      rmSync(slotDir, { recursive: true, force: true });
    };
    await probe(h);

    expect(made).toBeGreaterThan(0);
    expect(stored(h)).toEqual([
      ["a", "current", "fail"],
      ["b", "current", "fail"],
    ]);
  });
});
