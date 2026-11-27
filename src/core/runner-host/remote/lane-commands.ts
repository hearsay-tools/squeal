import { commandNeeds } from "../../daemon/required-commands.js";
import type { CommandNeed, RequiredCommands } from "../../types/policy.js";
import { type CommandsThere, versionDiffers, versionFact } from "./commands-there.js";

/*
 * Spec 026 D13.2 (row 026-36): the test files that stay here because the
 * remote lacks a command only they need, or has it at another version. The
 * connect looked for each (`commands-there.ts`); the lane's route keeps the
 * files of each such glob here, so no remote result is stored for them, and
 * status names the glob with the fix. Before any connect answered, every
 * per-file glob stays here: nothing says the remote has its commands.
 *
 * Review 0.1.656 B3 and B4: the route reads the live policy against the
 * connect's facts by command, never by glob: a command found missing stays
 * missing under any glob a reload gives it. A command the connect did not
 * look for, or a version check it did not run (another command, another
 * argument), keeps its files here, named, until the next connect. A plain
 * name asks only for presence: no version check applies to it. After a
 * connect, the array form and `"*"` route the same way over every file: the
 * connect refused on their own entries, so only a reload can name one it
 * did not find.
 */

/** The globs whose files run here, and the status line that names them; `null`: none stays. */
export interface CommandRoute {
  readonly globs: readonly string[];
  readonly text: string | null;
  /**
   * Some glob stays here only until a connect answers: none answered yet, or
   * a reload named what the last one did not look for (review 0.1.656 B5).
   */
  readonly provisional: boolean;
}

/** The glob every file matches: `"*"`'s files, and the array form's. */
const EVERY_FILE = "**";

/** What the facts of `there` say of one glob's `needs`. */
interface GlobLack {
  readonly missing: readonly string[];
  readonly differing: readonly { command: string; here: string; there: string }[];
  /** Commands not looked for, and version checks not run, as named in status. */
  readonly unmeasured: readonly string[];
}

function lackOf(needs: readonly CommandNeed[], there: CommandsThere): GlobLack {
  const missing = new Set<string>();
  const differing: { command: string; here: string; there: string }[] = [];
  const unmeasured = new Set<string>();
  for (const need of needs) {
    if (!there.checked.includes(need.command)) unmeasured.add(need.command);
    else if (there.missing.includes(need.command)) missing.add(need.command);
    else if (need.version !== undefined) {
      const fact = versionFact(there.versions, need);
      if (fact === undefined) unmeasured.add(`${need.command} ${need.version}`);
      else if (versionDiffers(fact) && !differing.some((d) => d.command === fact.command)) {
        differing.push({ command: fact.command, here: fact.here, there: fact.there });
      }
    }
  }
  return { missing: [...missing], differing, unmeasured: [...unmeasured] };
}

/** `required`'s globs whose files stay here on `target`, after the connect's answer `there`. */
export function commandRoute(
  required: RequiredCommands,
  there: CommandsThere | null,
  target: string,
): CommandRoute {
  const needs = commandNeeds(required);
  if (there === null) {
    const globs = needs.files.map((file) => file.glob);
    return { globs, text: null, provisional: globs.length > 0 };
  }
  const groups = [
    ...(needs.all.length === 0 ? [] : [{ glob: EVERY_FILE, needs: needs.all }]),
    ...needs.files,
  ];
  const globs: string[] = [];
  const lacking: string[] = [];
  /** The commands of `lacking`, to say "add it" or "add them". */
  const fixes = new Set<string>();
  const unchecked: string[] = [];
  for (const { glob, needs: own } of groups) {
    const { missing, differing, unmeasured } = lackOf(own, there);
    const files = glob === EVERY_FILE ? "every test file" : glob;
    for (const name of [...missing, ...differing.map((diff) => diff.command)]) fixes.add(name);
    if (missing.length > 0) lacking.push(`${target} lacks ${missing.join(", ")} for ${files}`);
    for (const diff of differing) {
      lacking.push(
        `${target} has ${diff.command} ${JSON.stringify(diff.there)}, this machine ${JSON.stringify(diff.here)}, for ${files}`,
      );
    }
    if (unmeasured.length > 0) {
      unchecked.push(`${unmeasured.join(", ")} not yet looked for on ${target} for ${files}`);
    }
    if (missing.length + differing.length + unmeasured.length > 0) globs.push(glob);
  }
  const parts: string[] = [];
  if (lacking.length > 0) {
    const it = fixes.size === 1 ? "it" : "them";
    parts.push(`${lacking.join("; ")}; these files run here; add ${it} to remote.setup`);
  }
  if (unchecked.length > 0) {
    parts.push(`${unchecked.join("; ")}; these files run here until it connects again`);
  }
  return {
    globs,
    text: parts.length === 0 ? null : parts.join("; "),
    provisional: unchecked.length > 0,
  };
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
