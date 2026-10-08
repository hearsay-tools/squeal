import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { StatusSnapshot } from "../../src/core/types/index.js";
import { expectAgrees, headerRevision } from "./agree.js";
import { DEMO, type E2E, e2eSuite, OTHER_SESSION, PLUGINS, STRINGS } from "./harness.js";

/*
 * Spec 003 Testing, end to end: the shipped plugin against a repository
 * shaped like `test/fixtures/node-test/reference` (`packages/demo`, tsx, one
 * preload, `test/unit` and `test/e2e`), configured by the shipped `squeal
 * init` from its scripts, with a Vitest suite beside it (D7). Transitions of
 * a node:test check reach the agent as Vitest's do, an edit runs only the
 * files whose closure holds it, a second worktree inherits with zero runs,
 * and `squeal stop` stops the daemon. Spec 002: each for both plugins.
 * Wall-clock bounds are left to the Vitest suites: settles wait as long as
 * the integration test's, and runs are asserted by the files they ran.
 */

const fixture = e2eSuite("node-test");

const UNIT = "packages/demo/test/unit";
const MATH_TEST = `${UNIT}/math.test.ts`;
const ADDS = `[test:unit] ${MATH_TEST} > adds`;
const SHOUTS = "test/strings.test.ts > shouts";
/** Each project's test files, as `squeal init` seeds the projects from `packages/demo`'s scripts. */
const NODE_TEST_FILES = [
  `${UNIT}/math.test.ts`,
  `${UNIT}/title.test.ts`,
  "packages/demo/test/e2e/package.test.ts",
];
const VITEST_FILES = ["test/math.test.ts", "test/strings.test.ts"];
/**
 * Every test plus each file's file-level check (001 D4): node:test `adds`,
 * `sees the preload`, `title > slugs through the workspace package`, `the
 * workspace package resolves by name`; Vitest `math > adds`, `math >
 * multiplies`, `shouts`.
 */
const CHECKS = 7 + NODE_TEST_FILES.length + VITEST_FILES.length;

const quiet = (s: StatusSnapshot) => s.knownFailures.length === 0;
const failing = (name: string) => (s: StatusSnapshot) => {
  const [only, ...more] = s.knownFailures;
  return (
    more.length === 0 &&
    only?.validity === "current" &&
    only.check.kind === "test" &&
    only.check.fullName === name
  );
};

/** A main worktree whose daemon has settled a passing baseline of every check. */
async function baseline(e: E2E): Promise<StatusSnapshot> {
  const start = await e.hook("session-start", e.main);
  expect(start).toMatchObject({ code: 0, stderr: "" });
  await e.daemonReady(e.main);
  return e.settle(e.main, "a passing baseline", (s) => s.counts.current === CHECKS && quiet(s));
}

/** The test files of the runs of `root` after its first `from` runs. */
const ranSince = (e: E2E, root: string, from: number) =>
  new Set(
    e
      .runs(root)
      .slice(from)
      .flatMap((r) => r.testFiles),
  );

