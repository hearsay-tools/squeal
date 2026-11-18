import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OutOfBudget, ownHome, placeKeep } from "../../src/core/proof/own-home.js";
import type { AbsolutePath } from "../../src/core/types/common.js";

/*
 * Row 023-18 N1 (`reviews/wave-9-rereview.md`): checking and copying the
 * `--home-keep` paths count toward the one `--timeout`. Past the deadline
 * the walk and the copy stop at the next file or folder; the side's files
 * then read `not run (budget)` (`proof-run.ts`), and no run copies anything.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A HOME with `.kept/` holding `n` files, a link deep inside, and a hidden `.secret`. */
function homeOf(n: number, linkInside: boolean): string {
  const root = mkdtempSync(join(tmpdir(), "sq-own-home-budget-"));
  dirs.push(root);
  const home = join(root, "home");
  mkdirSync(join(home, ".kept", "deep"), { recursive: true });
  for (let i = 0; i < n; i++) writeFileSync(join(home, ".kept", `f${i}`), `${i}\n`);
  if (linkInside) symlinkSync(join(home, ".secret"), join(home, ".kept", "deep", "z-link"));
  writeFileSync(join(home, ".secret"), "secret\n");
  return home;
}

describe("own HOME within the budget (row 023-18 N1)", () => {
  it("copies nothing past the deadline, and says it ran out of budget", () => {
    const home = homeOf(50, false);
    const into = join(home, "..", "own");
    const past = performance.now() - 1;
    expect(() => ownHome(home, [".secret"], [".kept"], into, past)).toThrow(OutOfBudget);
    const copied = readdirSync(into, { recursive: true }).filter((p) =>
      String(p).startsWith(".kept/f"),
    );
    expect(copied).toEqual([]);
  });

  it("copies every kept file before the deadline", () => {
    const home = homeOf(50, false);
    const into = join(home, "..", "own");
    ownHome(home, [".secret"], [".kept"], into, performance.now() + 60_000);
    expect(readdirSync(join(into, ".kept")).filter((p) => p.startsWith("f"))).toHaveLength(50);
  });

  it("stops checking a kept tree past the deadline instead of walking all of it", () => {
    const home = homeOf(50, true);
    const cwd = home as AbsolutePath;
    // In time, the walk finds the link deep in the tree.
    expect(placeKeep(".kept", cwd, home, [".secret"], performance.now() + 60_000)).toEqual({
      usage: "--home-keep .kept: ~/.kept/deep/z-link is a link; a kept path must hold none",
    });
    // Past the deadline it stops: no side runs then, and `ownHome` refuses a link on its own.
    expect(placeKeep(".kept", cwd, home, [".secret"], performance.now() - 1)).toEqual({
      given: ".kept",
      path: ".kept",
    });
  });
});
