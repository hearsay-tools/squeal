import type { Conditions } from "../core/proof/conditions.js";
import { shellWord } from "../core/text.js";
import { PROOF_TIMEOUT_SECONDS, type ProofArgs } from "./proof-args.js";

/*
 * Spec 023 D5 (rows 023-11, 023-21): the commands a proof's report tells
 * the agent to run next. Row 023-11: 020's rerun line for runs the budget
 * left not started, with a longer `--timeout`. Row 023-21 (D5.2, issue
 * #247): the same command with `--with` for each changed helper of an
 * unchanged named test.
 */

/** How much longer than this call's budget a rerun's `--timeout` is. */
const RERUN_FACTOR = 2;

/** 020's rerun line for a proof: this call's own arguments with a longer `--timeout`. */
export function rerunCommand(args: ProofArgs, conditions: Conditions): string {
  const seconds = Math.max(60, Math.ceil((RERUN_FACTOR * args.timeoutSeconds) / 60) * 60);
  return [...commandWords(args, conditions, args.with ?? []), "--timeout", String(seconds)].join(
    " ",
  );
}

/**
 * Row 023-21: this call's own command plus `--with <path>` for each of
 * `helpers` (paths from the cwd) it does not give yet; `--timeout` only
 * when it is not the default.
 */
export function withRerunCommand(
  args: ProofArgs,
  conditions: Conditions,
  helpers: readonly string[],
): string {
  const given = args.with ?? [];
  const withPaths = [...given, ...helpers.filter((path) => !given.includes(path))];
  const timeout =
    args.timeoutSeconds === PROOF_TIMEOUT_SECONDS ? [] : ["--timeout", String(args.timeoutSeconds)];
  return [...commandWords(args, conditions, withPaths), ...timeout].join(" ");
}

function commandWords(
  args: ProofArgs,
  conditions: Conditions,
  withPaths: readonly string[],
): string[] {
  return [
    "squeal proof",
    ...args.files.map(shellWord),
    "--base",
    shellWord(args.base),
    ...(args.case === null ? [] : ["--case", args.case]),
    ...conditions.env.map((e) => `--env ${shellWord(`${e.name}=${e.value ?? ""}`)}`),
    ...conditions.without.map((w) => `--without ${shellWord(w.given)}`),
    ...conditions.keep.map((k) => `--home-keep ${shellWord(k.given)}`),
    ...withPaths.map((path) => `--with ${shellWord(path)}`),
    ...((args.repeat ?? 1) > 1 ? ["--repeat", String(args.repeat)] : []),
    ...(args.redErrors ?? []).map((text) => `--red-error ${shellWord(text)}`),
  ];
}
