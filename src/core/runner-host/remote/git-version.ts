import { execFileSync } from "node:child_process";

/*
 * Spec 021 D11.2 / Spec 026 D10 (row 026-27): a remote whose Git is older
 * than this machine's runs Git-using tests differently (a Debian 12 VM's
 * Git 2.39.5 against 2.43.0 here), and its failures would be stored under
 * this worktree's keys. The lane refuses such a remote before a run. Git's
 * version stays out of the key (`CoreEnvironmentInputs`): CI runs a newer
 * Git than this machine, and its keys must stay byte-identical.
 */

/** A Git version: `[major, minor, patch]`. */
export type GitVersion = readonly [number, number, number];

/** The version in `git --version`'s output (`git version 2.39.5 (Apple Git-154)`); `null`: none. */
export function parseGitVersion(text: string): GitVersion | null {
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(text);
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

let local: string | null | undefined;

/** `git --version` here, read once; `null` when Git is missing here. */
export function localGitVersion(): string | null {
  if (local !== undefined) return local;
  try {
    local = execFileSync("git", ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    local = null;
  }
  return local;
}

/**
 * Why a remote with `remoteGit` may not run under this machine's keys, or
 * `null` when it may: by `major.minor`, a patch release differs too little.
 * `undefined` is a remote that did not report its Git (a test's fake host),
 * and a missing or unreadable Git here compares nothing.
 */
export function gitVersionRefusal(
  remoteGit: string | null | undefined,
  localGit: string | null,
): string | null {
  if (remoteGit === undefined || localGit === null) return null;
  const here = parseGitVersion(localGit);
  if (here === null) return null;
  const hereText = here.join(".");
  if (remoteGit === null) return `git is not installed on the remote (${hereText} here)`;
  const there = parseGitVersion(remoteGit);
  if (there === null) {
    return `git on the remote printed ${JSON.stringify(remoteGit.slice(0, 80))} (${hereText} here)`;
  }
  if (there[0] > here[0] || (there[0] === here[0] && there[1] >= here[1])) return null;
  return `git ${there.join(".")} on the remote is older than ${hereText} here; upgrade Git on the remote or disable the remote lane`;
}
