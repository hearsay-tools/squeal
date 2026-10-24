import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runMissingConfig } from "../helpers/baseline.js";
import { settled, statusWhen, waitDaemons } from "./wait-daemon.js";

/*
 * Task 001-424, under a real daemon run from the sources: a setup file
 * imports a file that does not exist yet, in a client environment, so every
 * test file fails with "Failed to resolve import". Adding the file must
 * bring the next result in with no touch. The environment listed only the
 * setup closure's existing files, so the add re-keyed nothing and the
 * failure stayed current until the setup file was touched.
 */

const FIXTURE = resolve(import.meta.dirname, "../fixtures/vitest/client-env");
const { createRepo, startDaemon } = waitDaemons("setup-missing");
const SLOW = { timeout: 600_000 } as const;

/** The fixture's files, with `.gitignore` and `overrides`. */
function fixtureFiles(overrides: Readonly<Record<string, string>>): Record<string, string> {
  const files: Record<string, string> = { ".gitignore": "node_modules/\n" };
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else files[relative(FIXTURE, path)] = readFileSync(path, "utf8");
    }
  };
  walk(FIXTURE);
  return { ...files, ...overrides };
}

describe("a setup file's missing import is added (001-424)", () => {
  it.each([
    { name: "the target alone", setup: "../src/markdown", writes: ["src/markdown.ts"] },
    {
      name: "importer and target at once, in a new directory",
      setup: "../src/fresh/uses-md",
      writes: ["src/fresh/uses-md.ts", "src/fresh/markdown.ts"],
    },
  ])("$name: the next result passes with no touch", SLOW, async ({ name, setup, writes }) => {
    const root = createRepo(
      name.replace(/\W+/g, "-"),
      fixtureFiles({
        "squeal.config.json": runMissingConfig(),
        "test/setup.ts": `import "${setup}";\n`,
      }),
    );
    await startDaemon(root);
    const failing = await settled(root);
    expect(failing.knownFailures.map((f) => f.summary)).toEqual([
      expect.stringMatching(/^Failed to resolve import/),
    ]);

    const content: Record<string, string> = {
      "src/fresh/uses-md.ts": 'export { which } from "./markdown";\n',
    };
    for (const path of writes) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content[path] ?? 'export const which = "md";\n');
    }
    await statusWhen(root, "the add's revision", (s) => s.revision > failing.revision);

    const after = await settled(root);
    expect(after.knownFailures).toEqual([]);
  });
});
