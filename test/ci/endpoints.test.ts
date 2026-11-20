import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { endpointsAfter, endpointsBefore } from "../../src/core/ci/endpoints.js";
import { listingHash } from "../../src/core/ci/inputs.js";
import { ABSENT_LISTING } from "../../src/core/keys/observed.js";
import { git, gitHashObject, initRepo, tempDir } from "../hash/git-repo.js";

/*
 * Spec 018 D30 and D32 (row 018-57): the hashes `ci record` takes before and
 * after the command. Every path the commit holds is hashed at both ends,
 * also when gone from the disk. `stable`: equal at both ends and other than
 * the commit, with the hash; `unstable`: unequal; in neither: the commit's
 * content at both ends. A path the commit does not hold is not hashed.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function repo(): string {
  const { path, cleanup } = tempDir("squeal-endpoints-");
  cleanups.push(cleanup);
  initRepo(path, {
    "a.txt": "a\n",
    "src/b.ts": "b\n",
    "src/c.ts": "c\n",
    "gone/d.txt": "d\n",
  });
  return path;
}

/** The endpoints around `during`, which stands for the command. */
async function around(root: string, during: () => void) {
  const before = await endpointsBefore(root, "sha1");
  if (typeof before === "string") throw new Error(before);
  during();
  return endpointsAfter(before);
}

describe("endpoint hashes", () => {
  it("in a clean checkout, holds only the root's listing, which `.git` makes differ from the commit", async () => {
    const root = repo();
    const ends = await around(root, () => {});
    expect(ends).toEqual({
      stable: { "./": listingHash(root, "") },
      unstable: [],
      ms: expect.any(Number),
    });
    expect(typeof ends === "string" ? 0 : ends.ms).toBeGreaterThan(0);
  });

  it("holds a tracked file gone before the command as null, and its emptied directory as absent", async () => {
    const root = repo();
    rmSync(join(root, "gone"), { recursive: true });
    rmSync(join(root, "src/c.ts"));
    const ends = await around(root, () => {});
    expect(ends).toEqual({
      stable: {
        "./": listingHash(root, ""),
        "gone/": ABSENT_LISTING,
        "gone/d.txt": null,
        "src/": listingHash(root, "src"),
        "src/c.ts": null,
      },
      unstable: [],
      ms: expect.any(Number),
    });
  });

  it("holds a changed tracked file named like an Object property as its own entry (review 0.1.582 B1)", async () => {
    const { path: root, cleanup } = tempDir("squeal-endpoints-proto-");
    cleanups.push(cleanup);
    initRepo(
      root,
      Object.fromEntries([
        ["__proto__", "BAD\n"],
        ["constructor", "c\n"],
        ["src/toString", "t\n"],
      ]),
    );
    for (const name of ["__proto__", "constructor", "src/toString"])
      writeFileSync(join(root, name), "GOOD\n");
    const ends = await around(root, () => {});
    if (typeof ends === "string") throw new Error(ends);
    const read = JSON.parse(JSON.stringify(ends.stable)) as Record<string, unknown>;
    for (const name of ["__proto__", "constructor", "src/toString"]) {
      expect(Object.hasOwn(ends.stable, name), name).toBe(true);
      expect(ends.stable[name], name).toBe(gitHashObject(root, name));
      expect(Object.hasOwn(read, name), `${name} after a JSON round trip`).toBe(true);
    }
  });

  it("holds a file changed before the command and kept, with its hash", async () => {
    const root = repo();
    writeFileSync(join(root, "a.txt"), "changed\n");
    const ends = await around(root, () => {});
    expect(ends).toEqual({
      stable: { "./": listingHash(root, ""), "a.txt": gitHashObject(root, "a.txt") },
      unstable: [],
      ms: expect.any(Number),
    });
  });

  it("names a file changed during the command and not restored, and a listing a new file changed", async () => {
    const root = repo();
    const ends = await around(root, () => {
      writeFileSync(join(root, "src/b.ts"), "changed\n");
      writeFileSync(join(root, "src/new.ts"), "new\n");
      mkdirSync(join(root, "made"));
    });
    expect(ends).toEqual({
      stable: {},
      unstable: ["./", "src/", "src/b.ts"],
      ms: expect.any(Number),
    });
    // The untracked file is not hashed.
    expect(JSON.stringify(ends)).not.toContain("src/new.ts");
  });

  it("reads a file changed and restored during the command as the commit's at both ends", async () => {
    const root = repo();
    const ends = await around(root, () => {
      writeFileSync(join(root, "src/b.ts"), "changed\n");
      writeFileSync(join(root, "src/b.ts"), "b\n");
    });
    expect(ends).toEqual({
      stable: { "./": listingHash(root, "") },
      unstable: [],
      ms: expect.any(Number),
    });
  });

  it("takes none when HEAD moves during the command, or the checkout has no commit", async () => {
    const root = repo();
    const ends = await around(root, () => {
      git(root, ["commit", "-q", "--allow-empty", "-m", "moved"]);
    });
    expect(ends).toMatch(/^HEAD moved during the command/);
    const { path: empty, cleanup } = tempDir("squeal-endpoints-empty-");
    cleanups.push(cleanup);
    git(empty, ["init", "-q"]);
    expect(await endpointsBefore(empty, "sha1")).toMatch(/no commit/);
  });
});
