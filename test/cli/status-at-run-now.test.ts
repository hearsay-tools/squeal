import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nowUse, runNow } from "../../src/cli/status-at-run-now.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
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
