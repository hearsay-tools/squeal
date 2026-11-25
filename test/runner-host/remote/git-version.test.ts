import { describe, expect, it } from "vitest";
import {
  gitVersionRefusal,
  localGitVersion,
  parseGitVersion,
} from "../../../src/core/runner-host/remote/git-version.js";

/*
 * Row 026-27: a remote whose Git is older than this machine's, by
 * `major.minor`, or that has none, may not run under this machine's keys.
 */

const HERE = "git version 2.43.0";

describe("a remote's Git against this machine's (row 026-27)", () => {
  it("reads the version of git --version's output", () => {
    expect(parseGitVersion("git version 2.39.5")).toEqual([2, 39, 5]);
    expect(parseGitVersion("git version 2.39.5 (Apple Git-154)")).toEqual([2, 39, 5]);
    expect(parseGitVersion("git version 2.45.windows.1")).toEqual([2, 45, 0]);
    expect(parseGitVersion("command not found")).toBeNull();
  });

  it("refuses an older minor version", () => {
    expect(gitVersionRefusal("git version 2.39.5", HERE)).toBe(
      "git 2.39.5 on the remote is older than 2.43.0 here; upgrade Git on the remote or disable the remote lane",
    );
    expect(gitVersionRefusal("git version 1.99.0", HERE)).not.toBeNull();
  });

  it("takes the same minor version with another patch, and a newer one", () => {
    expect(gitVersionRefusal("git version 2.43.7", "git version 2.43.0")).toBeNull();
    expect(gitVersionRefusal("git version 2.43.0", "git version 2.43.7")).toBeNull();
    expect(gitVersionRefusal("git version 2.56.1", HERE)).toBeNull();
    expect(gitVersionRefusal("git version 3.0.0", HERE)).toBeNull();
  });

  it("refuses a remote without Git", () => {
    expect(gitVersionRefusal(null, HERE)).toBe("git is not installed on the remote (2.43.0 here)");
  });

  it("refuses a remote Git whose version it cannot read", () => {
    expect(gitVersionRefusal("oops", HERE)).toBe('git on the remote printed "oops" (2.43.0 here)');
  });

  it("compares nothing for a remote that did not report its Git, or without Git here", () => {
    expect(gitVersionRefusal(undefined, HERE)).toBeNull();
    expect(gitVersionRefusal(null, null)).toBeNull();
    expect(gitVersionRefusal("git version 2.39.5", null)).toBeNull();
  });

  it("reads this machine's Git once", () => {
    const first = localGitVersion();
    expect(first === null || parseGitVersion(first) !== null).toBe(true);
    expect(localGitVersion()).toBe(first);
  });
});
