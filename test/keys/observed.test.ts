import { describe, expect, it } from "vitest";
import {
  ancestorListings,
  assembleClosure,
  Listings,
  listedDirectory,
  listingPath,
  ObservedSets,
  observedMetaKey,
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
