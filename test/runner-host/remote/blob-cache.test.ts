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
  coreEnvironmentInputs,
  installedDependenciesFingerprint,
} from "../../../src/core/keys/environment.js";
import {
  createBlobCache,
  createInstalledFingerprintCache,
  touchesInstalled,
} from "../../../src/core/runner-host/remote/blob-cache.js";
import type { RemoteHost } from "../../../src/core/runner-host/remote/connect.js";
import { compareRemoteEnvironment } from "../../../src/core/runner-host/remote/lane-compare.js";
import { treeBlob } from "../../../src/core/runner-host/remote/tree-wire.js";
import type { AbsolutePath } from "../../../src/core/types/common.js";
import type { RunnerAdapter } from "../../../src/core/types/runner.js";

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
    expect(touchesInstalled(".yarn/patches/a.patch")).toBe(true);
    expect(touchesInstalled(".rush/temp/shrinkwrap-deps.json")).toBe(true);
    nowMs += 1_000;
    cache.onInvalidate(["pnpm-lock.yaml"]);
    expect(await cache.fingerprint()).toBe(fp2);
  });

  // Review 0.1.630 B3 (A): Yarn PnP patches must invalidate both via stat and onInvalidate,
  // and compareRemoteEnvironment must reject stale installs.
  it("detects .yarn/patches edits in compareRemoteEnvironment with and without onInvalidate", async () => {
    const root = makeRoot({
      ".pnp.cjs": "module.exports = {};\n",
      ".yarn/patches/a.patch": "--- a\n+++ b\n-old\n+new\n",
    });
    const oldTime = new Date(Date.now() - RACY_WINDOW_MS - 60_000);
    utimesSync(join(root, ".pnp.cjs"), oldTime, oldTime);
    utimesSync(join(root, ".yarn/patches/a.patch"), oldTime, oldTime);

    const cache = createInstalledFingerprintCache(root);
    const initial = await cache.fingerprint();
    expect(initial).toBe(await installedDependenciesFingerprint(root, root));

    const runner = {
      name: "vitest",
      environment: async () => [
        {
          project: "default",
          runnerName: "vitest",
          runnerVersion: "5.0.3",
          adapterVersion: "1",
          resolvedConfig: JSON.stringify({ root }),
          files: [],
        },
      ],
    } as unknown as RunnerAdapter;
    const remoteCore = coreEnvironmentInputs({
      squealVersion: "0.1.630",
      installedDependencies: initial,
      allowlist: [],
    });
    const host = {
      coreEnvironment: async () => remoteCore,
      adapter: { environment: runner.environment },
      blobs: async () => ({}),
      install: async () => ({ ran: false, command: "none" }),
    } as unknown as RemoteHost;

    // Equal before patch edit.
    const eq = await compareRemoteEnvironment(host, {
      target: "test",
      root,
      version: "0.1.630",
      local: runner,
      allowlist: () => [],
      log: () => {},
      installedCache: cache,
    });
    expect(eq.differences).toEqual([]);

    // Edit patch WITHOUT calling onInvalidate: stat signature catches it immediately.
    writeFileSync(join(root, ".yarn/patches/a.patch"), "--- a\n+++ b\n-old\n+changed\n");
    const direct = await installedDependenciesFingerprint(root, root);
    expect(direct).not.toBe(initial);
    const diffNoInvalidate = await compareRemoteEnvironment(host, {
      target: "test",
      root,
      version: "0.1.630",
      local: runner,
      allowlist: () => [],
      log: () => {},
      installedCache: cache,
    });
    expect(diffNoInvalidate.differences).toEqual(["installed dependencies differ"]);

    // Also confirm explicit onInvalidate clears cached state.
    cache.onInvalidate([".yarn/patches/a.patch"]);
    expect(await cache.fingerprint()).toBe(direct);
  });

  // Review 0.1.630 B3 (B): removing a nested scoped package under npm hidden lockfile invalidates.
  it("detects removal of a nested scoped package under npm hidden lockfile", async () => {
    const root = makeRoot({
      "package.json": '{"name":"app"}\n',
      "node_modules/@scope/a/package.json": '{"name":"@scope/a","version":"1.0.0"}\n',
      "node_modules/.package-lock.json": JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "node_modules/@scope/a": { version: "1.0.0" },
        },
      }),
    });
    const oldPkg = new Date(Date.now() - RACY_WINDOW_MS - 120_000);
    const oldLock = new Date(Date.now() - RACY_WINDOW_MS - 60_000);
    utimesSync(join(root, "node_modules/@scope/a"), oldPkg, oldPkg);
    utimesSync(join(root, "node_modules/@scope"), oldPkg, oldPkg);
    utimesSync(join(root, "node_modules"), oldPkg, oldPkg);
    utimesSync(join(root, "node_modules/.package-lock.json"), oldLock, oldLock);

    const cache = createInstalledFingerprintCache(root);
    const fp1 = await cache.fingerprint();
    expect(fp1).toBe(await installedDependenciesFingerprint(root, root));

    // Remove nested scoped package without touching top-level node_modules or .package-lock.json.
    rmSync(join(root, "node_modules/@scope/a"), { recursive: true, force: true });
    const direct = await installedDependenciesFingerprint(root, root);
    expect(direct).not.toBe(fp1);
    expect(await cache.fingerprint()).toBe(direct);
  });
});
