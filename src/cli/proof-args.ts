import type { EnvCondition } from "../core/proof/conditions.js";
import type { ProofCase } from "../core/proof/sides.js";

/*
 * Spec 023 D1, D5 (rows 023-08, 023-11): `squeal proof`'s arguments. Row
 * 023-11 adds the conditions (`--env NAME=[value]` and `--without <path>`,
 * each repeatable), `--repeat <n>` and `--case dependency`, which needs a
 * condition. A `--without` path is placed (repository or `HOME`) once the
 * worktree is known (`placeWithout`). Row 023-21 (D5.2, issue #247):
 * `--with <path>`, repeatable, copies a helper from the test version as
 * test code, with no verdict of its own.
 */

/** The default budget, the checkouts and installs included, as D4.6's. */
export const PROOF_TIMEOUT_SECONDS = 600;

/** D5.4's bound on `--repeat`. */
export const MAX_REPEAT = 100;

export interface ProofArgs {
  /** The named test files as given, from the cwd. */
  readonly files: readonly string[];
  readonly base: string;
  /** `null`: D5's default from the diff and the closure. */
  readonly case: ProofCase | null;
  readonly timeoutSeconds: number;
  readonly json: boolean;
  /** D5.3: each `--env`, in order; `value` `null` unsets. */
  readonly env?: readonly EnvCondition[];
  /** D5.3: each `--without` path as given. */
  readonly without?: readonly string[];
  /** Review wave-9 B1: each `--home-keep` path as given, copied into the run's own `HOME`. */
  readonly homeKeep?: readonly string[];
  /** D5.4: the red side's most runs and the green side's runs; default 1. */
  readonly repeat?: number;
  /** Row 023-21 (D5.2): each `--with` path as given, copied from the test version as test code. */
  readonly with?: readonly string[];
  /** Row 023-22 (D5.5): each `--red-error` text; a red failure whose message holds one counts. */
  readonly redErrors?: readonly string[];
}

/** A usage problem, told in one line. */
export type ProofUsage = { readonly usage: string };

const VALUED = [
  "--base",
  "--case",
  "--timeout",
  "--env",
  "--without",
  "--home-keep",
  "--repeat",
  "--with",
  "--red-error",
] as const;
type Valued = (typeof VALUED)[number];
const REPEATABLE: ReadonlySet<Valued> = new Set([
  "--env",
  "--without",
  "--home-keep",
  "--with",
  "--red-error",
]);

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parseProof(args: readonly string[]): ProofArgs | ProofUsage {
  const values = new Map<Valued, string[]>();
  const files: string[] = [];
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    const taken = valued(args, i, values);
    if (typeof taken === "object") return taken;
    if (taken > 0) i += taken - 1;
    else if (arg === "--json") json = true;
    else if (arg.startsWith("--")) return { usage: `unknown option "${arg}"` };
    else files.push(arg);
  }
  return checked(values, files, json);
}

/**
 * The valued option at `args[i]` into `values`: how many words it took
 * (0 when it is none), or the usage problem it has.
 */
function valued(
  args: readonly string[],
  i: number,
  values: Map<Valued, string[]>,
): number | ProofUsage {
  const arg = args[i] ?? "";
  const name = VALUED.find((v) => arg === v || arg.startsWith(`${v}=`));
  if (name === undefined) return 0;
  const inline = arg.length > name.length;
  const value = inline ? arg.slice(name.length + 1) : args[i + 1];
  if (value === undefined || (!inline && value.startsWith("--")))
    return { usage: `${name} needs a value` };
  const given = values.get(name) ?? [];
  if (given.length > 0 && !REPEATABLE.has(name)) return { usage: `${name} is given twice` };
  values.set(name, [...given, value]);
  return inline ? 1 : 2;
}

function checked(
  values: ReadonlyMap<Valued, readonly string[]>,
  files: readonly string[],
  json: boolean,
): ProofArgs | ProofUsage {
  const one = (name: Valued) => values.get(name)?.[0];
  const base = one("--base");
  if (base === undefined || base === "") return { usage: "--base needs a commit" };
  if (files.length === 0) return { usage: "name at least one test file" };
  const env = envOf(values.get("--env") ?? []);
  if ("usage" in env) return env;
  const without = values.get("--without") ?? [];
  const kind = caseOf(one("--case"), env.list.length + without.length > 0);
  if (typeof kind === "object" && kind !== null) return kind;
  const counts = countsOf(one("--timeout"), one("--repeat"));
  if ("usage" in counts) return counts;
  const red = redErrorsOf(values.get("--red-error"));
  if ("usage" in red) return red;
  return {
    files,
    base,
    case: kind,
    json,
    env: env.list,
    without,
    homeKeep: values.get("--home-keep") ?? [],
    with: values.get("--with") ?? [],
    ...red,
    ...counts,
  };
}

/** Row 023-22: `--red-error`'s texts, present only when given; an empty text would accept any failure. */
function redErrorsOf(
  given: readonly string[] | undefined,
): { redErrors?: readonly string[] } | ProofUsage {
  if (given === undefined) return {};
  return given.includes("") ? { usage: "--red-error needs a text" } : { redErrors: given };
}

/** `--case`: one of D5's three; `dependency` only with a condition. */
function caseOf(kind: string | undefined, conditioned: boolean): ProofCase | null | ProofUsage {
  if (kind === undefined) return null;
  if (kind !== "source" && kind !== "test" && kind !== "dependency")
    return { usage: "--case takes source, dependency or test" };
  if (kind === "dependency" && !conditioned)
    return { usage: "--case dependency needs a condition: --env NAME=[value] or --without <path>" };
  return kind;
}

const WHOLE = /^[1-9][0-9]*$/;

/** `--timeout` (whole seconds) and `--repeat` (1 to `MAX_REPEAT`), each with its default. */
function countsOf(
  timeout: string | undefined,
  repeat: string | undefined,
): { timeoutSeconds: number; repeat: number } | ProofUsage {
  if (timeout !== undefined && !WHOLE.test(timeout))
    return { usage: "--timeout takes whole seconds above 0" };
  if (repeat !== undefined && !(WHOLE.test(repeat) && Number(repeat) <= MAX_REPEAT))
    return { usage: `--repeat takes a whole number from 1 to ${MAX_REPEAT}` };
  return {
    timeoutSeconds: timeout === undefined ? PROOF_TIMEOUT_SECONDS : Number(timeout),
    repeat: repeat === undefined ? 1 : Number(repeat),
  };
}

/** Each `--env NAME=[value]`: an empty value unsets `NAME`. */
function envOf(given: readonly string[]): { list: EnvCondition[] } | ProofUsage {
  const list: EnvCondition[] = [];
  for (const word of given) {
    const at = word.indexOf("=");
    const name = at < 0 ? word : word.slice(0, at);
    if (at < 0 || !NAME.test(name))
      return { usage: `--env takes NAME=value, or NAME= to unset it; not "${word}"` };
    if (list.some((e) => e.name === name)) return { usage: `--env ${name} is given twice` };
    const value = word.slice(at + 1);
    list.push({ name, value: value === "" ? null : value });
  }
  return { list };
}
