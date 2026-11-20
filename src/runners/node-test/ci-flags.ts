import { fileURLToPath } from "node:url";
import type { PartShard } from "../../core/ci/parts.js";
import { tokenizeNodeOptions } from "../process/node-options.js";
import { withoutSquealRecorders } from "../process/recorders.js";

/*
 * Spec 018 D25 (row 018-47): what a `node --test` process's `execArgv` says
 * about its run. A run the daemon never runs leaves its part without files:
 * one that shares one process between files, or runs part of a file.
 */

/** Each refused flag, as Node spells it, and the value that refuses it (any value when `null`). */
const REFUSED: readonly { readonly flag: string; readonly value: string | null }[] = [
  { flag: "--test-isolation", value: "none" },
  { flag: "--experimental-test-isolation", value: "none" },
  { flag: "--test-name-pattern", value: null },
  { flag: "--test-skip-pattern", value: null },
  { flag: "--test-only", value: null },
  { flag: "--watch", value: null },
];

/** Flags that take their value as the next argument when written without `=`. */
const VALUED = new Set([
  "--test-isolation",
  "--experimental-test-isolation",
  "--test-name-pattern",
  "--test-skip-pattern",
  "--test-shard",
]);

interface Flag {
  readonly flag: string;
  readonly value: string | null;
}

/** Each flag of `execArgv` with its value: `--a=b` and `--a b` alike, `null` for a bare flag. */
function flags(execArgv: readonly string[]): Flag[] {
  const out: Flag[] = [];
  for (let i = 0; i < execArgv.length; i++) {
    const token = execArgv[i] as string;
    const equals = token.indexOf("=");
    if (equals !== -1) out.push({ flag: token.slice(0, equals), value: token.slice(equals + 1) });
    else if (VALUED.has(token)) out.push({ flag: token, value: execArgv[++i] ?? null });
    else out.push({ flag: token, value: null });
  }
  return out;
}

/** The first flag of `execArgv` D25 refuses, as written in the note, or `null`. */
export function refusedFlag(execArgv: readonly string[]): string | null {
  for (const { flag, value } of flags(execArgv)) {
    const refused = REFUSED.find((r) => r.flag === flag && (r.value === null || r.value === value));
    if (refused !== undefined) return refused.value === null ? flag : `${flag}=${refused.value}`;
  }
  return null;
}

/** The process's `--test-shard` (`index/count`); `1/1` without one or with one Node would refuse. */
export function shardOf(execArgv: readonly string[]): PartShard {
  const shard = flags(execArgv).findLast((f) => f.flag === "--test-shard")?.value;
  const match = /^(\d+)\/(\d+)$/.exec(shard ?? "");
  const index = Number(match?.[1]);
  const count = Number(match?.[2]);
  return match !== null && index >= 1 && index <= count ? { index, count } : { index: 1, count: 1 };
}

const PRELOADS = new Set(["--require", "-r", "--import"]);

/** A preload's path: a `file:` URL as its path, anything else as written. */
function pathOf(specifier: string): string {
  if (!specifier.startsWith("file:")) return specifier;
  try {
    return fileURLToPath(specifier);
  } catch {
    return specifier;
  }
}

/**
 * Review of 0.1.579 B1: the project's own Node options of a process whose
 * `NODE_OPTIONS` was `raw` (`null`: unset), as Node splits them, without
 * each preload of `hooks` (the files `ci record` put there) and of
 * Squeal's recorders. `null` when Node's splitting fails.
 */
export function projectNodeOptions(raw: string | null, hooks: readonly string[]): string[] | null {
  const tokens = tokenizeNodeOptions(raw ?? "");
  if (tokens === null) return null;
  const own = new Set(hooks);
  const kept: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as string;
    const equals = token.indexOf("=");
    const flag = equals === -1 ? token : token.slice(0, equals);
    const value = equals === -1 ? tokens[i + 1] : token.slice(equals + 1);
    if (PRELOADS.has(flag) && value !== undefined && own.has(pathOf(value))) {
      if (equals === -1) i++;
      continue;
    }
    kept.push(token);
  }
  return withoutSquealRecorders(kept);
}
