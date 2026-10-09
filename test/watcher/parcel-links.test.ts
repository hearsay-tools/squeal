import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WatchHint, WatchSpec, WatchSubscription } from "../../src/core/types/index.js";
import { createParcelBackend, loadOwnParcel } from "../../src/core/watcher/parcel-backend.js";
import { delay, makeRepo, waitFor } from "./helpers.js";

/*
 * 001-167: an extra file whose parent is a link (`dist -> real-build`) is
 * watched at the link's target and reported under its declared path. Runs on
 * Linux too: the subscription it exercises is a plain directory watch, which
 * parcel handles on both platforms, unlike the renamed directories that keep
 * its contract suite darwin-only.
 */
describe("parcel backend, an extra file behind a linked directory", () => {
  let root: string;
  let cleanup: () => void;
  let hints: WatchHint[];
  let errors: Error[];
  let sub: WatchSubscription | null;

  beforeEach(() => {
    ({ root, cleanup } = makeRepo());
    hints = [];
    errors = [];
    sub = null;
    mkdirSync(join(root, "real-build"));
    writeFileSync(join(root, "real-build/index.js"), "export const build = 'a';\n");
    writeFileSync(join(root, "real-build/other.js"), "export const other = 'a';\n");
    symlinkSync("real-build", join(root, "dist"));
  });
  afterEach(async () => {
    await sub?.close();
    cleanup();
  });

  const spec = (extraFiles: string[]): WatchSpec => ({
    root,
    excluded: [".git", "build", "dist", "real-build"].map((p) => join(root, p)),
    extraFiles: extraFiles.map((p) => join(root, p)),
  });
  const start = async (watchSpec: WatchSpec) => {
    sub = await createParcelBackend(() => loadOwnParcel()).watch(watchSpec, {
      onHints: (batch) => hints.push(...batch),
      onDropped: (reason) => errors.push(new Error(reason)),
      onError: (error) => errors.push(error),
    });
  };

  it("reports a rebuild through the link under the declared path, with no watch error", async () => {
    await start(spec(["dist/index.js"]));
    writeFileSync(join(root, "real-build/other.js"), "export const other = 'b';\n");
    writeFileSync(join(root, "real-build/index.js"), "export const build = 'b';\n");
    await waitFor(() => hints.some((h) => h.path === join(root, "dist/index.js")));
    await delay(200);
    expect(errors).toEqual([]);
    expect([...new Set(hints.map((h) => h.path))]).toEqual([join(root, "dist/index.js")]);
  });

  it("reports one change under every declared path that names the same file", async () => {
    symlinkSync("real-build", join(root, "build"));
    await start(spec(["dist/index.js", "build/index.js"]));
    writeFileSync(join(root, "real-build/index.js"), "export const build = 'c';\n");
    const seen = (rel: string) => hints.some((h) => h.path === join(root, rel));
    await waitFor(() => seen("dist/index.js") && seen("build/index.js"));
    expect(errors).toEqual([]);
  });

  it("keeps watching through the link after an updated spec", async () => {
    await start(spec([]));
    await sub?.update(spec(["dist/index.js"]));
    writeFileSync(join(root, "real-build/index.js"), "export const build = 'd';\n");
    await waitFor(() => hints.some((h) => h.path === join(root, "dist/index.js")));
    expect(errors).toEqual([]);
  });
});
