import { describe, expect, it } from "vitest";
import { describeFailure } from "../../../src/core/state/index.js";
import { createVitestAdapter } from "../../../src/runners/vitest/index.js";
import { openFixture, ref, SLOW } from "./helpers.js";

/*
 * Task 001-390, spec 001 D11 Fidelity: the cezar-shaped case
 * (`scripts/test-changed.test.mjs`, research injected-environment F1). A test
 * writes a `package.json` that is not JSON into a temp directory and runs Node
 * there; under a `--require` recorder Node parsed it before the child's entry and
 * the child died with ERR_INVALID_PACKAGE_CONFIG. Under `--import` it starts as
 * without Squeal, and what it and a Worker read is still recorded.
 */

const observing = (root: string) => createVitestAdapter({ root, observe: () => true });

const FILES = {
  "test/package-config.test.ts": `import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { expect, it } from "vitest";
const script = (name: string) => new URL(\`../scripts/\${name}\`, import.meta.url).pathname;
it("runs Node where the nearest package.json is not JSON", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bad-package-"));
  writeFileSync(join(dir, "package.json"), "export const value = 1;\\n");
  const child = script("package-child.cjs");
  const inherit = spawnSync(process.execPath, [child], { cwd: dir, encoding: "utf8" });
  const empty = spawnSync(process.execPath, [child], { cwd: dir, env: {}, encoding: "utf8" });
  expect([inherit.status, inherit.stderr, empty.status, empty.stderr]).toEqual([0, "", 0, ""]);
  expect(execFileSync(process.execPath, [child], { cwd: dir, encoding: "utf8" })).toBe("child");
  const worker = new Worker(script("package-worker.cjs"), { env: {}, workerData: { dir, child } });
  const [status, read] = await new Promise<[number, string]>((resolve) => worker.once("message", resolve));
  await worker.terminate();
  expect([status, read]).toEqual([0, "worker"]);
});
`,
  "scripts/package-child.cjs":
    'process.stdout.write(require("node:fs").readFileSync(__dirname + "/../data/package-child.txt", "utf8"));\n',
  "scripts/package-worker.cjs": `const { spawnSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { parentPort, workerData } = require("node:worker_threads");
const read = readFileSync(__dirname + "/../data/package-worker.txt", "utf8");
const run = spawnSync(process.execPath, [workerData.child], { cwd: workerData.dir, env: {}, encoding: "utf8" });
parentPort.postMessage([run.status, read]);
`,
  "data/package-child.txt": "child",
  "data/package-worker.txt": "worker",
};

describe("vitest adapter: a recorder a test cannot tell is there (task 001-390)", SLOW, () => {
  it.each(["forks", "threads"])(
    "under %s, passes the cezar-shaped package.json case and records the child and the Worker",
    async (pool) => {
      const fx = await openFixture("observed", FILES, observing);
      const file = ref("test/package-config.test.ts", pool);
      const report = await fx.adapter.run([file], fx.runOptions());

      expect(report.end).toBe("completed");
      expect(report.results.map((r) => [r.outcome, r.errors[0]?.message])).toEqual([
        ["pass", undefined],
      ]);
      const seen = report.observed?.find((o) => o.testFile.path === file.path)?.paths;
      expect(seen).toEqual(
        expect.arrayContaining([
          "data/package-child.txt",
          "data/package-worker.txt",
          "scripts/package-child.cjs",
          "scripts/package-worker.cjs",
        ]),
      );
    },
  );

  it("names the recorder in a failure with its signature, and only under it", async () => {
    const files = {
      // Node 16 and 18 before 18.18 refuse `--import` in NODE_OPTIONS with this line and exit 9 (probe)
      "scripts/old-node.sh": `case "$NODE_OPTIONS" in *--import*) echo "$0: --import is not allowed in NODE_OPTIONS" >&2; exit 9;; esac\n`,
      "scripts/pre.cjs": "",
      "test/signatures.test.ts": `import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
const script = (name: string) => new URL(\`../scripts/\${name}\`, import.meta.url).pathname;
it("runs an old Node", () => {
  execFileSync("/bin/sh", [script("old-node.sh")], { encoding: "utf8", stdio: "pipe" });
});
it("runs Node with its own --require where package.json is not JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "bad-package-"));
  writeFileSync(join(dir, "package.json"), "export const value = 1;\\n");
  const args = ["--require", script("pre.cjs"), script("pre.cjs")];
  execFileSync(process.execPath, args, { cwd: dir, encoding: "utf8", stdio: "pipe" });
});
`,
    };
    const signatures = async (observe: boolean) => {
      const fx = await openFixture("observed", files, (root) =>
        createVitestAdapter({ root, observe: () => observe }),
      );
      const report = await fx.adapter.run(
        [ref("test/signatures.test.ts", "forks")],
        fx.runOptions(),
      );
      return report.results.map((r) => [
        r.outcome,
        r.errors[0]?.recorder,
        r.outcome === "fail" &&
          describeFailure(r.errors, null).summary.includes("Squeal's recorder"),
      ]);
    };

    expect(await signatures(true)).toEqual([
      ["fail", "Node before 18.18 rejects its --import", true],
      ["fail", expect.stringContaining("ERR_INVALID_PACKAGE_CONFIG"), true],
    ]);
    // without the recorder the old Node starts; the project's own --require fails as before, unnamed
    expect(await signatures(false)).toEqual([
      ["pass", undefined, false],
      ["fail", undefined, false],
    ]);
  });
});
