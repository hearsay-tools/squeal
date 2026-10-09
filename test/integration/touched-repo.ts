import { rmSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import type { RunnerAdapter, TestFileRef } from "../../src/core/types/index.js";
import type { Harness } from "../scheduler/helpers.js";
import { BASE, OLD, readsNew, warmOptions } from "./stamps-repo.js";

/*
 * Task 001-159: the probes of reviews wave-13 to wave-13d, each ending in
 * the touch the watcher sees when a file is restored to the bytes it had.
 * No revision names it; the runner hears it as `kind: "touch"`.
 */

const config = (head: string, body: string) =>
  `import { defineConfig } from "vitest/config";\n${head}export default defineConfig(${body});\n`;

/** Review wave-13d B1: a virtual module built from `src/mod.ts`, declared with `addWatchFile`. */
export const VIRTUAL: Readonly<Record<string, string>> = {
  ...BASE,
  "vitest.config.ts": config(
    'import { readFileSync } from "node:fs";\nimport { resolve } from "node:path";\n',
    `{
  plugins: [{
    name: "which",
    resolveId(id) { if (id === "virtual:which") return "\\0virtual:which"; },
    load(id) {
      if (id !== "\\0virtual:which") return;
      const file = resolve(import.meta.dirname, "src/mod.ts");
      this.addWatchFile(file);
      return readFileSync(file, "utf8");
    },
  }],
  test: { include: ["test/*.test.ts"] },
}`,
  ),
  "test/virtual.test.ts": readsNew("virtual:which"),
  "test/plain.test.ts": readsNew("../src/mod.ts"),
};

export const OLD_CSS = '.base { content: "old"; }\n';
export const NEW_CSS = '.base { content: "new"; }\n';

/** Review wave-13d B2: processed CSS holds what it `@import`ed. */
export const CSS: Readonly<Record<string, string>> = {
  ...BASE,
  "vitest.config.ts": config(
    "",
    '{ test: { include: ["test/*.test.ts"], css: { include: [/.+/] } } }',
  ),
  "src/style.css": '@import "./base.css";\n.x { color: red; }\n',
  "src/base.css": OLD_CSS,
  "test/css.test.ts": [
    'import { expect, it } from "vitest";',
    'import style from "../src/style.css?inline";',
    'it("restored bytes", () => expect(style).toContain("new"));',
    "",
  ].join("\n"),
};

/** Review wave-13d S1: the dependency optimizer bundles `src/mod.js` through an alias. */
export const OPTIMIZED: Readonly<Record<string, string>> = {
  ...BASE,
  "src/mod.ts": "",
  "src/mod.js": OLD,
  "vitest.config.ts": config(
    'import { resolve } from "node:path";\n',
    `{
  resolve: { alias: { "local-pkg": resolve(import.meta.dirname, "src/mod.js") } },
  test: {
    include: ["test/*.test.ts"],
    deps: {
      optimizer: {
        ssr: { enabled: true, include: ["local-pkg"] },
        client: { enabled: true, include: ["local-pkg"] },
      },
    },
  },
}`,
  ),
  "test/optimized.test.ts": readsNew("local-pkg"),
};

/** Resolves once the scheduler's runner heard a touch. Call before the scheduler starts. */
export function touchHeard(h: Harness): Promise<void> {
  return new Promise((resolve) => {
    const invalidate = h.runner.invalidate;
    h.runner.invalidate = (paths) => {
      if (paths.some((p) => p.kind === "touch")) resolve();
      return invalidate(paths);
    };
  });
}

/**
 * `plant` reads transient bytes into the scheduler's own adapter during its
 * first closure walk and restores the disk. The first tier then waits until
 * the scheduler handed the runner the touch of `touched`, as a watch batch
 * of the restore would. Then the scheduler runs to idle. Open the harness
 * with `runnerPartBesideRun`, so the touch reaches the adapter before the
 * first run does.
 */
export async function probeTouched(
  h: Harness,
  plant: (adapter: RunnerAdapter) => Promise<void>,
  touched: readonly string[],
): Promise<void> {
  const closure = h.runner.closure;
  const heard = touchHeard(h);
  let phase: "plant" | "touch" | "done" = "plant";
  h.runner.closure = async (testFile) => {
    if (phase === "plant") {
      await plant({ ...h.runner, closure });
      phase = "touch";
    }
    return closure(testFile);
  };
  h.runner.beforeRun = async () => {
    if (phase !== "touch") return;
    phase = "done";
    await h.batch(...touched);
    await heard;
  };
  await h.scheduler.start();
  await h.scheduler.idle();
  expect(phase).toBe("done");
}

/**
 * Runs `files` through `adapter` while `path` holds `transient`, then writes
 * `restored` back. `read` runs first on the transient bytes. Each file must
 * pass, or nothing was planted.
 */
export async function warmOn(
  h: Harness,
  adapter: RunnerAdapter,
  files: readonly TestFileRef[],
  path: string,
  transient: string,
  restored: string,
  read: () => Promise<void> = async () => {},
): Promise<void> {
  h.write(path, transient);
  try {
    await read();
    const report = await adapter.run(files, warmOptions(h.root));
    expect(report.results.map((r) => r.outcome)).toEqual(files.map(() => "pass"));
  } finally {
    h.write(path, restored);
  }
}

/**
 * The optimizer bundles `src/mod.js` on transient bytes: its cache on disk
 * is gone, and an instance made now builds it again (review wave-13d S1).
 */
export async function optimizeNow(h: Harness, adapter: RunnerAdapter): Promise<void> {
  rmSync(join(h.root, "node_modules/.vite"), { recursive: true, force: true });
  const { recreatedProjects } = await adapter.invalidate([
    { path: "vitest.config.ts", kind: "change" },
  ]);
  expect(recreatedProjects).toEqual([""]);
}
