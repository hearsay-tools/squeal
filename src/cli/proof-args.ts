import type { ProofCase } from "../core/proof/sides.js";

/*
 * Spec 023 D1, D5 (row 023-08): `squeal proof`'s arguments. Row 023-11's
 * conditions and repeat (`--env`, `--without`, `--repeat`, `--case
 * dependency`) are parsed and refused as not built yet.
 */

/** The default budget, the checkouts and installs included, as D4.6's. */
export const PROOF_TIMEOUT_SECONDS = 600;

export interface ProofArgs {
  /** The named test files as given, from the cwd. */
  readonly files: readonly string[];
  readonly base: string;
  /** `null`: D5's default from the diff and the closure. */
  readonly case: ProofCase | null;
  readonly timeoutSeconds: number;
  readonly json: boolean;
}

/** A usage problem: `notBuilt` for row 023-11's options, told in one line. */
export type ProofUsage = { readonly usage: string } | { readonly notBuilt: string };

const VALUED = ["--base", "--case", "--timeout", "--env", "--without", "--repeat"] as const;
type Valued = (typeof VALUED)[number];

/** Row 023-11's options: what each does once built. */
const LATER: Partial<Record<Valued, string>> = {
  "--env": "--env (a variable set or unset on both sides)",
  "--without": "--without (a file or folder hidden on both sides)",
  "--repeat": "--repeat (the red side run up to n times)",
};

const notBuilt = (what: string): ProofUsage => ({
  notBuilt: `${what} is row 023-11's behaviour and is not built yet`,
});

export function parseProof(args: readonly string[]): ProofArgs | ProofUsage {
  const values = new Map<Valued, string>();
  const files: string[] = [];
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    const name = VALUED.find((v) => arg === v || arg.startsWith(`${v}=`));
    if (name !== undefined) {
      const later = LATER[name];
      if (later !== undefined) return notBuilt(later);
      const inline = arg.length > name.length;
      const value = inline ? arg.slice(name.length + 1) : args[i + 1];
      if (value === undefined || (!inline && value.startsWith("--")))
        return { usage: `${name} needs a value` };
      if (values.has(name)) return { usage: `${name} is given twice` };
      values.set(name, value);
      if (!inline) i++;
    } else if (arg === "--json") json = true;
    else if (arg.startsWith("--")) return { usage: `unknown option "${arg}"` };
    else files.push(arg);
  }
  const base = values.get("--base");
  if (base === undefined || base === "") return { usage: "--base needs a commit" };
  if (files.length === 0) return { usage: "name at least one test file" };
  const kind = values.get("--case");
  if (kind === "dependency")
    return notBuilt("--case dependency (old and new test under a condition)");
  if (kind !== undefined && kind !== "source" && kind !== "test")
    return { usage: "--case takes source, dependency or test" };
  const timeout = values.get("--timeout");
  if (timeout !== undefined && !/^[1-9][0-9]*$/.test(timeout))
    return { usage: "--timeout takes whole seconds above 0" };
  return {
    files,
    base,
    case: kind ?? null,
    timeoutSeconds: timeout === undefined ? PROOF_TIMEOUT_SECONDS : Number(timeout),
    json,
  };
}
