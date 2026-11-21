import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { endpointsAfter, endpointsBefore } from "../../src/core/ci/endpoints.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { initRepo, tempDir } from "../hash/git-repo.js";

/*
 * Row 018-67: an end of the endpoint hashing in a child process
 * (`squeal ci endpoints-child`) gives what it gives in this process, and a
 * child that ends without a result is an error, which `ci record` prints
 * as a note.
 */

const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const CHILD = resolve(import.meta.dirname, "endpoints-child-entry.ts");
const RELAUNCH = [process.execPath, "--import", TSX, CHILD];
const SLOW = { timeout: 60_000 } as const;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function repo(): AbsolutePath {
  const { path, cleanup } = tempDir("squeal-endpoints-child-");
  cleanups.push(cleanup);
  initRepo(path, { "a.txt": "a\n", "src/b.ts": "b\n", "src/c.ts": "c\n" });
  return path as AbsolutePath;
}

describe("endpoint hashing in a child process", () => {
  it("gives both ends as this process does", SLOW, async () => {
    const root = repo();
    writeFileSync(join(root, "a.txt"), "changed before\n");
    const here = await endpointsBefore(root, "sha1");
    const there = await endpointsBefore(root, "sha1", { relaunch: RELAUNCH });
    if (typeof here === "string" || typeof there === "string") throw new Error(`${here}`);
    expect(there.commit).toBe(here.commit);
    expect(there.paths).toEqual(here.paths);
    expect(there.committed).toEqual(here.committed);
    expect(there.hashes).toEqual(here.hashes);
    writeFileSync(join(root, "src/b.ts"), "changed during\n");
    const ends = await endpointsAfter(there);
    if (typeof ends === "string") throw new Error(ends);
    expect(Object.keys(ends.stable).sort()).toEqual(["./", "a.txt"]);
    expect(ends.unstable).toEqual(["src/b.ts"]);
  });

  it("is an error when the child ends without a result", SLOW, async () => {
    const root = repo();
    const relaunch = [process.execPath, "-e", 'process.stderr.write("broken\\n"); process.exit(3)'];
    await expect(endpointsBefore(root, "sha1", { relaunch })).rejects.toThrow(
      "its process ended with exit code 3 without a result: broken",
    );
  });
});
