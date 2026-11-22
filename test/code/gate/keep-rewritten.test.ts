import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorktreePaths } from "../../../src/core/fs/worktree-paths.js";
import type { ObservedInputs } from "../../../src/core/types/runner.js";
import { observedInputs } from "../../../src/runners/observe/inputs.js";
import type { RecordedFile } from "../../../src/runners/observe/read.js";
import { A, keep, READ, resultsAt, rowsOf, worktree } from "./keep-grown-kit.js";

/*
 * Review 0.1.598 B1 (row 023-47, spec 023 D2): a tracked file the run read,
 * removed and replaced with a directory is an input the run changed. The
 * observer names it as rewritten whatever stands at its path after the
 * run, the core keys it as git tracks it, and the real keeper stores no
 * result at the key from before the run, which omits it, and merges the
 * read, so every later key covers it.
 */

describe("squeal code keeps no file whose run replaced a tracked file it read with a directory", () => {
  it("stores nothing at the key it ran under, and merges the read", async () => {
    const at = await worktree();
    const notes: string[] = [];
    const observed: { -readonly [K in keyof ObservedInputs]: ObservedInputs[K] } = {
      testFile: A,
      paths: [],
      directories: [],
    };

    const ran = await keep(at, notes, {
      observed,
      started: () => {
        const abs = join(at.root, READ);
        readFileSync(abs, "utf8");
        rmSync(abs);
        mkdirSync(abs);
        const entry: RecordedFile = {
          paths: new Set([abs]),
          listed: new Set(),
          recursive: new Set(),
          written: new Set([abs]),
          direct: new Set(),
          modules: new Set(),
        };
        const [seen] = observedInputs(
          new Map([[join(at.root, A.path), entry]]),
          [A],
          new WorktreePaths(at.root),
        );
        if (seen !== undefined) Object.assign(observed, seen);
      },
    });

    expect(resultsAt(at.commonDir, ran)).toBe(0);
    expect(rowsOf(at.commonDir)[0]).toEqual([READ]);
    expect(observed.rewritten).toEqual([READ]);
  });
});
