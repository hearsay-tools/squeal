import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ancestorListings,
  assembleClosure,
  gitEntryByKind,
  Listings,
  listedDirectory,
  listingPath,
  ObservedSets,
  observedDirectMetaKey,
  observedMetaKey,
  observedStartupMetaKey,
  StartupSets,
} from "../../src/core/keys/index.js";
import type { FileChange } from "../../src/core/types/index.js";
import { fakeCommonDir, open } from "../store/helpers.js";

/* Task 001-132: the shared observed sets and directory listings (spec 001 D3 as amended). */
const ref = (path: string, project = "p") => ({ project, path });
const change = (path: string, oldHash: string | null, newHash: string | null): FileChange =>
  ({ path, oldHash, newHash }) as FileChange;

describe("observed sets", () => {
  it("merge across worktrees, never drop, and read another worktree's additions on refresh", () => {
    const store = open(fakeCommonDir());
    const a = new ObservedSets(store);
    const b = new ObservedSets(store);
    expect(b.of(ref("t.test.ts"))).toEqual([]);

    expect(a.add(ref("t.test.ts"), ["data/x.txt", "data/"])).toEqual(["data/x.txt", "data/"]);
    expect(b.add(ref("t.test.ts"), ["data/y.txt"])).toEqual(["data/y.txt"]);
    expect(a.add(ref("t.test.ts"), ["data/x.txt"])).toEqual([]);
    expect(JSON.parse(store.meta.get(observedMetaKey("p")) ?? "{}")).toEqual({
      "t.test.ts": ["data/", "data/x.txt", "data/y.txt"],
    });

    // Its own write makes the next read take the project again, with b's addition.
    expect(a.of(ref("t.test.ts"))).toEqual(["data/", "data/x.txt", "data/y.txt"]);
    expect(a.refresh(["p"])).toEqual([]);
    b.add(ref("u.test.ts"), ["z.txt"]);
    expect(a.refresh(["p"])).toEqual([ref("u.test.ts")]);
    // A worktree that starts later reads the project when it first asks.
    expect(new ObservedSets(store).of(ref("t.test.ts"))).toEqual([
      "data/",
      "data/x.txt",
      "data/y.txt",
    ]);
    expect(new ObservedSets(store).of(ref("t.test.ts", "other"))).toEqual([]);
  });

  it("read a malformed key as nothing observed", () => {
    const store = open(fakeCommonDir());
    store.transaction(() => store.meta.set(observedMetaKey("p"), "{not json"));
    expect(new ObservedSets(store).of(ref("t.test.ts"))).toEqual([]);
  });

  // Spec 016 D4, row 007-56: the direct marks reach a restarted daemon and another worktree.
  it("keep direct marks in their own key, merged, written by writeMarks, read in a later worktree", () => {
    const store = open(fakeCommonDir());
    const a = new ObservedSets(store);
    expect(a.add(ref("t.py"), ["lib/a.py", "lib/b.py"])).toEqual(["lib/a.py", "lib/b.py"]);
    // A mark joins the view only; a closure path, observed by no run, is marked too.
    expect(a.mark(ref("t.py"), ["lib/b.py", "lib/static.py"])).toEqual([
      "lib/b.py",
      "lib/static.py",
    ]);
    expect(a.directOf(ref("t.py"))).toEqual(["lib/b.py", "lib/static.py"]);
    expect(store.meta.get(observedDirectMetaKey("p"))).toBeNull();
    a.writeMarks();
    expect(a.mark(ref("t.py"), ["lib/b.py"])).toEqual([]);
    expect(JSON.parse(store.meta.get(observedDirectMetaKey("p")) ?? "{}")).toEqual({
      "t.py": ["lib/b.py", "lib/static.py"],
    });
    // The paths key keeps the shape an older daemon parses: test path to paths.
    expect(JSON.parse(store.meta.get(observedMetaKey("p")) ?? "{}")).toEqual({
      "t.py": ["lib/a.py", "lib/b.py"],
    });
    const later = new ObservedSets(store);
    expect(later.directOf(ref("t.py"))).toEqual(["lib/b.py", "lib/static.py"]);
    expect(later.of(ref("t.py"))).toEqual(["lib/a.py", "lib/b.py"]);
    expect(later.directOf(ref("u.py"))).toEqual([]);
    later.mark(ref("u.py"), ["lib/a.py"]);
    later.writeMarks();
    a.refresh(["p"]);
    expect(a.directOf(ref("u.py"))).toEqual(["lib/a.py"]);
  });

  it("write a mark a rolled-back transaction lost at the next writeMarks", () => {
    const store = open(fakeCommonDir());
    const a = new ObservedSets(store);
    a.mark(ref("t.py"), ["lib/b.py"]);
    expect(() =>
      store.transaction(() => {
        a.writeMarks();
        throw new Error("injected: the record's transaction fails");
      }),
    ).toThrow("injected");
    expect(store.meta.get(observedDirectMetaKey("p"))).toBeNull();
    a.writeMarks();
    expect(JSON.parse(store.meta.get(observedDirectMetaKey("p")) ?? "{}")).toEqual({
      "t.py": ["lib/b.py"],
    });
  });
});

