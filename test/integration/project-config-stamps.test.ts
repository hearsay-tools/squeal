import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { git } from "../hash/git-repo.js";
import { openHarness, openRepoStore, SLOW } from "../scheduler/helpers.js";

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

function createRepo(): { main: string; commonDir: string } {
  const main = join(scratch, randomUUID());
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(main, path)), { recursive: true });
    writeFileSync(join(main, path), text);
  }
  git(main, ["init", "-q", "-b", "main"]);
  git(main, ["add", "-A"]);
  git(main, ["commit", "-qm", "fixture"]);
  return { main: realpathSync(main), commonDir: realpathSync(join(main, ".git")) };
}

describe("a project with its own config file (review wave-13 B2)", () => {
  it.each([true, false])(
    "stores no transform read during a closure walk as current (observe %s)",
    SLOW,
    async (observe) => {
      const repo = createRepo();
      const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
        observe,
      });
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
      const states = h.sink.states().filter((s) => s.check.testPath === "test/mod.test.ts");
      expect(states.map((s) => [s.check.kind, s.validity, s.outcome])).toEqual([
        ["file", "current", "pass"],
        ["test", "current", "fail"],
      ]);
    },
  );
});
