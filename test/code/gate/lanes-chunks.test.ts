import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import { fake, IDLE, lanes, planned, removeTemps } from "./lanes-kit.js";

/*
 * Row 020-59 (#201, #216): each runner's files run in chunks, one run
 * after another, so the keeper hears each chunk's files as it ends and
 * writes them while the next chunk runs. Files that fit in one chunk run
 * in one run, as before. The rerun of row 020-54 runs once per runner,
 * after its last chunk; the budget, `notStarted`, the early stop and the
 * kept log read as with one run.
 */

afterEach(removeTemps);

const paths = (refs?: readonly TestFileRef[]) => refs?.map((f) => f.path);

const FIVE = ["t/1.test.ts", "t/2.test.ts", "t/3.test.ts", "t/4.test.ts", "t/5.test.ts"];

describe("runLanes in chunks (row 020-59)", () => {
  it("runs a runner's files in chunks, in order, and tells the keeper each as it ends", async () => {
    const vitest = fake("vitest", {});
    const out = await lanes({ runs: [planned(vitest.runner, 0, FIVE)], chunkFiles: 2, load: IDLE });
    expect(vitest.given.map((g) => [g.runId, g.files])).toEqual([
      ["gate-0-c1", ["t/1.test.ts", "t/2.test.ts"]],
      ["gate-0-c2", ["t/3.test.ts", "t/4.test.ts"]],
      ["gate-0-c3", ["t/5.test.ts"]],
    ]);
    expect(out.told.map((run) => paths(run.files))).toEqual([
      ["t/1.test.ts", "t/2.test.ts"],
      ["t/3.test.ts", "t/4.test.ts"],
      ["t/5.test.ts"],
    ]);
    expect(out.testFiles.map((f) => [f.path, f.completed])).toEqual(
      FIVE.map((path) => [path, true]),
    );
    expect(out.timedOut).toBe(false);
  });

  it("runs files that fit in one chunk in one run, as before", async () => {
    const vitest = fake("vitest", {});
    await lanes({ runs: [planned(vitest.runner, 0, FIVE)], chunkFiles: 5, load: IDLE });
    expect(vitest.given.map((g) => g.runId)).toEqual(["gate-0"]);
  });

  it("starts every runner's first chunk at once, and each runner's chunks one after another", async () => {
    const vitest = fake("vitest", {}, 100);
    const node = fake("node-test", {}, 100);
    const nodeFiles = ["n/a.test.ts", "n/b.test.ts", "n/c.test.ts"];
    await lanes({
      runs: [planned(vitest.runner, 0, FIVE.slice(0, 4)), planned(node.runner, 1, nodeFiles)],
      chunkFiles: 2,
      load: IDLE,
    });
    expect(vitest.given.map((g) => g.runId)).toEqual(["gate-0-c1", "gate-0-c2"]);
    expect(node.given.map((g) => g.runId)).toEqual(["gate-1-c1", "gate-1-c2"]);
    const [v1 = 0, v2 = 0] = vitest.started;
    const [n1 = 0, n2 = 0] = node.started;
    // Both first chunks start before either runner's second.
    expect(Math.max(v1, n1)).toBeLessThan(Math.min(v2, n2));
  });

  it("reruns once, after the last chunk, the files that failed under load in any chunk", async () => {
    const vitest = fake("vitest", {
      "t/1.test.ts": ["fail", "pass"],
      "t/4.test.ts": ["fail", "fail"],
    });
    const out = await lanes({ runs: [planned(vitest.runner, 0, FIVE)], chunkFiles: 2 });
    expect(vitest.given.map((g) => [g.runId, g.files])).toEqual([
      ["gate-0-c1", ["t/1.test.ts", "t/2.test.ts"]],
      ["gate-0-c2", ["t/3.test.ts", "t/4.test.ts"]],
      ["gate-0-c3", ["t/5.test.ts"]],
      ["gate-0-rerun", ["t/1.test.ts", "t/4.test.ts"]],
    ]);
    expect(out.byPath("t/1.test.ts")).toMatchObject({ failed: [], retried: { outcome: "passed" } });
    expect(out.byPath("t/4.test.ts")).toMatchObject({
      failed: ["t/4.test.ts works"],
      retried: { outcome: "failed" },
    });
    expect(out.byPath("t/2.test.ts")?.retried).toBeUndefined();
    // Row 020-55: each chunk names the files its rerun decides; the rerun is heard last.
    expect(out.told.map((run) => [paths(run.files), paths(run.retrying)])).toEqual([
      [["t/1.test.ts", "t/2.test.ts"], ["t/1.test.ts"]],
      [["t/3.test.ts", "t/4.test.ts"], ["t/4.test.ts"]],
      [["t/5.test.ts"], undefined],
      [["t/1.test.ts", "t/4.test.ts"], undefined],
    ]);
  });

  it("starts no chunk after the deadline: its files read not started, and the budget timed out", async () => {
    const vitest = fake("vitest", {}, 300);
    const out = await lanes({
      runs: [planned(vitest.runner, 0, FIVE.slice(0, 4))],
      chunkFiles: 2,
      budgetMs: 200,
      load: IDLE,
    });
    expect(vitest.given.map((g) => g.runId)).toEqual(["gate-0-c1"]);
    expect(out.byPath("t/1.test.ts")?.completed).toBe(true);
    expect(out.byPath("t/3.test.ts")).toMatchObject({ completed: false, notStarted: true });
    expect(out.timedOut).toBe(true);
    expect(out.told).toHaveLength(1);
  });

  it("leaves the files the early stop left out to no chunk", async () => {
    const vitest = fake("vitest", {});
    const out = await lanes({
      runs: [planned(vitest.runner, 0, FIVE.slice(0, 3), [], ["t/9.test.ts"])],
      chunkFiles: 2,
      load: IDLE,
    });
    expect(vitest.given.flatMap((g) => g.files)).toEqual(FIVE.slice(0, 3));
    expect(out.byPath("t/9.test.ts")).toMatchObject({ completed: false, overBudget: true });
  });

  it("joins the logs of the chunks with a failed file into one folder, in order", async () => {
    const vitest = fake("vitest", { "t/1.test.ts": ["fail"], "t/5.test.ts": ["fail"] });
    const out = await lanes({ runs: [planned(vitest.runner, 0, FIVE)], chunkFiles: 2, load: IDLE });
    expect(out.ended).toHaveLength(1);
    const [joined] = out.ended;
    expect(basename(joined?.logDir ?? "")).toBe("0");
    expect(paths(joined?.files)).toEqual(["t/1.test.ts", "t/2.test.ts", "t/5.test.ts"]);
    expect(readFileSync(join(joined?.logDir ?? "", "vitest.log"), "utf8")).toBe(
      "gate-0-c1\ngate-0-c3\n",
    );
  });

  it("offers one chunk's log as it is when only it has a failed file", async () => {
    const vitest = fake("vitest", { "t/3.test.ts": ["fail"] });
    const out = await lanes({ runs: [planned(vitest.runner, 0, FIVE)], chunkFiles: 2, load: IDLE });
    expect(out.ended.map((run) => basename(run.logDir))).toEqual(["0-c1", "0-c2", "0-c3"]);
  });
});
