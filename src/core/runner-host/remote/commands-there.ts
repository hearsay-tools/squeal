import {
  type CommandNeeds,
  commandNames,
  commandNeeds,
  firstLine,
  MISSING_SCRIPT,
  missingText,
  versionHere,
} from "../../daemon/required-commands.js";
import type { CommandNeed, RequiredCommands } from "../../types/policy.js";
import type { RemotePlaces } from "./bundle.js";
import { type SshTarget, shellQuote, sshFailure, sshRun } from "./ssh.js";

/*
 * Spec 021 D19.1 (row 021-23) and spec 026 D13.2 (row 026-36): the commands
 * of `requires.commands` on a remote, looked for at each connect. One that
 * every test needs (the array form, or `"*"`), missing there or of another
 * version, refuses the remote. One that only a glob's files need keeps
 * those files here: the lane routes them (`lane-commands.ts`). A version
 * check runs the command with its `version` argument on both machines and
 * compares the first output line; a command missing here takes no version
 * check.
 *
 * Review 0.1.656 B3 and B4: the answer holds facts, not globs: each command
 * looked for, whether it is missing there, and each version check by
 * command and argument. The lane applies the live policy to them, so a
 * reloaded glob keeps what the connect found, and a version check counts
 * only for an entry that asks for that command with that argument.
 */

/** One version check: `command version` here and there. */
export interface VersionFact {
  readonly command: string;
  /** The argument it ran with, as the entry names it. */
  readonly version: string;
  /** Its first line here; `null`: the command cannot run here, so nothing is compared. */
  readonly here: string | null;
  /** Its first line there; `null` when it did not run there (no line here to compare). */
  readonly there: string | null;
}

/** What a connect found of the commands `requires.commands` named then. */
export interface CommandsThere {
  /** Every command name looked for: one the policy names later is not, until the next connect. */
  readonly checked: readonly string[];
  /** Of `checked`, those not found on the remote's `PATH`. */
  readonly missing: readonly string[];
  /** Each version check of a command present there, once per command and argument. */
  readonly versions: readonly VersionFact[];
}

/** How the remote is looked at: `missingThere` and a version's first line there. */
export interface CommandLook {
  readonly missing: (commands: readonly string[]) => Promise<string[]>;
  readonly version: (need: CommandNeed & { readonly version: string }) => Promise<string>;
  readonly versionHere: (need: CommandNeed & { readonly version: string }) => string | null;
}

/** Whether `fact` holds two first lines, unequal; not when equal, absent or nothing to compare. */
export function versionDiffers(fact: VersionFact | undefined): fact is VersionFact & {
  readonly here: string;
  readonly there: string;
} {
  return (
    fact !== undefined && fact.here !== null && fact.there !== null && fact.here !== fact.there
  );
}

/** The fact of `need`'s own version check in `facts`: same command, same argument. */
export function versionFact(
  facts: readonly VersionFact[],
  need: CommandNeed,
): VersionFact | undefined {
  if (need.version === undefined) return undefined;
  return facts.find((fact) => fact.command === need.command && fact.version === need.version);
}

/**
 * The remote's answer to `required`: a refusal's text when a command every
 * test needs is missing or differs there, else what it found of each
 * command. Throws when the remote cannot look.
 */
export async function commandsThere(
  required: RequiredCommands,
  look: CommandLook,
): Promise<CommandsThere | { readonly refusal: string }> {
  const needs = commandNeeds(required);
  const checked = commandNames(needs);
  const missing = checked.length === 0 ? [] : await look.missing(checked);
  const allMissing = needs.all.filter((need) => missing.includes(need.command));
  if (allMissing.length > 0) {
    return { refusal: missingText(unique(allMissing.map((need) => need.command)), "there") };
  }
  const versions = await versionsOf(needs, new Set(missing), look);
  const allDiffer = needs.all.map((need) => versionFact(versions, need)).filter(versionDiffers);
  if (allDiffer.length > 0) return { refusal: differText(uniqueFacts(allDiffer)) };
  return { checked, missing, versions };
}

/** Each `version` entry's check, once per command and argument, of a command present there. */
async function versionsOf(
  needs: CommandNeeds,
  missing: ReadonlySet<string>,
  look: CommandLook,
): Promise<VersionFact[]> {
  const facts: VersionFact[] = [];
  for (const need of [...needs.all, ...needs.files.flatMap((file) => file.needs)]) {
    if (need.version === undefined || missing.has(need.command)) continue;
    if (versionFact(facts, need) !== undefined) continue;
    const versioned = { command: need.command, version: need.version };
    const here = look.versionHere(versioned);
    const there = here === null ? null : await look.version(versioned);
    facts.push({ ...versioned, here, there });
  }
  return facts;
}

/** D13.2's refusal for a command every test needs at another version there. */
function differText(facts: readonly (VersionFact & { here: string; there: string })[]): string {
  const each = facts.map(
    (d) => `${d.command} ${JSON.stringify(d.there)} there, ${JSON.stringify(d.here)} here`,
  );
  return `tests need the same version of ${each.join("; ")}`;
}

function uniqueFacts<T extends VersionFact>(facts: readonly T[]): T[] {
  return facts.filter((fact, i) => facts.indexOf(fact) === i);
}

function unique(names: readonly string[]): string[] {
  return [...new Set(names)];
}

/** The `CommandLook` of `target` over ssh, each look within `deadlineMs`. */
export function sshLook(target: SshTarget, places: RemotePlaces, deadlineMs: number): CommandLook {
  return {
    missing: (commands) => missingThere(target, places, commands, deadlineMs),
    version: async (need) => {
      const ran = await sshRun(target, `${shellQuote(need.command)} ${shellQuote(need.version)}`, {
        deadlineMs,
      });
      // `ssh` itself ends with 255 when it cannot reach the remote.
      if (ran.code === null || ran.code === 255) {
        throw new Error(
          sshFailure(`could not run ${need.command} ${need.version} on ${target.destination}`, ran),
        );
      }
      return firstLine(ran.stdout, ran.stderr);
    },
    versionHere: (need) => versionHere(need),
  };
}

/** Of `commands`, those the remote's `PATH` lacks, by `MISSING_SCRIPT` under its Node. Throws when it cannot look. */
export async function missingThere(
  target: SshTarget,
  places: RemotePlaces,
  commands: readonly string[],
  deadlineMs: number,
): Promise<string[]> {
  if (commands.length === 0) return [];
  const command = [places.node, "-e", MISSING_SCRIPT, ...commands].map(shellQuote).join(" ");
  const looked = await sshRun(target, command, { deadlineMs });
  const what = `could not look for ${commands.join(", ")} on ${target.destination}`;
  if (looked.code !== 0) throw new Error(sshFailure(what, looked));
  try {
    const missing: unknown = JSON.parse(looked.stdout);
    if (Array.isArray(missing) && missing.every((name) => commands.includes(name))) return missing;
  } catch {
    // Below.
  }
  throw new Error(`${what}: its Node printed ${JSON.stringify(looked.stdout.slice(0, 200))}`);
}
