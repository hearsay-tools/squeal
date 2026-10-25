import type { CodeFile, FileCount } from "../../types/code.js";
import type { CheckKey, RevisionNumber } from "../../types/index.js";
import type { StepCache } from "./cache.js";
import { coverageOf, type FileCondition, type ReadyLoader } from "./file.js";
import { evidenceOf, type Judged, judgeFiles, priorKey } from "./judge.js";
import type { Loaders } from "./loaders.js";
import type { CoverageStepInput } from "./step.js";
import {
  type CoverageSummary,
  type FileSummary,
  functionKey,
  readEvidence,
  writeEvidence,
} from "./summary.js";

/**
 * The judged files a step writes together, within its budget (row 015-47):
 * after a recount every ready file is judged again, and writing a step's
 * judgements after its budget took 136 to 246 ms at load 66 to 69.
 */
export const WRITE_FILES = 16;

export interface Walk {
  readonly input: CoverageStepInput;
  readonly cache: StepCache;
  readonly loaders: Loaders;
  readonly summary: CoverageSummary | null;
  readonly start: boolean;
  readonly countOf: (file: CodeFile) => FileCount | null;
  readonly work: () => boolean;
  /** The files git changed, with the last revision it did (`broughtByGit`). */
  readonly brought: ReadonlyMap<string, RevisionNumber>;
}

/**
 * Each file's summary, and the ready files judged and written within the
 * step's budget, `WRITE_FILES` at a time; a file past it keeps its last
 * summary, and `more` is set. A file not ready is judged early, for the
 * failures its records in hand prove pass (row 015-57).
 */
export function walk(at: Walk, files: readonly CodeFile[]) {
  const { input, cache, loaders, summary, start, work } = at;
  const next: Record<string, FileSummary> = {};
  const judged = batched(input, at.brought);
  // B2 (review 0.1.297): a recount's files stay quiet until each is judged, records waited for too.
  const quiet = new Set(input.reseed ? files.map((f) => f.path) : (summary?.quiet ?? []));
  const keys = (ready: readonly ReadyLoader[]) => ready.map((l) => l.key);
  const record = (key: CheckKey) => cache.record(input.store.coverage, key);
  let more = false;
  const early = (file: CodeFile, ready: readonly ReadyLoader[], kept: Unready) => {
    const judgedEarly = judgeEarly({ at, judged, quiet }, file, ready, kept);
    more ||= judgedEarly === null;
    next[file.path] = judgedEarly ?? kept;
  };
  for (const file of files) {
    const before = summary?.files[file.path];
    // A file's condition and signature from the map are a unit too (row 015-45).
    if (!work()) {
      more = true;
      if (before !== undefined) next[file.path] = before;
      continue;
    }
    const condition = cache.condition(file.path, loaders);
    if (condition.state !== "ready") {
      early(file, condition.ready, summaryOf(file, condition));
      continue;
    }
    const signature = cache.signature(file, input.threshold, condition.loaders);
    const recounted = quiet.has(file.path);
    if (!start && !recounted && before?.state === "judged" && before.signature === signature) {
      next[file.path] = before;
      continue;
    }
    if (!cache.decode(input.store.coverage, keys(condition.loaders), work) || !work()) {
      more = true;
      if (before !== undefined) next[file.path] = before;
      continue;
    }
    const count = at.countOf(file);
    if (count === null) continue;
    const coverage = coverageOf(file, count.functions, condition.loaders, record);
    if (coverage === "unread") {
      early(file, condition.loaders, { state: "unknown", blob: file.blob, cause: "unread" });
      continue;
    }
    next[file.path] = { state: "judged", blob: file.blob, signature };
    judged.add({ file, count, coverage, ...(recounted ? { quiet: true } : {}) });
    quiet.delete(file.path);
    cache.judged(file.path);
  }
  return { next, ...judged.end(), quiet, more };
}

type Unready = Exclude<FileSummary, { state: "judged" }>;

/**
 * Row 015-57 (D9, A pass proven early): a file not ready with a failure,
 * judged from its ready loaders' records for the failures they prove pass,
 * once for each set of them; its summary, or `null` when its reads are
 * past the budget. It stays in `quiet` until it is judged with every record.
 */
