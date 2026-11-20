import { describe, expect, it } from "vitest";
import { fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { clean, run, testOf } from "./status-at-kit.js";

/*
 * Row 023-29 (lessons round 4, R1 and R3) on `$TMPDIR` git fixtures with
 * the real Vitest adapter and no daemon. R1: `--run` also runs, in the
 * working tree, the files the change selects that have no result there,
 * so one call compares both sides; round 4 left the current side `no
 * result` on an empty store. R3: a batch whose global setup throws reads
 * as a setup failure with its group and text on each side, never as the
 * budget, and offers no rerun with a longer `--timeout`.
 */

const TEST = ref("test/a.test.ts");
const PLAIN = ref("test/plain.test.ts");
const RUN = { allMissing: false, timeoutSeconds: 600 };

/** Commit A: `a.test.ts` and `plain.test.ts`; HEAD changes `src/a.ts` and `a.test.ts`. */
function changed(extra: Readonly<Record<string, string>> = {}) {
  const f = fixture({
    "squeal.config.json": "{}\n",
    "src/a.ts": "export const value = 1;\n",
    [TEST.path]: testOf("a", 1),
    "src/plain.ts": "export const value = 1;\n",
    [PLAIN.path]: testOf("plain", 1),
    ...extra,
  });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 2;\n", [TEST.path]: testOf("a", 2) });
  return { f, a };
}

type Side = { state: string; origin?: { kind: string } };
const fileOf = (out: string, path: string) =>
  (JSON.parse(out).files as { path: string; at: Side; now: Side; change: string }[]).find(
    (file) => file.path === path,
  );

describe("status --at --run answers both sides (row 023-29, R1)", SLOW, () => {
  it("runs the selected file in the working tree too, as an ordinary worktree result", async () => {
    const { f, a } = changed();
    const options = { cacheRoot: f.cacheRoot, install: linkInstall().install };
    const json = await run(f, { commit: a, json: true, run: RUN }, options);
    expect(json.code).toBe(3);
    expect(fileOf(json.out, TEST.path)).toMatchObject({
      at: { state: "pass", origin: { kind: "run" } },
      now: { state: "pass", origin: { kind: "own" } },
      change: "unchanged",
    });
    // Not selected by the change: neither side ran it.
    expect(fileOf(json.out, PLAIN.path)?.now.state).toBe("no result");
    expect(JSON.parse(json.out).run.now).toMatchObject({
      how: "gate",
      selected: 1,
      ran: 1,
      notRun: 0,
      setupFailed: [],
      problem: null,
    });

    // The working tree's result is stored: the next call reads it and runs nothing now.
    const text = await run(f, { commit: a, run: RUN }, options);
    expect(text.out).toContain("0 pass -> fail, 0 fail -> pass, 1 unchanged, 1 unknown");
    expect(text.out).toContain(
      "--run, now: every test file the change selects has a result in the working tree",
    );
    clean(f);
  });
});

describe("status --at --run reports a failed batch setup (row 023-29, R3)", SLOW, () => {
  it("names the group and the setup's error on both sides, not the budget", async () => {
    const { f, a } = changed({
      "vitest.config.mjs":
        'export default { test: { include: ["test/*.test.ts"], globalSetup: ["./setup.mjs"] } };\n',
      "setup.mjs":
        'export default function setup() {\n  throw new Error("Chrome failed to launch\\nsecond line");\n}\n',
    });
    const options = { cacheRoot: f.cacheRoot, install: linkInstall().install };
    const text = await run(f, { commit: a, run: RUN }, options);
    const at = a.slice(0, 9);
    expect(text.out).toMatch(
      /\n1 not run: the batch's setup failed \(tests: global setup \S*setup\.mjs failed: Chrome failed to launch[^\n]*\)\n/,
    );
    expect(text.out).toMatch(
      /\nnow: 1 not run: the batch's setup failed \(tests: global setup \S*setup\.mjs failed: Chrome failed to launch[^\n]*\)\n/,
    );
    expect(text.out).toContain(`${TEST.path}: not run (the batch's setup failed: tests: `);
    expect(text.out).not.toContain("not run (budget)");
    expect(text.out).not.toContain("--timeout");
    expect(text.out).not.toContain("second line");
    const json = await run(f, { commit: a, json: true, run: RUN }, options);
    const value = JSON.parse(json.out).run;
    expect(value).toMatchObject({ selected: 1, ran: 0, notRun: 0, rerun: null });
    expect(value.setupFailed).toHaveLength(1);
    expect(value.setupFailed[0].files).toBe(1);
    expect(fileOf(json.out, TEST.path)?.at).toMatchObject({ state: "not run", reason: "setup" });
    expect(at).toHaveLength(9);
    clean(f);
  });
});

/** A test whose time is `src/a.ts`'s `delay`, in ms. */
const WAITS = [
  'import { expect, it } from "vitest";',
  'import { delay } from "../src/a";',
  'it("waits", async () => {',
  "  await new Promise((done) => setTimeout(done, delay));",
  "  expect(delay).toBeGreaterThanOrEqual(0);",
  "}, 120_000);",
  "",
].join("\n");

describe("one budget over two sides of different lengths (review wave-18 note 3)", SLOW, () => {
  it("ends inside the budget: the quick side's result, the slow side cut, the time left given back", async () => {
    // The test waits 60 s at the commit and not at all now; the one budget is 40 s.
    const f = fixture({
      "squeal.config.json": "{}\n",
      "src/a.ts": "export const delay = 60_000;\n",
      [TEST.path]: WAITS,
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "src/a.ts": "export const delay = 0;\n" });
    const budget = 40;
    const options = { cacheRoot: f.cacheRoot, install: linkInstall().install };
    const json = await run(
      f,
      { commit: a, json: true, run: { allMissing: false, timeoutSeconds: budget } },
      options,
    );
    expect(json.code).toBe(3);
    const value = JSON.parse(json.out);
    expect(fileOf(json.out, TEST.path)).toMatchObject({
      at: { state: "not run", reason: "budget" },
      now: { state: "pass", origin: { kind: "own" } },
      change: "unknown",
    });
    expect(value.run).toMatchObject({
      selected: 1,
      ran: 0,
      notRun: 1,
      timedOut: true,
      rerun: null,
      now: { how: "gate", selected: 1, ran: 1, notRun: 0 },
    });
    // The hard stop holds over both sides; the commit side took the working tree's unused time:
    // a first pass at its share, and a second one after the working tree's turn.
    expect(value.run.usedMs).toBeLessThan((budget + 10) * 1000);
    expect(value.run.batches.length).toBe(2);
    expect(value.run.gateMs).toBeGreaterThan(value.run.now.gateMs);
    clean(f);
  });
});
