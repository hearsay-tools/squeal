import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  blobHash,
  createFsHasher,
  type FileStat,
  StatCache,
  sameStat,
  seedStatCache,
} from "../../src/core/hash/index.js";
import type { FileHashRecord } from "../../src/core/types/index.js";
import { FakeFileHashRepo } from "./fakes.js";
import { git, initRepo, tempDir, writeFile } from "./git-repo.js";

const record = (path: string, hash: string, stat: Partial<FileStat> = {}): FileHashRecord => ({
  path,
  hash,
  mtimeMs: 1,
  ctimeMs: 1,
  size: 1,
  inode: 1,
  ...stat,
});

describe("sameStat", () => {
  const base: FileStat = { mtimeMs: 10, ctimeMs: 11, size: 12, inode: 13 };

  it("compares mtime, ctime, size and inode", () => {
    expect(sameStat(base, { ...base })).toBe(true);
    expect(sameStat(base, { ...base, mtimeMs: 99 })).toBe(false);
    expect(sameStat(base, { ...base, ctimeMs: 99 })).toBe(false);
    expect(sameStat(base, { ...base, size: 99 })).toBe(false);
    expect(sameStat(base, { ...base, inode: 99 })).toBe(false);
  });
});

describe("StatCache", () => {
  it("stores, reads and deletes entries by path", () => {
    const cache = new StatCache();
    cache.set(record("a.ts", "h1"));
    expect(cache.get("a.ts")?.hash).toBe("h1");
    expect(cache.hashOf("a.ts")).toBe("h1");
    expect(cache.size).toBe(1);
    cache.delete("a.ts");
    expect(cache.get("a.ts")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("tells a known-absent path (null) from an untracked one (undefined)", () => {
    const cache = new StatCache();
    expect(cache.hashOf("never.ts")).toBeUndefined();

    cache.set(record("a.ts", "h1"));
    cache.delete("a.ts");
    expect(cache.hashOf("a.ts")).toBeNull();

    cache.delete("gone.ts");
    expect(cache.hashOf("gone.ts")).toBeNull();
    expect([...cache.paths()]).toEqual([]);

    cache.set(record("gone.ts", "h2"));
    expect(cache.hashOf("gone.ts")).toBe("h2");
  });

  it("loads from and flushes only its changes to a FileHashRepo", () => {
    const repo = new FakeFileHashRepo();
    repo.upsertMany("w", [record("a.ts", "h1"), record("b.ts", "h2"), record("c.ts", "h3")]);
    repo.upserts = 0;

    const cache = StatCache.load(repo, "w");
    expect(cache.hashOf("b.ts")).toBe("h2");

    cache.set(record("a.ts", "h1b"));
    cache.delete("b.ts");
    cache.set(record("d.ts", "h4"));
    cache.flush(repo, "w");

    expect(repo.upserts).toBe(2);
    expect(repo.removes).toBe(1);
    expect(repo.list("w").map((r) => [r.path, r.hash])).toEqual([
      ["a.ts", "h1b"],
      ["c.ts", "h3"],
      ["d.ts", "h4"],
    ]);

    cache.flush(repo, "w");
    expect(repo.upserts).toBe(2);
  });

  it("flushes a delete followed by a re-add as an upsert", () => {
    const repo = new FakeFileHashRepo();
    const cache = new StatCache();
    cache.set(record("a.ts", "h1"));
    cache.flush(repo, "w");
    cache.delete("a.ts");
    cache.set(record("a.ts", "h2"));
    cache.flush(repo, "w");
    expect(repo.get("w", "a.ts")?.hash).toBe("h2");
    expect(repo.removes).toBe(0);
  });
});

describe("seedStatCache", () => {
  let dir: ReturnType<typeof tempDir>;
  let root: string;

  beforeEach(() => {
    dir = tempDir();
    root = join(dir.path, "repo");
  });
  afterEach(() => dir.cleanup());

  it("takes clean files from the index and hashes the rest from bytes", async () => {
    initRepo(root, { "clean.ts": "c\n", "dirty.ts": "d\n" });
    writeFile(root, "dirty.ts", "d2\n");
    writeFile(root, "new.ts", "n\n");
    const cache = new StatCache();

    const report = await seedStatCache(cache, root, ["clean.ts", "dirty.ts", "new.ts", "gone.ts"], {
      objectFormat: "sha1",
    });

    expect(report).toEqual({ fromIndex: 1, fromBytes: 2, missing: 1 });
    for (const path of ["clean.ts", "dirty.ts", "new.ts"]) {
      expect(cache.hashOf(path)).toBe(blobHash(readFileSync(join(root, path)), "sha1"));
    }
    expect(cache.get("gone.ts")).toBeUndefined();
    expect(cache.hashOf("gone.ts")).toBeNull();
  });

  it("stats symlinks without following them and hashes them as git does", async () => {
    initRepo(root, { "target.ts": "t\n" });
    symlinkSync("target.ts", join(root, "link.ts"));
    symlinkSync("nowhere.ts", join(root, "dangling.ts"));
    git(root, ["add", "-A"]);
    git(root, ["commit", "-qm", "links"]);
    const oid = (path: string) => git(root, ["ls-files", "-s", path]).split(" ")[1];
    const hasher = createFsHasher(root, "sha1");

    expect(await hasher.hash("link.ts")).toBe(oid("link.ts"));
    expect(await hasher.hash("dangling.ts")).toBe(oid("dangling.ts"));
    expect((await hasher.stat("link.ts"))?.size).toBe("target.ts".length);
    expect((await hasher.stat("dangling.ts"))?.inode).toBe(
      lstatSync(join(root, "dangling.ts")).ino,
    );

    // Clean symlinks come from the index; their lstat matches what git compared.
    const cache = new StatCache();
    const report = await seedStatCache(cache, root, ["link.ts", "dangling.ts"], {
      objectFormat: "sha1",
    });
    expect(report).toEqual({ fromIndex: 2, fromBytes: 0, missing: 0 });
    expect(cache.hashOf("link.ts")).toBe(oid("link.ts"));
  });

  it("treats a directory, or a fifo, as no file", async () => {
    initRepo(root, {});
    mkdirSync(join(root, "dir"));
    execFileSync("mkfifo", [join(root, "pipe")]);
    const hasher = createFsHasher(root, "sha1");
    expect(await hasher.stat("dir")).toBeNull();
    expect(await hasher.hash("dir")).toBeNull();
    expect(await hasher.stat("pipe")).toBeNull();
    expect(await hasher.hash("pipe")).toBeNull();
  });

  it("falls back to hashing bytes when an eol attribute makes the index oid differ from disk", async () => {
    // The committed blob is normalized to LF; the checkout has CRLF. git status calls it clean.
    initRepo(root, { ".gitattributes": "*.bat eol=crlf\n", "run.bat": "echo\r\n" });
    expect(git(root, ["status", "--porcelain"])).toBe("");
    const indexOid = git(root, ["ls-files", "-s", "run.bat"]).split(" ")[1];
    const bytes = readFileSync(join(root, "run.bat"));
    expect(indexOid).not.toBe(blobHash(bytes, "sha1"));
    const cache = new StatCache();

    const report = await seedStatCache(cache, root, ["run.bat"], { objectFormat: "sha1" });

    expect(report.fromBytes).toBe(1);
    expect(cache.hashOf("run.bat")).toBe(blobHash(bytes, "sha1"));
  });

  it("records the stat of every seeded file", async () => {
    initRepo(root, { "a.ts": "a\n" });
    const cache = new StatCache();
    await seedStatCache(cache, root, ["a.ts"], { objectFormat: "sha1" });
    const stat = await createFsHasher(root, "sha1").stat("a.ts");
    expect(stat).not.toBeNull();
    expect(sameStat(cache.get("a.ts") as FileHashRecord, stat as FileStat)).toBe(true);
  });
});
