import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createVitestAdapter } from "../../../src/runners/vitest/index.js";
import { openFixture, outcomes, ref, SLOW } from "./helpers.js";

/*
 * Task 001-157: a Vitest instance reads its config once, as it starts, and
 * runs its global setup once, at its first run. A revert and its restore
 * inside one watcher batch name no revision, so nothing recreates an
 * instance that read the reverted bytes; the run after the restore must
 * still run what is on disk.
 */

const config = (which: string) =>
  `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/*.test.ts"], env: { WHICH: "${which}" } } });\n`;

const setupConfig = `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/*.test.ts"], globalSetup: ["test/global-setup.ts"] } });\n`;
const globalSetup = (which: string) =>
  `export default function ({ provide }) {\n  provide("which", "${which}");\n}\n`;

const envTest = [
  'import { expect, it } from "vitest";',
  'it("reads the config", () => expect(process.env.WHICH).toBe("new"));',
  "",
].join("\n");
const injectTest = [
  'import { expect, inject, it } from "vitest";',
  'it("reads the global setup", () => expect(inject("which")).toBe("new"));',
  "",
].join("\n");

describe("vitest adapter: inputs an instance reads once (001-157)", SLOW, () => {
  it("runs the config on disk after an instance started on a reverted one", async () => {
    const fx = await openFixture(
      "basic",
      { "vitest.config.ts": config("new"), "test/env.test.ts": envTest },
      async (root) => {
        const adapter = await createVitestAdapter({ root });
        // Restored after the instance read it; no revision names it.
        writeFileSync(join(root, "vitest.config.ts"), config("old"));
        return adapter;
      },
    );
    expect(outcomes(await fx.adapter.run([ref("test/env.test.ts")], fx.runOptions()))).toEqual([
      "fail",
    ]);
  });

  it("runs the global setup on disk after it ran reverted bytes", async () => {
    const fx = await openFixture("basic", {
      "vitest.config.ts": setupConfig,
      "test/global-setup.ts": globalSetup("old"),
      "test/inject.test.ts": injectTest,
    });
    const file = ref("test/inject.test.ts");
    fx.write("test/global-setup.ts", globalSetup("new"));
    expect(outcomes(await fx.adapter.run([file], fx.runOptions()))).toEqual(["pass"]);
    fx.write("test/global-setup.ts", globalSetup("old"));
    expect(outcomes(await fx.adapter.run([file], fx.runOptions()))).toEqual(["fail"]);
  });
});
