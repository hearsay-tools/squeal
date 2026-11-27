import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type ProofKeys, provenObserved } from "../../src/core/scheduler/proven-observed.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { ObservedInputs } from "../../src/core/types/runner.js";

/*
 * Row 026-38 (#304; review 0.1.662 B1; 011 C4/D4, 016 D4): the paths of a
 * remote run's observation its reader's key keeps, which the run's proof
 * weighs. A path the key already holds stays, also below a directory the
 * run wrote; only a new git-ignored path below such a directory is the
 * run's scratch; the reader's applied runtime files go.
 */

const root = mkdtempSync(join(tmpdir(), "squeal-proven-observed-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
execFileSync("git", ["init", "-q", root]);
writeFileSync(join(root, ".gitignore"), "scratch/\n");

const A: TestFileRef = { project: "", path: "test/a.test.ts" };

/** Keys whose closure of `A` holds `closure`, whose retained observations are `retained`, and that drop `runtime`. */
function keys(
  { closure = [], retained = [], runtime = [] }: Partial<Record<string, readonly string[]>>,
  asked: string[] = [],
): ProofKeys {
  return {
    index: { closure: () => ({ paths: [A.path, ...closure] }) },
    observedOf: () => retained,
    effectiveObserved: (_ref, raw) => {
      asked.push(...raw);
      return raw.filter((path) => !runtime.includes(path));
    },
  };
}

const seen = (paths: string[], written?: string[]): ObservedInputs => ({
  testFile: A,
  paths,
  directories: [],
  ...(written === undefined ? {} : { written }),
});

describe("the observed paths a remote run's proof weighs (row 026-38)", () => {
  it("drops a new git-ignored path below a directory the run wrote, and keeps a new tracked one", async () => {
    const kept = await provenObserved(
      keys({}),
      root,
      seen(["scratch/shot.png", "out/report.json", "src/x.ts"], ["scratch", "out"]),
    );
    expect(kept).toEqual(["out/report.json", "src/x.ts"]);
  });

  it("keeps an ignored path the key retains from an earlier run, though the run wrote its directory (B1)", async () => {
    const kept = await provenObserved(
      keys({ retained: ["scratch/input.json"] }),
      root,
      seen(["scratch/input.json", "scratch/out.json"], ["scratch"]),
    );
    expect(kept).toEqual(["scratch/input.json"]);
  });

  it("keeps an ignored path of the reader's keyed closure below a written directory", async () => {
    const kept = await provenObserved(
      keys({ closure: ["scratch/generated.js"] }),
      root,
      seen(["scratch/generated.js"], ["scratch"]),
    );
    expect(kept).toEqual(["scratch/generated.js"]);
  });

  it("drops the reader's applied runtime files last, kept or new", async () => {
    const asked: string[] = [];
    const kept = await provenObserved(
      keys({ retained: [".ai/env.json"], runtime: [".ai/env.json"] }, asked),
      root,
      seen([".ai/env.json", "src/x.ts"]),
    );
    expect(kept).toEqual(["src/x.ts"]);
    expect(asked).toEqual([".ai/env.json", "src/x.ts"]);
  });

  it("keeps every path when the run wrote no directory", async () => {
    expect(await provenObserved(keys({}), root, seen(["scratch/shot.png"]))).toEqual([
      "scratch/shot.png",
    ]);
  });
});
