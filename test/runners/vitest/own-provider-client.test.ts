import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createVitestAdapter } from "../../../src/runners/vitest/index.js";
import { covering } from "./coverage-helpers.js";
import { openFixture, outcomes, ref, SLOW } from "./helpers.js";

/*
 * Row 013-08: a test file in a client environment (jsdom, happy-dom; the
 * fixture's local `client-env`) loads Squeal's provider through Vite's
 * client environment, which loads no file outside `server.fs.allow`. The
 * provider sits in a plugin cache, outside every project. On Cezar
 * (Vitest 4.1.10, Vite 8.1.4) each such worker failed: "Failed to load
 * custom CoverageProviderModule", caused by ERR_MODULE_NOT_FOUND for
 * `/@fs/<provider>`, and its file got no result.
 */

const fixture = (path: string) =>
  readFileSync(
    join(resolve(import.meta.dirname, "../../fixtures/vitest/client-env"), path),
    "utf8",
  );

/** The client project in a config of its own, as Cezar's `packages/web` is. */
const SEPARATE_PROJECT: Readonly<Record<string, string>> = {
  "vitest.config.ts": [
    'import { defineConfig } from "vitest/config";',
    'export default defineConfig({ test: { projects: ["./web/vitest.config.ts"] } });',
    "",
  ].join("\n"),
  "web/vitest.config.ts": [
    'import { defineConfig } from "vitest/config";',
    "export default defineConfig({",
    '  test: { name: "web", include: ["test/**/*.test.ts"], environment: "./client-env.ts" },',
    "});",
    "",
  ].join("\n"),
  "web/client-env.ts": fixture("client-env.ts"),
  "web/test/plain.test.ts": fixture("test/plain.test.ts"),
};

describe("vitest adapter: Squeal's provider in a client environment", SLOW, () => {
  it.each([
    { name: "the root project", files: {}, test: ref("test/plain.test.ts") },
    {
      name: "a project of its own config",
      files: SEPARATE_PROJECT,
      test: ref("web/test/plain.test.ts", "web"),
    },
  ])(
    "loads from outside the project, and the file passes with a payload: $name",
    async ({ files, test }) => {
      const opened = covering();
      const fx = await openFixture("client-env", files, opened.create);
      const report = await fx.adapter.run([test], fx.runOptions());

      expect(report.failure).toBeNull();
      expect(outcomes(report)).toEqual(["pass"]);
      expect(opened.runs.flatMap((r) => r.files.map((f) => f.testFile))).toEqual([test]);
    },
  );
});

describe("vitest adapter: a provider deleted since the daemon found it", SLOW, () => {
  it("fails the start with ENOENT naming the provider's file", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sq-own-provider-gone-"));
    const provider = join(tempDir, "gone", "provider.mjs");
    try {
      const opening = openFixture("client-env", {}, (root) =>
        createVitestAdapter({
          root,
          note: () => {},
          coverage: { enabled: () => true, provider, tempDir, collected: () => {} },
        }),
      );

      await expect(opening).rejects.toThrow(
        `ENOENT: no such file or directory, realpath '${provider}'`,
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
