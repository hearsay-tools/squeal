import { fileURLToPath } from "node:url";
import type { NodeTestProject } from "../../core/types/index.js";
import { quoteNodeOption, tokenizeNodeOptions } from "./run/node-options.js";

/**
 * Where Squeal's recorders sit: 001-132's (`observe/`) and this runner's
 * (`node-test/`) in a plugin's `dist`, and both in this repository's `src`.
 */
const RECORDERS = [
  "/dist/observe/recorder.cjs",
  "/dist/node-test/recorder.cjs",
  "/src/runners/observe/recorder.cjs",
  "/src/runners/node-test/runtime/recorder.cjs",
] as const;

/** Settings of 001-132's recorder (`src/runners/observe/runtime.ts`). */
const OBSERVE_VARIABLE = "SQUEAL_OBSERVE";

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
 * The environment of the project's processes: the inherited one, minus what
 * Squeal itself put there, with the project's `env` merged over it (D1).
 * Dropped: `NODE_TEST_CONTEXT`, from a `node --test` around Squeal, which
 * would make the project's runner act as a child and write no report; and,
 * under a Squeal daemon (task 003-35), `SQUEAL_OBSERVE` and Squeal's
 * recorders in `NODE_OPTIONS`, which are no project preload. A project's own
 * `env` is kept as written.
 */
export function projectEnv(
  project: NodeTestProject,
  inherited: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const { NODE_TEST_CONTEXT: _, [OBSERVE_VARIABLE]: __, ...base } = inherited;
  const options = base.NODE_OPTIONS;
  const tokens = options === undefined ? null : tokenizeNodeOptions(options);
  if (tokens !== null) {
    const kept = withoutSquealRecorders(tokens);
    if (kept.length === 0 && tokens.length > 0) delete base.NODE_OPTIONS;
    else if (kept.length < tokens.length) base.NODE_OPTIONS = kept.map(asWritten).join(" ");
  }
  return { ...base, ...project.env };
}

/** A token as `NODE_OPTIONS` reads it back: quoted only when it holds a space or a quote. */
function asWritten(token: string): string {
  return /[ "]/.test(token) ? quoteNodeOption(token) : token;
}
