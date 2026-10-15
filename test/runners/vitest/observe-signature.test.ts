import { describe, expect, it } from "vitest";
import { describeFailure } from "../../../src/core/state/index.js";
import { createVitestAdapter } from "../../../src/runners/vitest/index.js";
import { openFixture, ref, SLOW } from "./helpers.js";

/*
 * Review 001-401, B3 (spec 001 D11 Fidelity): the recorder note is said only
 * on a signature of a recorder the run used. A project's own failure that
 * merely looks like one, a missing file named `recorder.cjs` or a module
 * beneath a `package.json` that is not JSON, is the project's, observed or not.
 */

const FILES = {
  "test/project.test.ts": `import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
const node = (code: string) =>
  execFileSync(process.execPath, ["-e", code], { encoding: "utf8", stdio: "pipe" });
it("requires a missing project file named like the recorder", () => {
  node(\`require(\${JSON.stringify(new URL("../src/observe/recorder.cjs", import.meta.url).pathname)})\`);
});
it("loads a module beneath a package.json that is not JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "bad-package-"));
  writeFileSync(join(dir, "package.json"), "{ broken");
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "sub", "m.js"), "module.exports = 1;\\n");
  node(\`require(\${JSON.stringify(join(dir, "sub", "m.js"))})\`);
});
`,
};

describe(
  "vitest adapter: no recorder note on a project's own failure (review 001-401)",
  SLOW,
  () => {
    it.each([true, false])("observing %s", async (observe) => {
      const fx = await openFixture("observed", FILES, (root) =>
        createVitestAdapter({ root, observe: () => observe }),
      );
      const report = await fx.adapter.run([ref("test/project.test.ts", "forks")], fx.runOptions());
      expect(
        report.results.map((r) => [
          r.outcome,
          r.errors[0]?.message.match(/MODULE_NOT_FOUND|Invalid package config/)?.[0],
          r.errors[0]?.recorder,
          describeFailure(r.errors, null).summary.includes("Squeal's recorder"),
        ]),
      ).toEqual([
        ["fail", "MODULE_NOT_FOUND", undefined, false],
        ["fail", "Invalid package config", undefined, false],
      ]);
    });
  },
);
