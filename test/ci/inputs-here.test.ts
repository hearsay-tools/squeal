import { rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inputsOfReadsHere, listingsBelowHere } from "../../src/core/ci/inputs.js";
import { initRepo, tempDir, writeFile } from "../hash/git-repo.js";

/*
 * Row 020-20: `inputsOfReads`, the one rule for the inputs of a run-time
 * read beyond its closure, which the daemon's record and the gate's
 * `--parts` both key by. The gate's `inputsOfReadsHere` lists a recursive
 * listing's directories from the files git does not ignore now, as the
 * daemon's keys list them.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function repo(): string {
  const { path, cleanup } = tempDir("squeal-observed-inputs-");
  cleanups.push(cleanup);
  initRepo(path, {
    ".gitignore": "out/\nfixtures/ignored/\n",
    "data/x.txt": "x\n",
    "fixtures/tracked/a.txt": "a\n",
    "fixtures/deleted/b.txt": "b\n",
  });
  return path;
}

describe("listingsBelowHere (row 020-20)", () => {
  it("lists each directory below that holds a file git does not ignore, untracked too, a deleted one not", async () => {
    const root = repo();
    writeFile(root, "fixtures/untracked/c.txt", "c\n");
    writeFile(root, "fixtures/ignored/d.txt", "d\n");
    rmSync(join(root, "fixtures/deleted/b.txt"));

    const below = await listingsBelowHere(root, ["fixtures"]);

    expect(below("fixtures")).toEqual(["fixtures/", "fixtures/tracked/", "fixtures/untracked/"]);
  });

  it("asks git nothing when no listing is recursive", async () => {
    const below = await listingsBelowHere("/nowhere", []);
    expect(below("fixtures")).toEqual(["fixtures/"]);
  });
});

describe("inputsOfReadsHere (row 020-20)", () => {
  it("adds a link's target, a recursive listing's directories below, and leaves out the closure and the run's scratch", async () => {
    const root = repo();
    symlinkSync("data", join(root, "linked"));
    const observed = {
      paths: ["src/a.ts", "linked/x.txt", "out/run.json"],
      directories: ["fixtures"],
      recursive: ["fixtures"],
      written: ["out"],
    };

    const inputs = await inputsOfReadsHere(root, [{ closure: new Set(["src/a.ts"]), observed }]);

    expect([...(inputs[0] ?? [])].sort()).toEqual([
      "data/x.txt",
      "fixtures/",
      "fixtures/deleted/",
      "fixtures/tracked/",
      "linked/x.txt",
    ]);
  });
});