describe("start-up sets (spec 016 D4)", () => {
  it("merge across worktrees, never drop, and report the projects another worktree grew", () => {
    const store = open(fakeCommonDir());
    const a = new StartupSets(store);
    const b = new StartupSets(store);
    expect(b.of("p")).toEqual([]);
    expect(a.see("p", ["setup/b.mjs", "setup/a.mjs"])).toEqual(["setup/b.mjs", "setup/a.mjs"]);
    expect(a.see("p", ["setup/a.mjs"])).toEqual([]);
    a.write();
    expect(b.see("p", ["setup/c.mjs"])).toEqual(["setup/c.mjs"]);
    b.write();
    expect(JSON.parse(store.meta.get(observedStartupMetaKey("p")) ?? "[]")).toEqual([
      "setup/a.mjs",
      "setup/b.mjs",
      "setup/c.mjs",
    ]);
    expect(a.refresh(["p"])).toEqual(["p"]);
    expect(a.of("p")).toEqual(["setup/a.mjs", "setup/b.mjs", "setup/c.mjs"]);
    expect(a.refresh(["p"])).toEqual([]);
    expect(new StartupSets(store).of("p")).toEqual(["setup/a.mjs", "setup/b.mjs", "setup/c.mjs"]);
    expect(new StartupSets(store).of("other")).toEqual([]);
  });

  it("read a malformed key as no paths", () => {
    const store = open(fakeCommonDir());
    store.transaction(() => store.meta.set(observedStartupMetaKey("p"), "{"));
    expect(new StartupSets(store).of("p")).toEqual([]);
  });
});