describe.each(PLUGINS)("node:test end to end, $name", (plugin) => {
  it("seeds the projects from the scripts and delivers their transitions on " +
    plugin.boundary, async (ctx) => {
    const e = fixture(ctx, plugin);
    const config = JSON.parse(readFileSync(join(e.main, "squeal.config.json"), "utf8")) as {
      nodeTest: readonly object[];
    };
    expect(config.nodeTest).toEqual([
      {
        name: "test:unit",
        cwd: "packages/demo",
        argv: ["--import", "../../scripts/preload.mjs", "--import", "tsx"],
        include: ["test/unit/*.test.ts"],
      },
      {
        name: "test:package",
        cwd: "packages/demo",
        argv: ["--import", "../../scripts/preload.mjs", "--import", "tsx"],
        include: ["test/e2e/*.test.ts"],
      },
    ]);

    const base = await baseline(e);
    expect(new Set(e.runs(e.main).flatMap((r) => r.testFiles))).toEqual(
      new Set([...NODE_TEST_FILES, ...VITEST_FILES]),
    );
    expect(base.daemonNotes.map((n) => n.text)).toEqual([]);
    const registered = await e.hook("post-tool-batch", e.main);
    expect(registered.text).toMatch(/^SQUEAL · registered at revision \d+\n/);
    expectAgrees(registered.text, await e.status(e.main));

    // PASS -> FAIL in a node:test file: only the file whose closure holds the edit runs.
    let from = e.runs(e.main).length;
    const broken = await e.edit(e.main, "demo", DEMO("-"), failing("adds"));
    expect(ranSince(e, e.main, from)).toEqual(new Set([MATH_TEST]));
    const fail = await e.hook("post-tool-batch", e.main);
    expect(fail).toMatchObject({ code: 0, stderr: "" });
    expect(fail.text).toMatch(/^SQUEAL · 1 check changed at revision \d+\n/);
    expect(headerRevision(fail.text ?? "")).toBe(broken.revision);
    expect(fail.text).toContain(
      `FAIL  ${ADDS}\n      PASS -> FAIL, seen by Squeal's run at revision ${broken.revision}`,
    );
    expectAgrees(fail.text, await e.status(e.main));
    expect((await e.hook("post-tool-batch", e.main)).stdout).toBe("");

    // FAIL -> PASS.
    from = e.runs(e.main).length;
    const fixed = await e.edit(e.main, "demo", DEMO(), quiet);
    expect(ranSince(e, e.main, from)).toEqual(new Set([MATH_TEST]));
    const pass = await e.hook("post-tool-batch", e.main);
    expect(headerRevision(pass.text ?? "")).toBe(fixed.revision);
    expect(pass.text).toContain(`PASS  ${ADDS}\n      FAIL -> PASS`);
    expect(pass.text).not.toContain("FAIL  ");
    expectAgrees(pass.text, await e.status(e.main));

    // The Vitest file beside them keeps validating, and runs alone.
    from = e.runs(e.main).length;
    await e.edit(e.main, "strings", STRINGS("?"), failing("shouts"));
    expect(ranSince(e, e.main, from)).toEqual(new Set(["test/strings.test.ts"]));
    const vitest = await e.hook("post-tool-batch", e.main);
    expect(vitest.text).toContain(`FAIL  ${SHOUTS}\n      PASS -> FAIL`);
    expectAgrees(vitest.text, await e.status(e.main));

    // `squeal stop` stops the daemon.
    const ping = await e.ping(e.main);
    expect(ping?.phase).toBe("ready");
    const stop = await e.cli(e.main, ["stop"]);
    expect(stop.code).toBe(0);
    expect(await e.ping(e.main)).toBeNull();
  }, 300_000);

  it("inherits into a second worktree with zero runs", async (ctx) => {
    const e = fixture(ctx, plugin);
    const main = await baseline(e);
    const wt2 = e.addWorktree();
    const start = await e.hook("session-start", wt2, { session_id: OTHER_SESSION });
    expect(start.text).toMatch(/^SQUEAL · registered at revision \d+\n/);
    await e.daemonReady(wt2);
    const second = await e.settle(
      wt2,
      "the second worktree's baseline",
      (s) => s.counts.current === CHECKS,
    );
    expect(e.runs(wt2)).toEqual([]);
    expect(second.inherited.count).toBe(main.counts.current);
    expect(second.knownFailures).toEqual([]);

    // The second worktree validates its own edits from there, node:test files included.
    const broken = await e.edit(wt2, "demo", DEMO("-"), failing("adds"));
    expect(new Set(e.runs(wt2).flatMap((r) => r.testFiles))).toEqual(new Set([MATH_TEST]));
    const told = await e.hook("post-tool-batch", wt2, { session_id: OTHER_SESSION });
    expect(told.text).toContain(`FAIL  ${ADDS}\n      PASS -> FAIL`);
    expect(headerRevision(told.text ?? "")).toBe(broken.revision);
    expect((await e.status(e.main)).knownFailures).toEqual([]);
  }, 300_000);
});
