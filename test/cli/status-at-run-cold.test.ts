import { describe, expect, it, vi } from "vitest";
import { parseAt } from "../../src/cli/status-at.js";
import { fixture, git } from "../commit/at-keys-fixture.js";
import { clean, run } from "./status-at-kit.js";

/*
 * Row 023-34 (T1): no `--run` call is refused, before it runs or while it
 * runs (the human, 2026-11-21, after the wave-20 re-review, B4). Two
 * guesses at the fit refused selections that fit: 20 s per round of files
 * at once refused 16 tiny files at width 1 that ran in 10.5 s; the first
 * batch's rate, when the first file was the one slow one, refused 16
 * files that ran on both sides in under a minute. Each call now runs to
 * its budget and compares. Both witnesses here: the parent's width is 1
 * (two CPUs), the store is empty, the budget is the default 300 s.
 */

vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  availableParallelism: () => 2,
}));

/** A test that imports `../src/a`, checks its `value`, and first waits `waitMs`. */
const testOf = (value: number, waitMs = 0) =>
  [
    'import { expect, it } from "vitest";',
    'import { value } from "../src/a";',
    `it("value", async () => { await new Promise((done) => setTimeout(done, ${waitMs})); expect(value).toBe(${value}); }, 60_000);`,
    "",
  ].join("\n");

/** Sixteen tests `test/rNN.test.ts`, the first waiting `firstMs`, at the commit and at HEAD. */
async function compared(firstMs: number) {
  const name = (i: number) => `test/r${String(i).padStart(2, "0")}.test.ts`;
  const at = (value: number) =>
    Object.fromEntries(
      Array.from({ length: 16 }, (_, i) => [name(i), testOf(value, i === 0 ? firstMs : 0)]),
    );
  const f = fixture({
    "squeal.config.json": "{}\n",
    "src/a.ts": "export const value = 1;\n",
    ...at(1),
  });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 2;\n", ...at(2) });
  // The default call, as the command line parses it: no `--timeout`, no `--all-missing`.
  const args = parseAt(["--at", a, "--run"]);
  if (typeof args === "string") throw new Error(args);
  const out = await run(f, args);
  clean(f);
  return out;
}

describe("a --run call runs to its budget and compares (review wave-20 B4)", () => {
  it("16 tiny files at width 1", { timeout: 300_000 }, async () => {
    const out = await compared(0);
    expect(out.out, out.err).not.toMatch(/ran nothing|stopped after|clearly do not fit/);
    expect(out.out).toContain("0 pass -> fail, 0 fail -> pass, 16 unchanged, 0 unknown");
    expect(out.code).toBe(0);
  });

  it("a slow first file, then 15 fast ones", { timeout: 400_000 }, async () => {
    const out = await compared(21_000);
    expect(out.out, out.err).not.toMatch(/ran nothing|stopped after|clearly do not fit/);
    expect(out.out).toContain("0 pass -> fail, 0 fail -> pass, 16 unchanged, 0 unknown");
    expect(out.code).toBe(0);
  });
});
