import { describe, expect, it } from "vitest";
import type { LintProvider, LintRunReport } from "../../../src/core/lint/provider/index.js";
import { project, provider } from "./helpers.js";

/*
 * Spec 017 goal 6, D3, D9; 016 `research/binding-cost.md` finding 4: a
 * plugin that blocks, throws in a timer or exits never stops the host's
 * timers and never ends the host. Its call's files read `unknown` with the
 * reason, and the next call starts a new worker.
 */

const OK = { path: "src/ok.js", text: "export const ok = 1;\n" };
const bad = (marker: string) => ({
  path: "src/bad.js",
  text: `// ${marker}\nexport const bad = 1;\n`,
});

/** Runs `work` with a 10 ms heartbeat in this thread; the largest gap between beats. */
async function beating<T>(work: () => Promise<T>): Promise<{ result: T; gap: number }> {
  let last = performance.now();
  let gap = 0;
  const beat = setInterval(() => {
    const now = performance.now();
    gap = Math.max(gap, now - last);
    last = now;
  }, 10);
  try {
    const result = await work();
    return { result, gap: Math.max(gap, performance.now() - last) };
  } finally {
    clearInterval(beat);
  }
}

async function opened(options: Parameters<typeof provider>[1] = {}): Promise<LintProvider> {
  const eslint = provider(project("hazard"), options);
  expect(await eslint.open()).toHaveProperty("tool", "eslint");
  expect(await eslint.refresh("none")).toHaveProperty("closure");
  return eslint;
}

describe("a plugin that misbehaves in the worker (spec 017 goal 6)", () => {
  for (const [marker, reason] of [
    ["HAZARD_BLOCK", "timed out after 0.5 s"],
    ["HAZARD_TIMER", "the ESLint worker threw: the plugin's timer threw"],
    ["HAZARD_EXIT", "the ESLint worker exited with code 3"],
  ] as const) {
    it(`${marker}: the call's files read unknown, the host's timers keep running, the next call lints`, async () => {
      const eslint = await opened({ guardMs: 500 });
      const { result, gap } = await beating(() => eslint.lint([OK, bad(marker)]));
      expect((result as LintRunReport).results).toEqual(
        new Map([
          [OK.path, { unknown: reason }],
          ["src/bad.js", { unknown: reason }],
        ]),
      );
      expect(gap).toBeLessThan(100);
      const next = (await eslint.lint([OK])) as LintRunReport;
      expect(next.results.get(OK.path)).toEqual({ findings: [] });
    }, 30_000);
  }

  it("a rule that throws gives its own file unknown and the worker lives on", async () => {
    const eslint = await opened();
    const report = (await eslint.lint([bad("HAZARD_THROW"), OK])) as LintRunReport;
    expect(report.results.get("src/bad.js")).toEqual({
      unknown: expect.stringMatching(/^ESLint failed on this file: .*the plugin's rule threw/),
    });
    expect(report.results.get(OK.path)).toEqual({ findings: [] });
  }, 30_000);

  it("a late timer that throws between calls counts as a failure, and the next call lints", async () => {
    const eslint = await opened({ now: () => 0 });
    expect((await eslint.lint([bad("HAZARD_LATE")])) as LintRunReport).toHaveProperty("results");
    await new Promise((resolve) => setTimeout(resolve, 400));
    const next = (await eslint.lint([OK])) as LintRunReport;
    expect(next.results.get(OK.path)).toEqual({ findings: [] });
    // The late throw was the first failure: two more turn the provider off.
    expect(await eslint.lint([bad("HAZARD_EXIT")])).toHaveProperty("results");
    expect(await eslint.lint([bad("HAZARD_EXIT")])).toEqual({
      off: "the ESLint worker failed 3 times; the ESLint worker exited with code 3",
    });
  }, 30_000);
});

describe("three failures in 10 minutes (spec 017 D3, D9)", () => {
  it("turn the provider off until a refresh above none", async () => {
    let now = 0;
    const eslint = await opened({ now: () => now });
    const reason = "the ESLint worker exited with code 3";
    for (const _ of [1, 2]) {
      const report = (await eslint.lint([bad("HAZARD_EXIT")])) as LintRunReport;
      expect(report.results.get("src/bad.js")).toEqual({ unknown: reason });
      now += 4 * 60_000;
    }
    const off = { off: `the ESLint worker failed 3 times; ${reason}` };
    expect(await eslint.lint([bad("HAZARD_EXIT")])).toEqual(off);
    expect(await eslint.lint([OK])).toEqual(off);
    expect(await eslint.refresh("none")).toEqual(off);
    await expect(eslint.inputs([OK.path])).rejects.toThrow(off.off);

    expect(await eslint.refresh("instance")).toHaveProperty("closure");
    const report = (await eslint.lint([OK])) as LintRunReport;
    expect(report.results.get(OK.path)).toEqual({ findings: [] });
  }, 60_000);

  it("do not add up across more than 10 minutes", async () => {
    let now = 0;
    const eslint = await opened({ now: () => now });
    for (const _ of [1, 2, 3]) {
      const report = (await eslint.lint([bad("HAZARD_EXIT")])) as LintRunReport;
      expect(report).toHaveProperty("results");
      now += 6 * 60_000;
    }
    expect(await eslint.lint([OK])).toHaveProperty("results");
  }, 60_000);

  it("start again at zero after close and open", async () => {
    let now = 0;
    const eslint = provider(project("hazard"), { now: () => now });
    await eslint.open();
    for (const _ of [1, 2]) await eslint.lint([bad("HAZARD_EXIT")]);
    await eslint.close();
    expect(await eslint.open()).toHaveProperty("tool", "eslint");
    now += 1;
    const report = (await eslint.lint([bad("HAZARD_EXIT")])) as LintRunReport;
    expect(report.results.get("src/bad.js")).toEqual({
      unknown: "the ESLint worker exited with code 3",
    });
  }, 60_000);
});