function judgeEarly(
  w: { readonly at: Walk; readonly judged: Batched; readonly quiet: ReadonlySet<string> },
  file: CodeFile,
  ready: readonly ReadyLoader[],
  kept: Unready,
): Unready | null {
  if (ready.length === 0) return kept;
  const { input, cache, start, work } = w.at;
  const failing = cache.failing(file, () => hasFailure(input, file.path), work);
  if (failing !== true) return failing === null ? null : kept;
  const signature = cache.signature(file, input.threshold, ready, true);
  const before = w.at.summary?.files[file.path];
  const judgedAt = before?.state !== "judged" && before?.blob === file.blob ? before.early : null;
  if (!start && judgedAt === signature) return { ...kept, early: signature };
  const { coverage: records } = input.store;
  const keys = ready.map((l) => l.key);
  if (!cache.decode(records, keys, work) || !work()) return null;
  const count = w.at.countOf(file);
  if (count === null) return kept;
  const record = (key: CheckKey) => cache.record(records, key);
  const coverage = coverageOf(file, count.functions, ready, record, true);
  if (coverage === "unread") return kept;
  const quiet = w.quiet.has(file.path) ? { quiet: true as const } : {};
  w.judged.add({ file, count, coverage, early: true, ...quiet });
  // It may pass every failure the file had.
  cache.judged(file.path);
  return { ...kept, early: signature };
}

type Batched = ReturnType<typeof batched>;

const hasFailure = ({ store, worktreeId }: CoverageStepInput, path: string) =>
  store.states
    .list(worktreeId, { paths: [path], outcome: "fail" })
    .some((s) => s.measure !== "complexity");

/** Judgements written `WRITE_FILES` at a time as they come, and the rest at `end`. */
function batched(input: CoverageStepInput, brought: ReadonlyMap<string, RevisionNumber>) {
  const judged: Judged[] = [];
  let written = 0;
  let transitions = 0;
  const write = () => {
    written += judged.length;
    transitions += writeJudgement(input, judged.splice(0), brought);
  };
  return {
    add(j: Judged): void {
      judged.push(j);
      if (judged.length === WRITE_FILES) write();
    },
    /** The files judged, and the transitions their states made. */
    end(): { judged: number; transitions: number } {
      write();
      return { judged: written, transitions };
    },
  };
}

/**
 * Judges `judged`, and writes the states, the transitions, D6's edits
 * (row 015-40) and the evidence; the number of transitions. An own edit
 * that git changed the file after (`brought`) is not the body judged, so it
 * marks none (review 0.1.299 B1).
 */
function writeJudgement(
  input: CoverageStepInput,
  judged: readonly Judged[],
  brought: ReadonlyMap<string, RevisionNumber>,
): number {
  const { store, worktreeId } = input;
  const paths = judged.map((j) => j.file.path);
  if (paths.length === 0) return 0;
  const prior = new Map(store.states.list(worktreeId, { paths }).map((s) => [priorKey(s), s]));
  const edits = new Map(
    store.states
      .edits(worktreeId, "complexity", paths)
      .filter((e) => e.revision > (brought.get(e.check.path) ?? -1))
      .map((e) => [`${e.check.path}\0${functionKey(e.check)}`, e]),
  );
  const { revision, threshold } = input;
  const { states, transitions, edited } = judgeFiles(
    { worktreeId, revision, threshold, at: input.now(), prior, edits },
    judged,
  );
  store.states.upsertMany(states);
  store.transitions.append(transitions);
  // D6's first edit to a standing failure, for these measures too.
  store.states.markEdited(worktreeId, edited);
  for (const j of judged) {
    const { path } = j.file;
    if (j.early !== true) {
      writeEvidence(store.meta, worktreeId, path, evidenceOf(j));
      continue;
    }
    // Row 015-57: an early judgement's evidence, for the functions it judged.
    const only = new Set(
      states.filter((s) => s.check.path === path).map((s) => functionKey(s.check)),
    );
    if (only.size === 0) continue;
    const before = readEvidence(store.meta, worktreeId, path);
    writeEvidence(store.meta, worktreeId, path, evidenceOf(j, only, before));
  }
  return transitions.length;
}

function summaryOf(file: CodeFile, condition: Exclude<FileCondition, { state: "ready" }>) {
  return condition.state === "pending"
    ? {
        state: "pending" as const,
        blob: file.blob,
        reason: condition.reason,
        waiting: condition.waiting,
      }
    : { state: "unknown" as const, blob: file.blob, cause: condition.cause };
}
