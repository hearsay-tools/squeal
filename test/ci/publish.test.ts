import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { publishExport } from "../../src/core/ci/publish.js";
import { EXPORT_NAME } from "../../src/core/shared/refs.js";
import {
  cloneWith,
  exportOf,
  git,
  remoteRefs,
  type Scratch,
  scratchRemote,
} from "../shared/remote.js";

/*
 * Spec 018 D13 (row 018-20): `squeal ci publish` against a scratch bare
 * repository as the remote. One parentless commit per main commit whose
 * tree holds the export, pushed as `refs/squeal/<sha>`; refs beyond the
 * newest `keep` main commits deleted in the same push.
 */

const scratches: Scratch[] = [];
afterEach(() => {
  for (const s of scratches.splice(0)) s.cleanup();
});

function setup(commits: number) {
  const scratch = scratchRemote();
  scratches.push(scratch);
  return { scratch, ...cloneWith(scratch, "ci", commits) };
}

const options = { remote: "origin", prefix: "refs/squeal", keep: 100 };

describe("squeal ci publish (018 D13)", () => {
  it("writes refs/squeal/<sha> as a parentless commit whose tree holds the export", async () => {
    const { scratch, root, commits } = setup(1);
    const sha = commits[0] as string;
    const bytes = exportOf(sha);
    const published = await publishExport({ root, bytes, ...options });
    if ("refused" in published) throw new Error(published.refused);
    expect(remoteRefs(scratch)).toEqual([`refs/squeal/${sha}`]);
    const target = git(scratch.remote, ["rev-parse", `refs/squeal/${sha}`]);
    expect(target).toBe(published.result);
    expect(git(scratch.remote, ["rev-list", "--parents", "-n", "1", target])).toBe(target);
    expect(git(scratch.remote, ["ls-tree", "--name-only", target])).toBe(EXPORT_NAME);
    const blob = execFileSync("git", ["cat-file", "blob", `${target}:${EXPORT_NAME}`], {
      cwd: scratch.remote,
    });
    expect(blob.equals(bytes)).toBe(true);
    // Nothing local names it: the checkout's refs are its branch and origin's.
    expect(git(root, ["for-each-ref", "--format=%(refname)", "refs/squeal"])).toBe("");
  });

  it("deletes the refs beyond the newest keep main commits, and keeps what it cannot place", async () => {
    const { scratch, root, commits } = setup(5);
    for (const sha of commits.slice(0, 4)) {
      const done = await publishExport({ root, bytes: exportOf(sha), ...options });
      expect(done).not.toHaveProperty("refused");
    }
    // A merge-group commit that never reached main: no commit here names it.
    const orphan = "f".repeat(40);
    git(root, ["push", "-q", "origin", `${commits[0]}:refs/squeal/${orphan}`]);
    const last = commits[4] as string;
    const published = await publishExport({ root, bytes: exportOf(last), ...options, keep: 2 });
    if ("refused" in published) throw new Error(published.refused);
    expect(published.deleted).toEqual(commits.slice(0, 3).reverse());
    expect(published.unplaced).toBe(1);
    expect(published.failed).toEqual([]);
    expect(remoteRefs(scratch)).toEqual(
      [`refs/squeal/${commits[3]}`, `refs/squeal/${last}`, `refs/squeal/${orphan}`].sort(),
    );
  });

  it("replaces the ref of a commit published again", async () => {
    const { scratch, root, commits } = setup(1);
    const sha = commits[0] as string;
    await publishExport({ root, bytes: exportOf(sha), ...options });
    const again = exportOf(sha, { observedStartup: [{ project: "p", paths: ["a.ts"] }] });
    const published = await publishExport({ root, bytes: again, ...options });
    if ("refused" in published) throw new Error(published.refused);
    expect(git(scratch.remote, ["rev-parse", `refs/squeal/${sha}`])).toBe(published.result);
  });

  it("refuses a file that is no export, and an export of a commit this checkout lacks", async () => {
    const { scratch, root } = setup(1);
    const junk = await publishExport({ root, bytes: Buffer.from("{}"), ...options });
    expect(junk).toEqual({ refused: "not a gzipped JSON file" });
    const absent = "a".repeat(40);
    const missing = await publishExport({ root, bytes: exportOf(absent), ...options });
    expect(missing).toEqual({
      refused: `this checkout does not hold commit ${absent}; publish from a checkout of it`,
    });
    expect(remoteRefs(scratch)).toEqual([]);
  });

  it("names git's error when the remote cannot be reached", async () => {
    const { root, commits } = setup(1);
    git(root, ["remote", "set-url", "origin", "/nonexistent/remote.git"]);
    const failed = await publishExport({ root, bytes: exportOf(commits[0] as string), ...options });
    expect(failed).toHaveProperty("refused");
    expect((failed as { refused: string }).refused).toContain("cannot list origin's results refs");
  });
});
