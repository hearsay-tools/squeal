import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { RACY_WINDOW_MS } from "../../../src/core/hash/stat-cache.js";
import {
  createBlobCache,
  createInstalledFingerprintCache,
  touchesInstalled,
} from "../../../src/core/runner-host/remote/blob-cache.js";
import { treeBlob } from "../../../src/core/runner-host/remote/tree-wire.js";
import type { AbsolutePath } from "../../../src/core/types/common.js";

const scratch = mkdtempSync(join(tmpdir(), "squeal-remote-blob-cache-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let seq = 0;
function makeRoot(files: Readonly<Record<string, string>>): AbsolutePath {
  const dir = join(scratch, `r${++seq}`) as AbsolutePath;
  mkdirSync(dir, { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}

describe("createBlobCache", () => {
  it("returns exact SHA-1 blobs, detects edits, deletions and symlinks, and respects the racy window", async () => {
    const root = makeRoot({ "a.ts": "const a = 1;\n", "b.ts": "const b = 2;\n" });
    const oldTime = new Date(Date.now() - RACY_WINDOW_MS - 10_000);
    utimesSync(join(root, "a.ts"), oldTime, oldTime);
    utimesSync(join(root, "b.ts"), oldTime, oldTime);
    symlinkSync("a.ts", join(root, "link.ts"));

    let nowMs = Date.now();
    const cache = createBlobCache(root, () => nowMs);
    const first = await cache.blobs(["a.ts", "b.ts", "link.ts", "missing.ts", "../escape.ts"]);
    expect(first).toEqual({
      "a.ts": treeBlob(Buffer.from("const a = 1;\n")),
      "b.ts": treeBlob(Buffer.from("const b = 2;\n")),
      "link.ts": treeBlob(Buffer.from("a.ts")),
      "missing.ts": null,
      "../escape.ts": null,
    });

    // Editing a file updates its blob immediately on the next lookup.
    writeFileSync(join(root, "a.ts"), "const a = 2;\n");
    const edited = await cache.blobs(["a.ts", "b.ts"]);
    expect(edited["a.ts"]).toBe(treeBlob(Buffer.from("const a = 2;\n")));
    expect(edited["b.ts"]).toBe(treeBlob(Buffer.from("const b = 2;\n")));

    // A same-size rewrite inside the racy window (same mtime) is re-hashed rather than trusted.
    const sameMtime = new Date(nowMs);
    writeFileSync(join(root, "a.ts"), "const a = 3;\n");
    utimesSync(join(root, "a.ts"), sameMtime, sameMtime);
    await cache.blobs(["a.ts"]);
    writeFileSync(join(root, "a.ts"), "const a = 4;\n");
    utimesSync(join(root, "a.ts"), sameMtime, sameMtime);
    const afterRacy = await cache.blobs(["a.ts"]);
    expect(afterRacy["a.ts"]).toBe(treeBlob(Buffer.from("const a = 4;\n")));

    // Retargeting a symlink is never served from cache.
    unlinkSync(join(root, "link.ts"));
    symlinkSync("b.ts", join(root, "link.ts"));
    expect((await cache.blobs(["link.ts"]))["link.ts"]).toBe(treeBlob(Buffer.from("b.ts")));

    // Deleting a file returns null.
    unlinkSync(join(root, "b.ts"));
    expect((await cache.blobs(["b.ts"]))["b.ts"]).toBeNull();

    // Evicting drops cached state cleanly.
    nowMs += 60_000;
    cache.evict(["a.ts"]);
    expect((await cache.blobs(["a.ts"]))["a.ts"]).toBe(treeBlob(Buffer.from("const a = 4;\n")));
  });
});

describe("createInstalledFingerprintCache", () => {
  it("reuses clean local fingerprints and invalidates when lockfiles change", async () => {
    const root = makeRoot({
      "package.json": '{"name":"app"}\n',
      "node_modules/.package-lock.json": '{"lockfileVersion":3,"packages":{}}\n',
    });
    const oldTime = new Date(Date.now() - RACY_WINDOW_MS - 10_000);
    utimesSync(join(root, "node_modules"), oldTime, oldTime);
    utimesSync(join(root, "node_modules/.package-lock.json"), oldTime, oldTime);

    let nowMs = Date.now();
    const cache = createInstalledFingerprintCache(root, () => nowMs);
    const fp1 = await cache.fingerprint();
    expect(fp1).not.toBe("none");
    expect(await cache.fingerprint()).toBe(fp1);

    // Updating the hidden lockfile changes the stat signature and recomputes the fingerprint.
    writeFileSync(
      join(root, "node_modules/.package-lock.json"),
      '{"lockfileVersion":3,"packages":{"node_modules/a":{"version":"1.0.0"}}}\n',
    );
    const fp2 = await cache.fingerprint();
    expect(fp2).not.toBe(fp1);

    // Invalidation hook clears on lockfile/node_modules/patches paths only.
    expect(touchesInstalled("src/index.ts")).toBe(false);
    expect(touchesInstalled("pnpm-lock.yaml")).toBe(true);
    expect(touchesInstalled("node_modules/.pnpm/lock.yaml")).toBe(true);
    expect(touchesInstalled("patches/a.patch")).toBe(true);
    nowMs += 1_000;
    cache.onInvalidate(["pnpm-lock.yaml"]);
    expect(await cache.fingerprint()).toBe(fp2);
  });
});
