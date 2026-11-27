import { isRecord } from "../fs/json.js";
import { insideRoot } from "../runner-host/remote/tree-wire.js";
import type { Leaf, Shape } from "./config-file.js";
import { compiles } from "./policy-node-test.js";

/*
 * Spec 021 D9 (row 021-13; the coordinator, request 41854ecd): the `remote`
 * key of the policy loader. A user names a remote lane in their own
 * `remote.json` (`src/core/runner-host/remote/settings.ts`); a repository
 * may forbid it with `remote.allowed: false`, and its runs then stay on the
 * user's machine. A wrong value is one problem and the default applies
 * (001 D11).
 *
 * Spec 021 D19 (row 021-23): two settings, kept apart on purpose (the
 * human, 2026-11-12). `requires.commands`, the commands the tests need on
 * `PATH`, here and on each remote; `remote.needsRepository`, the test files
 * that read the repository itself and so always run here. A bad entry of
 * either is one problem and is left out; the others are kept, as
 * `slow.include` keeps its good globs.
 *
 * Row 021-40 (#294): `remote.alwaysLocal`, the test files that read this
 * machine itself (its kernel, processes or tools). They run here always,
 * also when the remote's tree is a Git repository; a bad glob is left out
 * as for `needsRepository`.
 *
 * Spec 026 D13.1 (row 026-35): `remote.setup`, a repository-relative path
 * to the project's script that prepares each remote machine, or `null`. A
 * path that leaves the repository, or names its `.git`, is one problem and
 * the default, none, applies.
 *
 * Spec 026 D13.2 (row 026-36): `requires.commands` also takes an object,
 * test-file globs, `"*"` for every file, to lists of command names or
 * `{ "command": <name>, "version": <argument> }`. The array form is as
 * before. A glob Squeal cannot use, or one whose value is not a list, is
 * left out with one problem; a bad entry in a list is left out with one
 * problem, its glob and index named; the others are kept.
 */

const boolean: Leaf = (v) => (typeof v === "boolean" ? null : "true or false");

/** A list of strings, each kept or named with its index by `bad`. */
const kept =
  (key: string, bad: (entry: string) => string | null): Leaf =>
  (value) => {
    if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
      return "an array of strings";
    }
    const good: string[] = [];
    const problems: string[] = [];
    value.forEach((entry: string, index) => {
      const why = bad(entry);
      if (why === null) good.push(entry);
      else problems.push(`"${key}[${index}]" ${why}; it is left out`);
    });
    return { kept: good, problems };
  };

/**
 * A command's name as `PATH` finds it: no directory, no leading `-` (an
 * option to the remote's check), no space or control character.
 */
export function commandName(entry: string): boolean {
  return /^[^-\s/\\][^\s/\\]*$/.test(entry) && !/\p{Cc}/u.test(entry);
}

const nameProblem = (entry: string) =>
  commandName(entry) ? null : `must be a command name such as "git", got ${JSON.stringify(entry)}`;

const commandList = kept("requires.commands", nameProblem);

/** D13.2: why `entry` of a glob's list cannot be used; `null` when it can. */
function needProblem(entry: unknown): string | null {
  if (typeof entry === "string") return nameProblem(entry);
  const expected = `must be a command name or { "command": "<name>", "version": "<argument>" }, got ${JSON.stringify(entry)}`;
  if (
    !isRecord(entry) ||
    Object.keys(entry).some((key) => key !== "command" && key !== "version")
  ) {
    return expected;
  }
  const { command, version } = entry;
  if (typeof command !== "string" || !commandName(command)) return expected;
  const argument = typeof version === "string" && version !== "" && !/\p{Cc}/u.test(version);
  return version === undefined || argument ? null : expected;
}

/** D19.1's array form, or D13.2's object form of test-file globs to command lists. */
const commands: Leaf = (value) => {
  if (Array.isArray(value)) return commandList(value);
  if (!isRecord(value))
    return "an array of command names, or an object of test-file globs to lists of them";
  const good: Record<string, unknown[]> = {};
  const problems: string[] = [];
  for (const [glob, entries] of Object.entries(value)) {
    const at = `"requires.commands.${glob}"`;
    const bad = glob === "*" ? null : (compiles([glob])?.problem ?? null);
    if (bad !== null) problems.push(`${at} ${bad}; it is left out`);
    else if (!Array.isArray(entries)) {
      problems.push(
        `${at} must be an array of commands, got ${JSON.stringify(entries)}; it is left out`,
      );
    } else {
      good[glob] = entries.filter((entry: unknown, index) => {
        const why = needProblem(entry);
        if (why !== null)
          problems.push(`"requires.commands.${glob}[${index}]" ${why}; it is left out`);
        return why === null;
      });
    }
  }
  return { kept: good, problems };
};

const needsRepository = kept("remote.needsRepository", (glob) => compiles([glob])?.problem ?? null);

/** Row 021-40 (#294): the test files that read this machine itself; they never go remote. */
const alwaysLocal = kept("remote.alwaysLocal", (glob) => compiles([glob])?.problem ?? null);

/** D13.1: `null`, or a path inside the repository, as the remote tree holds it. */
const setup: Leaf = (value) =>
  value === null || (typeof value === "string" && insideRoot(value))
    ? null
    : 'null or a repository-relative path to a script, such as ".squeal/remote-setup.sh"';

/** The keys of D9, D19 and 026 D13, spread into the loader's shape. */
export const REMOTE_SHAPE: Shape = {
  requires: { commands },
  remote: { allowed: boolean, needsRepository, alwaysLocal, setup },
};
