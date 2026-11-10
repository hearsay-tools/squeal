/*
 * Spec 020 D1 (row 020-05): the arguments of `squeal code --base`. D8 adds
 * `--exceptions` (row 020-09), D13.2 `--parts` (row 020-08b).
 */

export const CODE_GATE_USAGE =
  "squeal code --base <ref> [<path>...] [--test <file>...] [--parts <dir>...] [--timeout <seconds>] [--exceptions <file>] [--json]";

/** D3.4: the one budget over every run, in seconds. */
export const DEFAULT_BUDGET_SECONDS = 600;

export interface GateArgs {
  readonly ref: string;
  readonly paths: readonly string[];
  readonly tests: readonly string[];
  readonly budgetSeconds: number;
  readonly json: boolean;
  /** D8: the exceptions file, as given; absent without `--exceptions`. */
  readonly exceptions?: string;
  /** D13.2: the directories of `ci record`'s parts, as given; absent without `--parts`. */
  readonly parts?: readonly string[];
}

/** `--flag=value` as the flag and its value; any other argument as itself. */
function split(arg: string): [string, string | undefined] {
  const eq = arg.indexOf("=");
  return arg.startsWith("--") && eq > 0 ? [arg.slice(0, eq), arg.slice(eq + 1)] : [arg, undefined];
}

/** The arguments read so far. */
interface Draft {
  ref: string | null;
  budget: number | null;
  exceptions: string | null;
  json: boolean;
  readonly paths: string[];
  readonly tests: string[];
  readonly parts: string[];
}

/** The options that take one value: each stores it, or says why it cannot. */
const VALUED: Readonly<Record<string, (value: string, into: Draft) => string | null>> = {
  "--base": (value, into) => {
    if (value === "") return "--base names no ref";
    if (into.ref !== null) return "--base is given twice";
    into.ref = value;
    return null;
  },
  "--timeout": (value, into) => {
    if (!/^[1-9][0-9]*$/.test(value)) return "--timeout takes whole seconds above 0";
    into.budget = Number(value);
    return null;
  },
  "--exceptions": (value, into) => {
    if (value === "") return "--exceptions names no file";
    if (into.exceptions !== null) return "--exceptions is given twice";
    into.exceptions = value;
    return null;
  },
};

/**
 * The options that take the arguments after them up to the next option:
 * `--test`'s files (D3.1) and `--parts`'s directories (D13.2). Each stores
 * them, or says why it cannot.
 */
const LISTED: Readonly<Record<string, (values: readonly string[], into: Draft) => string | null>> =
  {
    "--test": (files, into) => {
      if (files.length === 0 || files.includes("")) return "--test names no file";
      into.tests.push(...files);
      return null;
    },
    "--parts": (dirs, into) => {
      if (dirs.length === 0 || dirs.includes("")) return "--parts names no directory";
      into.parts.push(...dirs);
      return null;
    },
  };

/** The values after `args[i]` up to the next option, at most `most`; and the index of the last. */
function valuesAfter(args: readonly string[], i: number, most: number) {
  let at = i;
  while (at - i < most && at + 1 < args.length && !(args[at + 1] as string).startsWith("--")) at++;
  return { values: args.slice(i + 1, at + 1), at };
}

/**
 * D1's arguments. `--test` and `--parts` take every argument after them up
 * to the next option, as `ci export --parts` does, so paths go before them;
 * they may also repeat. `--changed` and `--told` are usage errors with
 * `--base`.
 */
export function parseGateArgs(args: readonly string[]): GateArgs | { readonly error: string } {
  const draft: Draft = {
    ref: null,
    budget: null,
    exceptions: null,
    json: false,
    paths: [],
    tests: [],
    parts: [],
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    const [flag, inline] = split(arg);
    const valued = VALUED[flag];
    const take =
      valued === undefined
        ? LISTED[flag]
        : (values: readonly string[], into: Draft) => valued(values[0] ?? "", into);
    if (flag === "--changed" || flag === "--told") {
      return {
        error: `--base does not combine with ${flag}: each chooses the functions another way`,
      };
    } else if (arg === "--json") draft.json = true;
    else if (take !== undefined) {
      const taken =
        inline === undefined
          ? valuesAfter(args, i, valued === undefined ? Infinity : 1)
          : { values: [inline], at: i };
      const error = take(taken.values, draft);
      if (error !== null) return { error };
      i = taken.at;
    } else if (arg.startsWith("--")) return { error: `unknown option "${arg}"` };
    else draft.paths.push(arg);
  }
  const { ref, budget, exceptions, json, paths, tests, parts } = draft;
  if (ref === null) return { error: "--base names no ref" };
  const budgetSeconds = budget ?? DEFAULT_BUDGET_SECONDS;
  return {
    ref,
    paths,
    tests,
    budgetSeconds,
    json,
    ...(exceptions === null ? {} : { exceptions }),
    ...(parts.length === 0 ? {} : { parts }),
  };
}
