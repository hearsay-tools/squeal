import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fetchExport } from "../../src/core/shared/fetch.js";
import { publish, readerOf, scratch, shared } from "./reader-kit.js";
import { cloneOf, cloneWith, git, untouched } from "./remote.js";

/*
 * Spec 018 D14 (row 018-20): the reader against a scratch bare repository as
 * `origin`. It takes the export of the nearest first-parent ancestor of
 * merge-base(HEAD, origin/main) that has a ref, refuses one off main's
 * first-parent line or whose header names another commit, notes a failed
 * or slow fetch, and writes nothing to the clone's config, refs or
 * `FETCH_HEAD`.
 */

describe("the shared results reader (018 D14)", () => {
  it("imports the nearest main commit's export and writes nothing to config, refs or FETCH_HEAD", async () => {
    const s = scratch();
    const ci = cloneWith(s, "ci", 3);
    const [c0, c1, c2] = ci.commits as [string, string, string];
    await publish(ci.root, c0);
    await publish(ci.root, c1);
    const dev = cloneOf(s, "dev");
    // A local commit: HEAD is past main, merge-base(HEAD, origin/main) is c2, which has no export.
    writeFileSync(join(dev, "local.txt"), "x\n");
    git(dev, ["add", "-A"]);
    git(dev, ["commit", "-qm", "local"]);
    const before = untouched(dev);
    const { run, notes, commits, imported, store } = readerOf(dev);
    await run();
    expect(commits()).toEqual([c1]);
    expect(imported()).toBe(1);
    expect(notes).toEqual([]);
    expect(untouched(dev)).toBe(before);
    expect(git(dev, ["for-each-ref", "refs/squeal"])).toBe("");

    // HEAD moves, the start point does not: nothing listed, fetched or noted, even offline.
    git(dev, ["remote", "set-url", "origin", join(s.dir, "absent.git")]);
    git(dev, ["commit", "-qm", "again", "--allow-empty"]);
    await run();
    expect(notes).toEqual([]);
    git(dev, ["remote", "set-url", "origin", s.remote]);
    // A restart at c2 lists again: CI publishes c2's export after main moved.
    await readerOf(dev, { store }).run();
    expect(commits()).toEqual([c1]);
    await publish(ci.root, c2);
    await readerOf(dev, { store }).run();
    expect(commits().sort()).toEqual([c1, c2].sort());
    // The store holds the start point's own export: a restart reaches no remote.
    git(dev, ["remote", "set-url", "origin", join(s.dir, "absent.git")]);
    const restarted = readerOf(dev, { store });
    await restarted.run();
    expect(restarted.notes).toEqual([]);
    expect(notes).toEqual([]);
  });

  it("takes the newer export when HEAD moves to a newer main commit: one export per start point", async () => {
    const s = scratch();
    const ci = cloneWith(s, "ci", 1);
    const [c0] = ci.commits as [string];
    await publish(ci.root, c0);
    const dev = cloneOf(s, "dev");
    const { run, commits, notes } = readerOf(dev);
    await run();
    expect(commits()).toEqual([c0]);

    writeFileSync(join(ci.root, "n.txt"), "next\n");
    git(ci.root, ["commit", "-qam", "next"]);
    git(ci.root, ["push", "-q", "origin", "main"]);
    const c1 = git(ci.root, ["rev-parse", "HEAD"]);
    await publish(ci.root, c1);
    git(dev, ["pull", "-q", "--ff-only"]);
    const before = untouched(dev);
    await run();
    expect(commits().sort()).toEqual([c0, c1].sort());
    expect(notes).toEqual([]);
    expect(untouched(dev)).toBe(before);
  });

  it("refuses a ref whose commit is off main's first-parent line, and takes the next on it", async () => {
    const s = scratch();
    const ci = cloneWith(s, "ci", 1);
    const [c0] = ci.commits as [string];
    // A side branch from c0, merged into main: its commit s1 is reachable, not on the line.
    git(ci.root, ["checkout", "-qb", "side"]);
    writeFileSync(join(ci.root, "side.txt"), "side\n");
    git(ci.root, ["add", "-A"]);
    git(ci.root, ["commit", "-qm", "s1"]);
    const s1 = git(ci.root, ["rev-parse", "HEAD"]);
    git(ci.root, ["checkout", "-q", "main"]);
    git(ci.root, ["commit", "-q", "--allow-empty", "-m", "c1"]);
    git(ci.root, ["merge", "-q", "--no-ff", "-m", "merge side", "side"]);
    git(ci.root, ["push", "-q", "origin", "main"]);
    await publish(ci.root, c0);
    await publish(ci.root, s1);
    const dev = cloneOf(s, "dev");
    // A branch on the side branch: merge-base(HEAD, origin/main) is s1.
    git(dev, ["checkout", "-qb", "feature", s1]);
    git(dev, ["commit", "-q", "--allow-empty", "-m", "f1"]);
    const before = untouched(dev);
    const { run, commits, notes } = readerOf(dev);
    await run();
    expect(commits()).toEqual([c0]);
    expect(notes).toEqual([
      `CI results: refused refs/squeal/${s1}: its commit is not on refs/remotes/origin/main's first-parent line`,
    ]);
    expect(untouched(dev)).toBe(before);
  });

  it("refuses an export whose header names another commit than its ref", async () => {
    const s = scratch();
    const ci = cloneWith(s, "ci", 2);
    const [c0, c1] = ci.commits as [string, string];
    const result = await publish(ci.root, c0);
    git(s.remote, ["update-ref", `refs/squeal/${c1}`, result]);
    const dev = cloneOf(s, "dev");
    const { run, commits, notes } = readerOf(dev);
    await run();
    expect(commits()).toEqual([]);
    expect(notes).toEqual([`CI results: refused refs/squeal/${c1}: its header names commit ${c0}`]);
  });

  it("offline: one note, no import, nothing written", async () => {
    const s = scratch();
    const ci = cloneWith(s, "ci", 1);
    await publish(ci.root, ci.commits[0] as string);
    const dev = cloneOf(s, "dev");
    git(dev, ["remote", "set-url", "origin", join(s.dir, "absent.git")]);
    const before = untouched(dev);
    const { run, commits, notes } = readerOf(dev);
    await run();
    await run();
    expect(commits()).toEqual([]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(
      /^CI results: could not list refs\/squeal on origin \(.+\); tests run here as before$/,
    );
    expect(untouched(dev)).toBe(before);
  });

  it("stops a remote that does not answer at its kill timer, with one note", async () => {
    const s = scratch();
    const ci = cloneWith(s, "ci", 1);
    await publish(ci.root, ci.commits[0] as string);
    const dev = cloneOf(s, "dev");
    git(dev, ["config", "protocol.ext.allow", "always"]);
    git(dev, ["remote", "set-url", "origin", "ext::sleep 2"]);
    const { run, commits, notes } = readerOf(dev, { listTimeoutMs: 300 });
    const started = Date.now();
    await run();
    expect(Date.now() - started).toBeLessThan(1_800);
    expect(commits()).toEqual([]);
    expect(notes).toEqual([
      "CI results: could not list refs/squeal on origin (stopped after 300 ms); tests run here as before",
    ]);
    const slow = await fetchExport(dev, "origin", "refs/squeal/x", "0".repeat(40), {
      timeoutMs: 300,
      env: { GIT_TERMINAL_PROMPT: "0" },
    });
    expect(slow).toEqual({ failed: "stopped after 300 ms", timedOut: true });
  });

  it("fetches nothing without shared.ref", async () => {
    const s = scratch();
    const ci = cloneWith(s, "ci", 1);
    await publish(ci.root, ci.commits[0] as string);
    const dev = cloneOf(s, "dev");
    const { run, commits, notes } = readerOf(dev, { policy: shared(null) });
    await run();
    expect(commits()).toEqual([]);
    expect(notes).toEqual([]);
  });
});
