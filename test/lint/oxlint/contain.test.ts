import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LintFile } from "../../../src/core/lint/pass/provider.js";
import type { RelativePath } from "../../../src/core/types/index.js";
import { alive, badPlugin, project, provider } from "./helpers.js";

/*
 * Spec 017 D11 "Running", D3, D9: a JS plugin that blocks, throws or exits
 * gives its part `unknown` with the reason, and no process of the run's
 * group outlives it: a kill of oxlint's pid alone leaves its children
 * running (`research/oxlint-provider.md` Q3, Faults).
 */

const A = "src/a.js" as RelativePath;
const file = (root: string): LintFile => ({
  path: A,
  text: readFileSync(join(root, A), "utf8"),
});

/**
 * Starts a child in the run's group that outlives oxlint, its pid in
 * `child.pid`; unref'd, so oxlint's own process does not wait for it.
 */
const CHILD = `const c = spawn("sleep", ["30"], { stdio: "ignore" }); c.unref(); writeFileSync("child.pid", String(c.pid));`;

async function waitDead(pid: number): Promise<boolean> {
  for (let i = 0; i < 40 && alive(pid); i++) await new Promise((r) => setTimeout(r, 50));
  return !alive(pid);
}

// Each case starts oxlint once or more: about 0.3 s of CPU each, longer under the host's load.
describe("a JS plugin that fails", { timeout: 30_000 }, () => {
  it("blocks: the guard ends the part as `unknown` and kills the whole group", async () => {
    const root = project(
      badPlugin(`${CHILD} Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);`),
    );
    const lint = provider(root, { guardMs: 2_000 });
    expect(await lint.open()).toMatchObject({ tool: "oxlint" });
    const report = await lint.lint([file(root)]);
    expect(report).toMatchObject({ results: new Map([[A, { unknown: "timed out after 2 s" }]]) });
    const pid = Number(readFileSync(join(root, "child.pid"), "utf8"));
    expect(await waitDead(pid)).toBe(true);
  });

  it("throws: its file reads `unknown`, naming the error", async () => {
    const root = project(badPlugin(`throw new Error("rule exploded");`));
    const lint = provider(root);
    await lint.open();
    const report = await lint.lint([file(root)]);
    expect(report).toMatchObject({
      results: new Map([[A, { unknown: "a JS plugin failed: Error: rule exploded" }]]),
    });
  });

  it("throws late, outside a rule: the part reads `unknown`", async () => {
    const root = project(badPlugin(`setTimeout(() => { throw new Error("late"); }, 0);`));
    const lint = provider(root);
    await lint.open();
    const report = await lint.lint([file(root)]);
    expect(report).toMatchObject({
      results: new Map([[A, { unknown: "oxlint's JavaScript side threw: late" }]]),
    });
  });

  it("exits: the part reads `unknown`", async () => {
    const root = project(badPlugin("process.exit(7);"));
    const lint = provider(root);
    await lint.open();
    const report = await lint.lint([file(root)]);
    expect(report).toMatchObject({
      results: new Map([[A, { unknown: "oxlint exited with code 7" }]]),
    });
  });

  it("exits after starting a child: the child is killed with the group", async () => {
    const root = project(badPlugin(`${CHILD} process.exit(7);`));
    const lint = provider(root);
    await lint.open();
    const report = await lint.lint([file(root)]);
    expect(report).toMatchObject({ results: new Map([[A, { unknown: expect.any(String) }]]) });
    const pid = Number(readFileSync(join(root, "child.pid"), "utf8"));
    expect(await waitDead(pid)).toBe(true);
  });

  it("starts a process and returns: the part reads `unknown`, naming the plugin", async () => {
    const root = project(badPlugin(CHILD));
    const lint = provider(root);
    await lint.open();
    const report = await lint.lint([file(root)]);
    const result = report && "results" in report ? report.results.get(A) : undefined;
    expect(result).toEqual({
      unknown: `oxlint's JavaScript side started a process by ${join(root, "bad.mjs")}`,
    });
    const pid = Number(readFileSync(join(root, "child.pid"), "utf8"));
    expect(await waitDead(pid)).toBe(true);
  });

  it("turns the provider off at the third failure in 10 minutes, until a refresh above none", async () => {
    const root = project(badPlugin("process.exit(7);"));
    let now = 0;
    const lint = provider(root, { now: () => now });
    await lint.open();
    await lint.lint([file(root)]);
    now += 60_000;
    await lint.lint([file(root)]);
    now += 60_000;
    expect(await lint.lint([file(root)])).toEqual({
      off: "the oxlint run failed 3 times; oxlint exited with code 7",
    });
    expect(await lint.refresh("none")).toMatchObject({ off: expect.any(String) });
    expect(await lint.refresh("instance")).toMatchObject({ declaration: { tool: "oxlint" } });
  });

  it("a failure older than 10 minutes does not count", async () => {
    const root = project(badPlugin("process.exit(7);"));
    let now = 0;
    const lint = provider(root, { now: () => now });
    await lint.open();
    await lint.lint([file(root)]);
    now += 11 * 60_000;
    await lint.lint([file(root)]);
    now += 60_000;
    expect(await lint.lint([file(root)])).toMatchObject({ results: expect.any(Map) });
  });
});
