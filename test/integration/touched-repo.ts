import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { expect } from "vitest";
import { createFsHasher } from "../../src/core/hash/index.js";
import { statCandidates } from "../../src/core/revision/index.js";
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
 * first closure walk and restores the disk. The watch batch of the restore
 * then waits for the scheduler's lock behind that walk, so the scheduler
 * hands the runner the touch of `touched` before it selects the first tier.
 * Then the scheduler runs to idle. A touch reconciled only after the tier
 * was selected withholds its run (task 001-168): `touched-late.test.ts`.
 */
export async function probeTouched(
  h: Harness,
  plant: (adapter: RunnerAdapter) => Promise<void>,
  touched: readonly string[],
): Promise<void> {
  const closure = h.runner.closure;
  const heard = touchHeard(h);
  let batch: Promise<void> | null = null;
  h.runner.closure = async (testFile) => {
    if (batch === null) {
      await plant({ ...h.runner, closure });
      const paths = await statCandidates(touched, createFsHasher(h.root, "sha1"));
      // Queued on the lock the walk holds, ahead of the first tier's selection.
      batch = h.scheduler.handleBatch({ trigger: "watch", paths });
    }
    return closure(testFile);
  };
  await h.scheduler.start();
  await batch;
  await heard;
  await h.scheduler.idle();
  expect(batch).not.toBeNull();
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

/*
 * Task 001-168 (review wave-13e B1): a test file that, unless released
 * (`flags/heard`, git-ignored), rewrites a worktree file with the bytes it
 * holds, writes `flags/started` and waits to be released.
 */

/** `body` runs inside the test after the rewrite and the wait. */
const held = (imports: string, path: string, body: string) =>
  [
    'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
    'import { setTimeout as sleep } from "node:timers/promises";',
    'import { expect, it } from "vitest";',
    imports,
    'const at = (path: string) => new URL("../" + path, import.meta.url);',
    'it("restored bytes", async () => {',
    '  if (!existsSync(at("flags/heard"))) {',
    `    writeFileSync(at("${path}"), readFileSync(at("${path}")));`,
    '    writeFileSync(at("flags/started"), "");',
    '    for (let i = 0; i < 600 && !existsSync(at("flags/heard")); i++) await sleep(50);',
    "  }",
    `  ${body}`,
    "});",
    "",
  ].join("\n");

const FLAGS = { ".gitignore": "node_modules/\nflags/\n", "flags/.keep": "\n" };

/** `VIRTUAL`, its virtual test rewriting `src/mod.ts`, the input its plugin declares. */
export const VIRTUAL_HELD: Readonly<Record<string, string>> = {
  ...VIRTUAL,
  ...FLAGS,
  "test/virtual.test.ts": held(
    'import { which } from "virtual:which";',
    "src/mod.ts",
    'expect(which).toBe("new");',
  ),
};

/** `CSS`, its test rewriting `src/base.css`, which no closure names. */
export const CSS_HELD: Readonly<Record<string, string>> = {
  ...CSS,
  ...FLAGS,
  "test/css.test.ts": held(
    'import style from "../src/style.css?inline";',
    "src/base.css",
    'expect(style).toContain("new");',
  ),
};

/** Lets a held test run through: for a warm-up or a fresh control. */
export function release(root: string): void {
  writeFileSync(join(root, "flags/heard"), "");
}

/**
 * Plants with `plant` during the scheduler's first closure walk, the held
 * test released, then starts the scheduler. Once its run started, the batch
 * of `path`, which the run rewrote, is handed over; the run ends once the
 * runner heard the touch. Then the scheduler runs to idle.
 */
export async function touchWhileHeld(
  h: Harness,
  plant: (adapter: RunnerAdapter) => Promise<void>,
  path: string,
): Promise<void> {
  const closure = h.runner.closure;
  let planted = false;
  h.runner.closure = async (testFile) => {
    if (!planted) {
      planted = true;
      release(h.root);
      await plant({ ...h.runner, closure });
      rmSync(join(h.root, "flags/heard"), { force: true });
      rmSync(join(h.root, "flags/started"), { force: true });
    }
    return closure(testFile);
  };
  const heard = touchHeard(h);
  await h.scheduler.start();
  const started = join(h.root, "flags/started");
  for (let i = 0; i < 1200 && !existsSync(started); i++) await sleep(25);
  expect(existsSync(started)).toBe(true);
  await h.batch(path);
  await heard;
  release(h.root);
  await h.scheduler.idle();
}
