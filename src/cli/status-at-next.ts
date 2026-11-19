import { type KeyedFile, resolveCommit, type WhileOpen } from "../core/commit/at-keys-checkout.js";
import { readHead } from "../core/daemon-loop/head.js";
import { testFileId } from "../core/keys/reverse-index.js";
import { shellWord } from "../core/text.js";
import type { AbsolutePath } from "../core/types/common.js";
import { storedDurations } from "./code-gate-durations.js";
import { estimateOf } from "./status-at-run-batches.js";
import { diffSelected, noResult, refuse } from "./status-at-run-select.js";

/*
 * Row 023-24 (lessons round 3, Q1 and Q2): the next step `status --at`
 * names. Q1: no session of 25 found `--run`, so a report with files that
 * have no result at the commit ends with the command that runs them and
 * its size, from the same selection `--run` makes (D4.5, D4.9) and D17.1's
 * estimate when the stores hold durations. Q2: every session also ran
 * `--at HEAD` as the "after" side; with a clean tree and no `--run` that
 * compares HEAD with itself, so the command keys nothing and names the
 * parent instead.
 */

/** One command the report names, with the files it runs and D17.1's estimate. */
export interface NextRun {
  readonly command: string;
  readonly files: number;
  /** Whole seconds; `null` when no file has a stored duration. */
  readonly seconds: number | null;
}

/**
 * Q1: `--run` for the files with no result the diff selects, `--all-missing`
 * when it runs more than that; absent from the report when neither runs a file.
 */
export interface AtNext {
  readonly run: NextRun | null;
  readonly allMissing: NextRun | null;
}

export interface NextInput {
  readonly root: AbsolutePath;
  /** The commit, resolved, and as the user gave it, with the paths (for the command). */
  readonly commit: string;
  readonly given: string;
  readonly paths: readonly string[];
}

/** Q1: the selection `--run` would make, read while the keyer's adapters are open; then the step. */
export function nextProbe(input: NextInput): {
  readonly whileOpen: WhileOpen;
  next(): AtNext | null;
} {
  let all: readonly KeyedFile[] = [];
  let selected: readonly KeyedFile[] = [];
  const whileOpen: WhileOpen = async (open, keyed) => {
    const missing = keyed.filter(noResult);
    // Nothing to run: no need to ask the runners what the diff affects.
    if (missing.length === 0) return;
    all = (await refuse({ ...input, tree: open.tree }, keyed, missing)).run;
    const chosen = await diffSelected(input, open);
    selected = all.filter((f) => chosen.has(testFileId(f.ref)));
  };
  const next = (): AtNext | null => {
    if (all.length === 0) return null;
    const durations = storedDurations(input.root);
    try {
      const of = durations?.of ?? (() => null);
      const step = (files: readonly KeyedFile[], allMissing: boolean): NextRun => ({
        command: commandOf(input, allMissing),
        files: files.length,
        seconds: estimateOf(files, of).seconds,
      });
      return {
        run: selected.length === 0 ? null : step(selected, false),
        allMissing: all.length > selected.length ? step(all, true) : null,
      };
    } finally {
      durations?.close();
    }
  };
  return { whileOpen, next };
}

function commandOf(input: NextInput, allMissing: boolean): string {
  const words = ["squeal status --at", shellWord(input.given), ...input.paths.map(shellWord)];
  return [...words, "--run", ...(allMissing ? ["--all-missing"] : [])].join(" ");
}

const filesText = (n: number) => `${n} file${n === 1 ? "" : "s"}`;
const estimate = (step: NextRun) => (step.seconds === null ? "" : ` (estimate ${step.seconds} s)`);

/** Q1: the report's last line; `null` with no step. */
export function nextLine(next: AtNext | undefined, at: string): string | null {
  if (next === undefined) return null;
  const { run, allMissing } = next;
  const all =
    allMissing === null
      ? ""
      : `\`${allMissing.command}\` runs ${allMissing.files === 1 ? "the 1 file" : `all ${allMissing.files} files`}${estimate(allMissing)}`;
  if (run === null)
    return allMissing === null
      ? null
      : `The change since ${at} selects no file with no result there; ${all}.`;
  const runs = `\`${run.command}\` runs the ${filesText(run.files)} with no result there`;
  if (allMissing === null) return `${runs}${estimate(run)}.`;
  return `${runs} that the change since ${at} selects${estimate(run)}; ${all}.`;
}

/** Q1: the next step, when the checkout gave the commit's own keys; `{}` otherwise. */
export function nextOf(
  probe: ReturnType<typeof nextProbe> | null,
  at: { readonly failure: string | null; readonly changed: unknown },
): { next?: AtNext } {
  if (probe === null || at.failure !== null || at.changed !== null) return {};
  const next = probe.next();
  return next === null ? {} : { next };
}

/**
 * Q2: the refusal when `--at` names HEAD and the tree is clean (git
 * status: tracked changes and untracked files; ignored files are not
 * counted), so the call would compare HEAD with itself; `null` when the
 * command goes on. The caller asks only without `--run`.
 */
export async function headRefusal(
  root: AbsolutePath,
  commit: string,
  args: { readonly commit: string; readonly paths: readonly string[] },
): Promise<string | null> {
  const head = await readHead(root);
  if (head.head !== commit || head.dirty) return null;
  const what = `${args.commit} is HEAD, your working tree's commit, and the tree is clean`;
  const hasParent = await resolveCommit(root, `${commit}~1`).then(
    () => true,
    () => false,
  );
  if (!hasParent) return `${what}; HEAD has no parent, so there is nothing to compare`;
  const command = ["squeal status --at HEAD~1", ...args.paths.map(shellWord)].join(" ");
  return `${what}: compare with its parent, \`${command}\``;
}
