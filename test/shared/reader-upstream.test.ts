import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { publish, readerOf, scratch } from "./reader-kit.js";
import { cloneOf, cloneWith, git, type Scratch, untouched } from "./remote.js";

/*
 * Row 018-28 (`research/shared-proof.md` Q3): a clone whose remote was
 * removed and added again has no `refs/remotes/origin/HEAD`, and a fetch
 * never makes it, so the reader stopped with "no remote names its default
 * branch". It now takes the default branch the remote advertises, under the
 * listing's kill timer and the reader's stop, and writes nothing. The note
 * stays, naming `git remote set-head origin --auto`, when that fails too.
 *
 * R2 (CI of 0.1.431): an `origin/HEAD` that names a branch the clone does not
 * hold, as a default branch renamed on the remote leaves it after
 * `git fetch --prune`, named no default branch either; the pass then ended
 * with no note and no import. It now counts as no `origin/HEAD`.
 */

const NO_DEFAULT =
  "CI results: shared.ref is set, but no remote names its default branch; run `git remote set-head origin --auto`";

/** Whether `refs/remotes/origin/HEAD` exists in `root`. */
function hasOriginHead(root: string): boolean {
  try {
    execFileSync("git", ["symbolic-ref", "-q", "refs/remotes/origin/HEAD"], { cwd: root });
    return true;
  } catch {
    return false;
  }
}

/** A clone at main's one commit, its export published, with `origin` removed and added again. */
async function readdedClone(s: Scratch): Promise<{ dev: string; c0: string }> {
  const ci = cloneWith(s, "ci", 1);
  const [c0] = ci.commits as [string];
  await publish(ci.root, c0);
  const dev = cloneOf(s, "dev");
  git(dev, ["remote", "remove", "origin"]);
  git(dev, ["remote", "add", "origin", s.remote]);
  git(dev, ["fetch", "-q", "origin"]);
  // A git whose fetch follows the remote's HEAD (2.48 and later) makes it: removed, as in an older one.
  if (hasOriginHead(dev)) git(dev, ["remote", "set-head", "origin", "-d"]);
  return { dev, c0 };
}

describe("the shared results reader without origin/HEAD (row 018-28)", () => {
  it("takes the default branch the remote advertises, and writes nothing", async () => {
    const s = scratch();
    const { dev, c0 } = await readdedClone(s);
    expect(hasOriginHead(dev)).toBe(false);
    const before = untouched(dev);
    const { run, commits, notes } = readerOf(dev);
    await run();
    expect(commits()).toEqual([c0]);
    expect(notes).toEqual([]);
    expect(untouched(dev)).toBe(before);
    expect(hasOriginHead(dev)).toBe(false);
  });

  it("notes once when the remote cannot be reached, and asks again only once HEAD moved", async () => {
    const s = scratch();
    const { dev, c0 } = await readdedClone(s);
    git(dev, ["remote", "set-url", "origin", join(s.dir, "absent.git")]);
    const before = untouched(dev);
    const { run, commits, notes } = readerOf(dev);
    await run();
    await run();
    expect(commits()).toEqual([]);
    expect(notes).toEqual([NO_DEFAULT]);
    expect(untouched(dev)).toBe(before);

    // Back online, HEAD where it was: the miss stands, nothing is asked.
    git(dev, ["remote", "set-url", "origin", s.remote]);
    await run();
    expect(commits()).toEqual([]);
    // A local commit moves HEAD: the reader asks again and takes main's export.
    writeFileSync(join(dev, "local.txt"), "x\n");
    git(dev, ["add", "-A"]);
    git(dev, ["commit", "-qm", "local"]);
    await run();
    expect(commits()).toEqual([c0]);
    expect(notes).toEqual([NO_DEFAULT]);
  });

  it("stops a remote that does not answer at the listing's kill timer, with the note", async () => {
    const s = scratch();
    const { dev } = await readdedClone(s);
    git(dev, ["config", "protocol.ext.allow", "always"]);
    git(dev, ["remote", "set-url", "origin", "ext::sleep 2"]);
    const { run, commits, notes } = readerOf(dev, { listTimeoutMs: 300 });
    const started = Date.now();
    await run();
    expect(Date.now() - started).toBeLessThan(1_800);
    expect(commits()).toEqual([]);
    expect(notes).toEqual([NO_DEFAULT]);
  });

  it("takes the advertised branch when origin/HEAD names a branch the clone lacks", async () => {
    const s = scratch();
    const ci = cloneWith(s, "ci", 1);
    const [c0] = ci.commits as [string];
    await publish(ci.root, c0);
    const dev = cloneOf(s, "dev");
    // The remote's `master` renamed to `main`, and `origin/master` pruned: origin/HEAD dangles.
    git(dev, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/master"]);
    const before = untouched(dev);
    const { run, commits, notes } = readerOf(dev);
    await run();
    expect(commits()).toEqual([c0]);
    expect(notes).toEqual([]);
    expect(untouched(dev)).toBe(before);
  });

  it.each([
    ["no origin/HEAD", false],
    ["an origin/HEAD that dangles", true],
  ])(
    "notes when the advertised branch has no remote-tracking ref here, with %s",
    async (_, dangling) => {
      const s = scratch();
      const { dev } = await readdedClone(s);
      if (dangling)
        git(dev, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
      git(dev, ["update-ref", "--no-deref", "-d", "refs/remotes/origin/main"]);
      const { run, commits, notes } = readerOf(dev);
      await run();
      expect(commits()).toEqual([]);
      expect(notes).toEqual([NO_DEFAULT]);
    },
  );
});
