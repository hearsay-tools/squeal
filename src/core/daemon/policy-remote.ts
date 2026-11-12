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

const commands = kept("requires.commands", (entry) =>
  commandName(entry) ? null : `must be a command name such as "git", got ${JSON.stringify(entry)}`,
);

const needsRepository = kept("remote.needsRepository", (glob) => compiles([glob])?.problem ?? null);

/** The keys of D9 and D19, spread into the loader's shape. */
export const REMOTE_SHAPE: Shape = {
  requires: { commands },
  remote: { allowed: boolean, needsRepository },
};
