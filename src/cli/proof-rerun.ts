import type { Conditions } from "../core/proof/conditions.js";
import { stops } from "../core/proof/imports.js";
import { shellWord } from "../core/text.js";
import type { RelativePath } from "../core/types/common.js";
import { PROOF_TIMEOUT_SECONDS, type ProofArgs } from "./proof-args.js";
import type { ProofFile } from "./proof-report.js";

/*
 * Spec 023 D5 (rows 023-11, 023-21): the commands a proof's report tells
 * the agent to run next. Row 023-11: 020's rerun line for runs the budget
 * left not started, with a longer `--timeout`. Row 023-21 (D5.2, issue
 * #247, then "A: stop when unsure"): the same command with `--with` or
 * `--source` for each changed import of an unchanged named test that the
 * proof did not settle.
 */

/** How much longer than this call's budget a rerun's `--timeout` is. */
const RERUN_FACTOR = 2;

/** 020's rerun line for a proof: this call's own arguments with a longer `--timeout`. */
export function rerunCommand(args: ProofArgs, conditions: Conditions): string {
  const seconds = Math.max(60, Math.ceil((RERUN_FACTOR * args.timeoutSeconds) / 60) * 60);
  const given = { with: args.with ?? [], source: args.source ?? [] };
  return [...commandWords(args, conditions, given), "--timeout", String(seconds)].join(" ");
}

/**
 * Row 023-21: this call's own command plus `--with` and `--source` for
 * each of `more`'s paths (from the cwd) it does not give yet; `--timeout`
 * only when it is not the default.
 */
export function withRerunCommand(
  args: ProofArgs,
  conditions: Conditions,
  more: { readonly with: readonly string[]; readonly source: readonly string[] },
): string {
  const add = (given: readonly string[], extra: readonly string[]) => [
    ...given,
    ...extra.filter((path) => !given.includes(path)),
  ];
  const paths = {
    with: add(args.with ?? [], more.with),
    source: add(args.source ?? [], more.source),
  };
  const timeout =
    args.timeoutSeconds === PROOF_TIMEOUT_SECONDS ? [] : ["--timeout", String(args.timeoutSeconds)];
  return [...commandWords(args, conditions, paths), ...timeout].join(" ");
}

function commandWords(
  args: ProofArgs,
  conditions: Conditions,
  paths: { readonly with: readonly string[]; readonly source: readonly string[] },
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
    ...((args.repeat ?? 1) > 1 ? ["--repeat", String(args.repeat)] : []),
    ...paths.with.map((path) => `--with ${shellWord(path)}`),
    ...paths.source.map((path) => `--source ${shellWord(path)}`),
    ...(args.redErrors ?? []).map((text) => `--red-error ${shellWord(text)}`),
  ];
}

/**
 * Row 023-21 (D5.2, "A: stop when unsure"): the two reruns a stop names.
 * `with`: every unsettled changed import as test code. `source`: the ones
 * not shown to be test code as product code, the test code still with
 * `--with`; `null` when every one is test code. Paths are from the cwd.
 */
export function stopReruns(
  files: readonly ProofFile[],
  args: ProofArgs,
  conditions: Conditions,
  fromCwd: (path: RelativePath) => string,
): { readonly withRerun: string | null; readonly sourceRerun: string | null } {
  const unsettled = new Map<RelativePath, boolean>();
  for (const file of files)
    for (const u of stops(file.imports) ? (file.imports?.unsettled ?? []) : [])
      unsettled.set(u.path, (unsettled.get(u.path) ?? false) || u.testCode);
  if (unsettled.size === 0) return { withRerun: null, sourceRerun: null };
  const paths = [...unsettled.keys()].sort();
  const test = paths.filter((path) => unsettled.get(path) === true).map(fromCwd);
  const other = paths.filter((path) => unsettled.get(path) !== true).map(fromCwd);
  return {
    withRerun: withRerunCommand(args, conditions, { with: paths.map(fromCwd), source: [] }),
    sourceRerun:
      other.length === 0 ? null : withRerunCommand(args, conditions, { with: test, source: other }),
  };
}