describe("the worktree's .git entry (task 001-262)", () => {
  it("hashes by kind, file, directory or absent, never by its bytes; other paths pass through", () => {
    const roots = ["a", "b", "c", "d"].map(() => mkdtempSync(join(tmpdir(), "squeal-git-entry-")));
    try {
      const [a, b, c] = roots as [string, string, string, string];
      writeFileSync(join(a, ".git"), "gitdir: /repo/.git/worktrees/a\n");
      writeFileSync(join(b, ".git"), "gitdir: /repo/.git/worktrees/b\n");
      mkdirSync(join(c, ".git"));
      // the stat cache's view: each file's bytes, a directory as no file
      const cached = [a, b, c, null].map((root, i) =>
        root === a || root === b ? `bytes-${i}` : null,
      );
      const hashes = roots.map((root, i) =>
        gitEntryByKind(root, (path) => {
          if (path === "x.ts") return "x-hash";
          return path === ".git" ? cached[i] : undefined;
        }),
      );
      const git = hashes.map((hashOf) => hashOf(".git"));
      expect(git[0]).toBe(git[1]);
      expect(git[0]).toEqual(expect.any(String));
      expect(git[2]).toEqual(expect.any(String));
      expect(git[2]).not.toBe(git[0]);
      expect(git[3]).toBeNull();
      expect(hashes[0]?.("x.ts")).toBe("x-hash");
      // untracked until the stat cache holds it
      expect(gitEntryByKind(a, () => undefined)(".git")).toBeUndefined();
      expect(hashes[0]?.(".git/HEAD")).toBeUndefined();
      expect(hashes[0]?.("sub/.git")).toBeUndefined();
    } finally {
      for (const root of roots) rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("listings", () => {
  it("hash a directory's entry names, files and subdirectories holding one, and move on add or delete only", () => {
    let files = ["a/one.ts", "a/sub/deep.ts", "b.ts"];
    const listings = new Listings(() => files);
    const a = listings.hashOf("a");
    const root = listings.hashOf("");
    expect(a).not.toBeNull();
    expect(listings.hashOf("missing")).toBeNull();

    // An edit moves no listing.
    expect(listings.apply([change("a/one.ts", "1", "2")])).toEqual([]);
    expect(listings.hashOf("a")).toBe(a);

    // A file added deep below `a` adds no entry name to `a` when `sub` was there.
    files = [...files, "a/sub/other.ts"];
    expect(listings.apply([change("a/sub/other.ts", null, "1")])).toEqual(["./", "a/", "a/sub/"]);
    expect(listings.hashOf("a")).toBe(a);
    expect(listings.hashOf("")).toBe(root);

    files = [...files, "a/two.ts"];
    listings.apply([change("a/two.ts", null, "1")]);
    expect(listings.hashOf("a")).not.toBe(a);

    files = files.filter((f) => f !== "a/two.ts");
    listings.apply([change("a/two.ts", "1", null)]);
    expect(listings.hashOf("a")).toBe(a);
  });

  it("hash a directory the watcher sees no file in as its entry names on disk (row 016-23)", () => {
    const roots = ["a", "b", "c"].map(() => mkdtempSync(join(tmpdir(), "squeal-listings-")));
    try {
      // Each root's `ignored/list` holds names no tracked file gives: a git-ignored directory.
      const [one, two, same] = roots.map((root, i) => {
        mkdirSync(join(root, "ignored/list/sub"), { recursive: true });
        writeFileSync(join(root, "ignored/list/a.json"), "1\n");
        if (i === 1) writeFileSync(join(root, "ignored/list/b.json"), "2\n");
        return new Listings(() => ["src/x.ts"], root);
      });
      const hash = one?.hashOf("ignored/list");
      expect(hash).not.toBeNull();
      expect(two?.hashOf("ignored/list")).not.toBe(hash);
      // The names, not the bytes, nor the worktree: another root with the same names keys alike.
      writeFileSync(join(roots[2] as string, "ignored/list/a.json"), "changed\n");
      expect(same?.hashOf("ignored/list")).toBe(hash);
      // An empty or absent directory has none, as a tracked listing; a tracked one keys as before.
      expect(one?.hashOf("ignored/list/sub")).toBeNull();
      expect(one?.hashOf("missing")).toBeNull();
      expect(one?.hashOf("src")).toBe(new Listings(() => ["src/x.ts"]).hashOf("src"));
    } finally {
      for (const root of roots) rmSync(root, { recursive: true, force: true });
    }
  });

  it("below a directory are its own and each nested directory's that holds a file (review wave 12d B5)", () => {
    const listings = new Listings(() => [
      "tree/a.txt",
      "tree/sub/b.txt",
      "tree/sub/deep/c.txt",
      "treetop/x.txt",
      "y.txt",
    ]);
    expect(listings.below("tree")).toEqual(["tree/", "tree/sub/", "tree/sub/deep/"]);
    expect(listings.below("tree/sub/deep")).toEqual(["tree/sub/deep/"]);
    expect(listings.below("")).toEqual(["./", "tree/", "tree/sub/", "tree/sub/deep/", "treetop/"]);
    // A directory with no tracked file below it is still its own listing, hashed as none.
    expect(listings.below("missing")).toEqual(["missing/"]);
  });

  it("are closure paths that survive normalization, the root as ./", () => {
    expect(listingPath("")).toBe("./");
    expect(listingPath("data/listed")).toBe("data/listed/");
    expect(listedDirectory("./")).toBe("");
    expect(listedDirectory("data/listed/")).toBe("data/listed");
    expect(listedDirectory("data/x.txt")).toBeNull();
    expect(ancestorListings("a/b/c.ts")).toEqual(["./", "a/", "a/b/"]);
    const closure = assembleClosure(
      { testFile: ref("t.test.ts"), paths: ["./"] },
      [],
      ["data/", "x.txt"],
    );
    expect(closure.paths).toEqual(["./", "data/", "t.test.ts", "x.txt"]);
  });
});
