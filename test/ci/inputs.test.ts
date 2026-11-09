import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type CheckoutState,
  joinCheckouts,
  listingHash,
  readCheckout,
  uncertified,
  withInputs,
} from "../../src/core/ci/inputs.js";
import type { PartFile } from "../../src/core/ci/parts.js";
import { createFsHasher } from "../../src/core/hash/hasher.js";
import { ABSENT_LISTING } from "../../src/core/keys/observed.js";

/*
 * Spec 018 D8 and D9 (review of 0.1.421 B1): what a part certifies about the
 * content of a file's inputs, and what the export compares it with. A
 * recorded input must be equal; an unrecorded one counts only from a clean
 * shard, as the commit's blob, or as no file where git reported no
 * untracked or ignored entry. Never an unrecorded listing.
 */

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function repository(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "squeal-ci-inputs-")));
  temps.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
}

const CLEAN: CheckoutState = { clean: true, untracked: ["data/", "src/gen.ts"] };
const COMMITTED = new Map([["src/a.ts", "blob-a"]]);

describe("uncertified (spec 018 D9)", () => {
  const here = (hashes: Record<string, string | null>) => (path: string) => hashes[path];

  it("takes a recorded input only at the recorded content", () => {
    const recorded = { "data/v.txt": "good", "data/": "names", "gone.txt": null };
    const now = { "data/v.txt": "good", "data/": "names", "gone.txt": null };
    const paths = Object.keys(recorded);
    expect(uncertified(paths, recorded, CLEAN, COMMITTED, here(now))).toEqual([]);
    const bad = { ...now, "data/v.txt": "bad", "gone.txt": "back" };
    expect(uncertified(paths, recorded, CLEAN, COMMITTED, here(bad))).toEqual([
      "data/v.txt",
      "gone.txt",
    ]);
  });

  it("takes an unrecorded tracked input from a clean shard as the commit's blob", () => {
    const paths = ["src/a.ts"];
    expect(uncertified(paths, {}, CLEAN, COMMITTED, here({ "src/a.ts": "blob-a" }))).toEqual([]);
    expect(uncertified(paths, {}, CLEAN, COMMITTED, here({ "src/a.ts": "other" }))).toEqual(paths);
    const dirty = { ...CLEAN, clean: false };
    expect(uncertified(paths, {}, dirty, COMMITTED, here({ "src/a.ts": "blob-a" }))).toEqual(paths);
  });

  it("takes an unrecorded path the commit lacks only as no file, below no untracked entry", () => {
    const absent = here({ "test/__snapshots__/a.snap": null, "src/gen.ts": null, "data/x": null });
    expect(uncertified(["test/__snapshots__/a.snap"], undefined, CLEAN, COMMITTED, absent)).toEqual(
      [],
    );
    // The shard may have held either: git reported it, or a directory above it, as ignored.
    expect(uncertified(["src/gen.ts", "data/x"], undefined, CLEAN, COMMITTED, absent)).toEqual([
      "src/gen.ts",
      "data/x",
    ]);
    const present = here({ "test/__snapshots__/a.snap": "made" });
    expect(uncertified(["test/__snapshots__/a.snap"], {}, CLEAN, COMMITTED, present)).toEqual([
      "test/__snapshots__/a.snap",
    ]);
  });

  it("never takes an unrecorded listing, `.git`, or a path this checkout has no hash of", () => {
    const now = here({ "src/": "names", ".git": "kind" });
    expect(uncertified(["src/", ".git", "src/b.ts"], {}, CLEAN, COMMITTED, now)).toEqual([
      "src/",
      ".git",
      "src/b.ts",
    ]);
  });
});

describe("the checkout a part records", () => {
  it("is clean while no tracked file changed, and lists untracked and ignored entries", async () => {
    const root = repository({ ".gitignore": "data/\n", "tracked.txt": "t\n" });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "f"], {
      cwd: root,
    });
    mkdirSync(join(root, "data"));
    writeFileSync(join(root, "data/v.txt"), "GOOD\n");
    mkdirSync(join(root, "gen"));
    writeFileSync(join(root, "gen/new.ts"), "x\n");
    const before = await readCheckout(root);
    expect(before).toEqual({ clean: true, untracked: ["data/", "gen/"] });
    writeFileSync(join(root, "tracked.txt"), "changed\n");
    const after = await readCheckout(root);
    expect(after.clean).toBe(false);
    expect(joinCheckouts(before, { clean: true, untracked: ["b.txt"] })).toEqual({
      clean: true,
      untracked: ["b.txt", "data/", "gen/"],
    });
    expect(joinCheckouts(before, after).clean).toBe(false);
    // A checkout git cannot read certifies nothing, and never throws before the command.
    expect(await readCheckout(join(root, "missing"))).toEqual({ clean: false, untracked: [] });
  });
});

describe("withInputs", () => {
  it("hashes each read as git does, each listing and each directory below a recursive one", async () => {
    const root = repository({ "data/v.txt": "GOOD\n", "fix/a/b/c.txt": "c\n" });
    const file: PartFile = {
      project: "",
      path: "test/a.test.ts",
      outcome: "pass",
      durationMs: 1,
      checks: [],
      observed: {
        paths: ["data/v.txt", "missing.txt"],
        directories: ["fix", "none"],
        recursive: ["fix"],
      },
    };
    const { observed: _observed, ...unobserved } = file;
    const plain: PartFile = { ...unobserved, path: "test/b.test.ts" };
    const hasher = createFsHasher(root, "sha1");
    const [read, untouched] = await withInputs(root, hasher, [file, plain]);
    const blob = execFileSync("git", ["hash-object", "data/v.txt"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(read?.inputs).toEqual({
      "data/v.txt": blob.trim(),
      "missing.txt": null,
      "fix/": listingHash(root, "fix"),
      "none/": ABSENT_LISTING,
      "fix/a/": listingHash(root, "fix/a"),
      "fix/a/b/": listingHash(root, "fix/a/b"),
    });
    expect(untouched?.inputs).toBeUndefined();
    expect(listingHash(root, "fix")).not.toBe(listingHash(root, "fix/a"));
  });
});
