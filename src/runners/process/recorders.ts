import { fileURLToPath } from "node:url";
import { quoteNodeOption, tokenizeNodeOptions } from "./node-options.js";

/**
 * Where Squeal's recorders sit: 001-132's (`observe/`) and node:test's
 * (`node-test/`) in a plugin's `dist`, and both in this repository's `src`.
 */
const RECORDERS = [
  "/dist/observe/recorder.cjs",
  "/dist/node-test/recorder.cjs",
  "/src/runners/observe/recorder.cjs",
  "/src/runners/node-test/runtime/recorder.cjs",
] as const;

/**
 * The settings in the processes of a run that does not observe, in place of
 * another Squeal's (task 001-431). They name no worktree, so no recorder
 * records with them, and that Squeal's spawn hook, still in the process that
 * starts the run, leaves a child with settings other than its own as they are
 * (`spawn.cjs`), so its recorder stays out of the run as it does out of an
 * observing one.
 */
export const UNOBSERVED = JSON.stringify({ out: "" });

/** Whether a `--require` or `--import` value is one of Squeal's recorders, by absolute path or `file:` URL. */
export function isSquealRecorder(specifier: string): boolean {
  let path = specifier;
  if (specifier.startsWith("file:")) {
    try {
      path = fileURLToPath(specifier);
    } catch {
      return false;
    }
  }
  if (!path.startsWith("/")) return false;
  return RECORDERS.some((suffix) => path.endsWith(suffix));
}

const PRELOAD_FLAGS = new Set(["--require", "-r", "--import"]);

/** `NODE_OPTIONS` tokens without each `--require`, `-r` or `--import` of a Squeal recorder. */
export function withoutSquealRecorders(tokens: readonly string[]): string[] {
  const kept: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as string;
    const equals = token.indexOf("=");
    const flag = equals === -1 ? token : token.slice(0, equals);
    if (!PRELOAD_FLAGS.has(flag)) {
      kept.push(token);
      continue;
    }
    const value = equals === -1 ? tokens[i + 1] : token.slice(equals + 1);
    if (value === undefined || !isSquealRecorder(value)) {
      kept.push(token);
    } else if (equals === -1) {
      i++;
    }
  }
  return kept;
}

/**
 * `NODE_OPTIONS` without Squeal's recorders: `undefined` when they were all
 * it held, the value as written when it held none or Node could not parse it.
 */
export function ownNodeOptions(options: string): string | undefined {
  const tokens = tokenizeNodeOptions(options);
  if (tokens === null) return options;
  const kept = withoutSquealRecorders(tokens);
  if (kept.length === 0 && tokens.length > 0) return undefined;
  return kept.length < tokens.length ? kept.map(asWritten).join(" ") : options;
}

/** A token as `NODE_OPTIONS` reads it back: quoted only when it holds a space or a quote. */
function asWritten(token: string): string {
  return /[ "]/.test(token) ? quoteNodeOption(token) : token;
}
