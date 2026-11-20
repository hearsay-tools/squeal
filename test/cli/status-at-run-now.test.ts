import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nowUse, runNow } from "../../src/cli/status-at-run-now.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { fixture, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { RELAUNCH, testOf } from "./status-at-kit.js";

/*
 * Review wave-18 B2 (row 023-29, R3) with a real run child and no daemon:
 * a Vitest config that throws makes the gate reject before it runs a file.
 * That is the batch's setup, with its group and text, never the budget:
 * not counted as left for want of time, and no rerun is sized for it.
 */

const TEST = ref("test/a.test.ts");

describe("the working tree's run when the gate cannot start (review wave-18 B2)", SLOW, () => {
  it("reads a config that throws as the batch's setup, not the budget", async () => {
    const f = fixture({
      "squeal.config.json": "{}\n",
      "vitest.config.mjs": 'throw new Error("Browser startup config failed\\nsecond line");\n',
      "src/a.ts": "export const value = 1;\n",
      [TEST.path]: testOf("a", 1),
    });
    const end = await runNow({
      root: f.root,
      commonDir: join(f.root, ".git") as AbsolutePath,
      files: [TEST],
      daemon: false,
      endMs: performance.now() + 60_000,
      timeoutSeconds: 60,
      env: { ...process.env },
      relaunch: RELAUNCH,
      forward: () => {},
    });
    const states = [...end.states.values()];
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({ state: "not run", reason: "setup" });
    const setup = states[0]?.state === "not run" ? (states[0].setup ?? "") : "";
    expect(setup).toMatch(/^tests: .*Browser startup config failed/);
    expect(setup).not.toContain("second line");
    expect(states.some((s) => s.state === "not run" && s.reason === "budget")).toBe(false);
    expect(end.problem).toBeNull();
    expect(end.leftEstimate).toBeNull();

    const use = nowUse({ files: [TEST] }, end, () => ({ state: "no result", key: "k" }));
    expect(use).toMatchObject({ selected: 1, ran: 0, notRun: 0, problem: null });
    expect(use.setupFailed).toEqual([{ setup, files: 1 }]);
  });
});

describe("a path an ordinary and a manual project share (review wave-18 B3)", SLOW, () => {
  it("runs the manual project in its own batch: its setup stops none of the ordinary files", async () => {
    const marks = mkdtempSync(join(tmpdir(), "squeal-b3-"));
    const f = fixture({
      "squeal.config.json": `${JSON.stringify({
        checks: [{ name: "browser", runner: "vitest", project: "browser", at: "manual" }],
      })}\n`,
      "vitest.config.mjs": [
        "export default { test: { projects: [",
        '  { test: { name: "unit", include: ["test/*.test.ts"] } },',
        '  { test: { name: "browser", include: ["test/shared.test.ts"], globalSetup: ["./browser.mjs"] } },',
        "] } };",
        "",
      ].join("\n"),
      "browser.mjs":
        'export default function setup() {\n  throw new Error("Chrome failed to launch");\n}\n',
      "src/a.ts": "export const value = 1;\n",
      "test/shared.test.ts": testOf("a", 1),
      "test/plain.test.ts": [
        'import { writeFileSync } from "node:fs";',
        'import { expect, it } from "vitest";',
        `it("marks", () => {\n  writeFileSync(${JSON.stringify(join(marks, "plain-ran"))}, "");\n  expect(1).toBe(1);\n});`,
        "",
      ].join("\n"),
    });
    const unitShared = { project: "unit", path: "test/shared.test.ts" };
    const unitPlain = { project: "unit", path: "test/plain.test.ts" };
    const browserShared = { project: "browser", path: "test/shared.test.ts" };
    const end = await runNow({
      root: f.root,
      commonDir: join(f.root, ".git") as AbsolutePath,
      files: [unitShared, unitPlain, browserShared],
      daemon: false,
      endMs: performance.now() + 120_000,
      timeoutSeconds: 120,
      env: { ...process.env },
      relaunch: RELAUNCH,
      forward: () => {},
      batchFiles: 10,
    });
    expect(existsSync(join(marks, "plain-ran"))).toBe(true);
    const of = (ref: TestFileRef) => end.states.get(testFileId(ref));
    expect(of(unitShared)).toBeUndefined();
    expect(of(unitPlain)).toBeUndefined();
    expect(of(browserShared)).toMatchObject({ state: "not run", reason: "setup" });
    const setup = of(browserShared);
    expect(setup?.state === "not run" ? setup.setup : "").toMatch(
      /^browser: global setup \S*browser\.mjs failed: Chrome failed to launch/,
    );
    rmSync(marks, { recursive: true, force: true });
  });
});
