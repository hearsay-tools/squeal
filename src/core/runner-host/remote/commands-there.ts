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
 * of `requires.commands` on a remote, looked for at each connect before its
 * tree is sent. One that every test needs (the array form, or `"*"`),
 * missing there or of another version, refuses the remote. One that only a
 * glob's files need keeps those files here: the connect answers which, and
 * the lane routes them (`lane-commands.ts`). A version check runs the
 * command with its `version` argument on both machines and compares the
 * first output line; a command missing here takes no version check.
 */

/** A command of a glob's files the remote lacks, or has at another version. */
export interface FileCommandLack {
  readonly glob: string;
  /** Not found on the remote's `PATH`. */
  readonly missing: readonly string[];
  /** Found there, its version's first line unequal to this machine's. */
  readonly differing: readonly VersionDiff[];
}

export interface VersionDiff {
  readonly command: string;
  readonly here: string;
  readonly there: string;
}

/** What a connect found of the per-file commands. */
export interface CommandsThere {
  /** Every command name looked for: one the policy names later is not, until the next connect. */
  readonly checked: readonly string[];
  /** The globs whose files run here, each with why. */
  readonly files: readonly FileCommandLack[];
}

/** How the remote is looked at: `missingThere` and a version's first line there. */
export interface CommandLook {
  readonly missing: (commands: readonly string[]) => Promise<string[]>;
  readonly version: (need: CommandNeed & { readonly version: string }) => Promise<string>;
  readonly versionHere: (need: CommandNeed & { readonly version: string }) => string | null;
}

/**
 * The remote's answer to `required`: a refusal's text when a command every
 * test needs is missing or differs there, else what the glob's files lack.
 * Throws when the remote cannot look.
 */
export async function commandsThere(
  required: RequiredCommands,
  look: CommandLook,
): Promise<CommandsThere | { readonly refusal: string }> {
  const needs = commandNeeds(required);
  const checked = commandNames(needs);
  const missing = new Set(checked.length === 0 ? [] : await look.missing(checked));
  const allMissing = needs.all.filter((need) => missing.has(need.command));
  if (allMissing.length > 0) {
    return { refusal: missingText(unique(allMissing.map((need) => need.command)), "there") };
  }
  const versions = await versionsOf(needs, missing, look);
  const allDiffer = needs.all.flatMap((need) => versions.get(need.command) ?? []);
  if (allDiffer.length > 0) return { refusal: differText(allDiffer) };
  const files: FileCommandLack[] = [];
  for (const { glob, needs: own } of needs.files) {
    const lacks = unique(own.filter((n) => missing.has(n.command)).map((n) => n.command));
    const differing = own.flatMap((need) => versions.get(need.command) ?? []);
    if (lacks.length > 0 || differing.length > 0) files.push({ glob, missing: lacks, differing });
  }
  return { checked, files };
}

/** Each command of a `version` entry present there and here whose first lines differ. */
async function versionsOf(
  needs: CommandNeeds,
  missing: ReadonlySet<string>,
  look: CommandLook,
): Promise<Map<string, VersionDiff>> {
  const diffs = new Map<string, VersionDiff>();
  const seen = new Set<string>();
  for (const need of [...needs.all, ...needs.files.flatMap((file) => file.needs)]) {
    if (need.version === undefined || missing.has(need.command)) continue;
    const key = `${need.command}\0${need.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const versioned = { command: need.command, version: need.version };
    const here = look.versionHere(versioned);
    if (here === null) continue;
    const there = await look.version(versioned);
    if (there !== here) diffs.set(need.command, { command: need.command, here, there });
  }
  return diffs;
}

/** D13.2's refusal for a command every test needs at another version there. */
function differText(diffs: readonly VersionDiff[]): string {
  const each = diffs.map(
    (d) => `${d.command} ${JSON.stringify(d.there)} there, ${JSON.stringify(d.here)} here`,
  );
  return `tests need the same version of ${each.join("; ")}`;
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
