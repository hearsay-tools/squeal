import { describe, expect, it } from "vitest";
import { squealVersion } from "../../src/core/daemon/version.js";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";
import { readSquealMismatch } from "../../src/core/shared/refused.js";
import { decodeBundle } from "../../src/core/store/transfer-bundle.js";
import { publish, readerOf, scratch } from "./reader-kit.js";
import { cloneOf, cloneWith, exportOf, git } from "./remote.js";

/*
 * Spec 018 D21 (row 018-34): an export the reader refuses for its key format
 * leaves one record of both Squeal builds for status, in place of a note per
 * refused ref; a later import clears it.
 */

const NOW = 1_762_100_000_000;

/** `commit`'s export as CI's Squeal `version` with key format `keyFormat` writes it. */
function exportAs(commit: string, version: string, keyFormat: number): Buffer {
  const bundle = decodeBundle(exportOf(commit));
  if (typeof bundle === "string") throw new Error(bundle);
  return exportOf(commit, { header: { ...bundle.header, squealVersion: version, keyFormat } });
}

describe("the reader and an export of another key format (018 D21)", () => {
  it("records CI's and this Squeal's builds, imports nothing and writes no note", async () => {
    const s = scratch();
    const ci = cloneWith(s, "ci", 2);
    const [, c1] = ci.commits as [string, string];
    await publish(ci.root, c1, exportAs(c1, "0.1.431", KEY_FORMAT_VERSION - 1));
    const dev = cloneOf(s, "dev");
    const { run, commits, notes, store } = readerOf(dev);
    await run();
    expect(commits()).toEqual([]);
    expect(notes).toEqual([]);
    expect(readSquealMismatch(store, worktreeIdFor(dev))).toEqual({
      ci: { version: "0.1.431", keyFormat: KEY_FORMAT_VERSION - 1 },
      here: { version: squealVersion(), keyFormat: KEY_FORMAT_VERSION },
      commit: c1,
      at: NOW,
    });
  });

  it("keeps one record across start points, the latest, and clears it at the next import", async () => {
    const s = scratch();
    const ci = cloneWith(s, "ci", 1);
    const [c0] = ci.commits as [string];
    await publish(ci.root, c0, exportAs(c0, "0.1.450", KEY_FORMAT_VERSION + 1));
    const dev = cloneOf(s, "dev");
    const { run, commits, notes, store } = readerOf(dev);
    await run();

    const next = (message: string) => {
      git(ci.root, ["commit", "-q", "--allow-empty", "-m", message]);
      git(ci.root, ["push", "-q", "origin", "main"]);
      git(dev, ["pull", "-q", "--ff-only"]);
      return git(ci.root, ["rev-parse", "HEAD"]);
    };
    const c1 = next("c1");
    await publish(ci.root, c1, exportAs(c1, "0.1.451", KEY_FORMAT_VERSION + 1));
    await run();
    expect(notes).toEqual([]);
    expect(readSquealMismatch(store, worktreeIdFor(dev))).toMatchObject({
      ci: { version: "0.1.451" },
      commit: c1,
    });

    const c2 = next("c2");
    await publish(ci.root, c2);
    await run();
    expect(commits()).toEqual([c2]);
    expect(readSquealMismatch(store, worktreeIdFor(dev))).toBeNull();
  });
});
