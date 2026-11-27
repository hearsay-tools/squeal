import { commandNeeds } from "../../daemon/required-commands.js";
import type { RequiredCommands } from "../../types/policy.js";
import type { CommandsThere } from "./commands-there.js";

/*
 * Spec 026 D13.2 (row 026-36): the test files that stay here because the
 * remote lacks a command only they need, or has it at another version. The
 * connect looked for each (`commands-there.ts`); the lane's route keeps the
 * files of each such glob here, so no remote result is stored for them, and
 * status names the glob with the fix. Before any connect answered, every
 * per-file glob stays here: nothing says the remote has its commands. A
 * command the policy names after the connect was not looked for there; its
 * files stay here until the next connect, named.
 */

/** The globs whose files run here, and the status line that names them; `null`: none stays. */
export interface CommandRoute {
  readonly globs: readonly string[];
  readonly text: string | null;
}

/** `required`'s per-file globs that stay here on `target`, after the connect's answer `there`. */
export function commandRoute(
  required: RequiredCommands,
  there: CommandsThere | null,
  target: string,
): CommandRoute {
  const { files } = commandNeeds(required);
  if (files.length === 0) return { globs: [], text: null };
  if (there === null) return { globs: files.map((file) => file.glob), text: null };
  const checked = new Set(there.checked);
  const globs: string[] = [];
  const lacking: string[] = [];
  /** The commands of `lacking`, to say "add it" or "add them". */
  const fixes = new Set<string>();
  const unchecked: string[] = [];
  for (const { glob, needs } of files) {
    const names = new Set(needs.map((need) => need.command));
    const lack = there.files.find((file) => file.glob === glob);
    const missing = lack?.missing.filter((name) => names.has(name)) ?? [];
    const differing = lack?.differing.filter((diff) => names.has(diff.command)) ?? [];
    const notLooked = [...names].filter((name) => !checked.has(name));
    for (const name of [...missing, ...differing.map((diff) => diff.command)]) fixes.add(name);
    if (missing.length > 0) lacking.push(`${target} lacks ${missing.join(", ")} for ${glob}`);
    for (const diff of differing) {
      lacking.push(
        `${target} has ${diff.command} ${JSON.stringify(diff.there)}, this machine ${JSON.stringify(diff.here)}, for ${glob}`,
      );
    }
    if (notLooked.length > 0) {
      unchecked.push(`${notLooked.join(", ")} not yet looked for on ${target} for ${glob}`);
    }
    if (missing.length + differing.length + notLooked.length > 0) globs.push(glob);
  }
  const parts: string[] = [];
  if (lacking.length > 0) {
    const it = fixes.size === 1 ? "it" : "them";
    parts.push(`${lacking.join("; ")}; these files run here; add ${it} to remote.setup`);
  }
  if (unchecked.length > 0) {
    parts.push(`${unchecked.join("; ")}; these files run here until it connects again`);
  }
  return { globs, text: parts.length === 0 ? null : parts.join("; ") };
}

/**
 * `route` memoized over its inputs, so the globs it returns are the same
 * array while neither the policy's value nor the connect's answer changes
 * (the route's matcher compiles again only on a new array).
 */
export function memoCommandRoute(
  required: () => RequiredCommands,
  there: () => CommandsThere | null,
  target: string,
): () => CommandRoute {
  let last: {
    required: RequiredCommands;
    there: CommandsThere | null;
    route: CommandRoute;
  } | null = null;
  return () => {
    const now = { required: required(), there: there() };
    if (last === null || last.required !== now.required || last.there !== now.there) {
      last = { ...now, route: commandRoute(now.required, now.there, target) };
    }
    return last.route;
  };
}
