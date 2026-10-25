import { compare } from "../../../../src/core/fs/index.js";
import { listingPath } from "../../../../src/core/keys/index.js";
import { describeFailure } from "../../../../src/core/state/fingerprint.js";
import type {
  CheckError,
  FocusedFile,
  RelativePath,
  RunnerAdapter,
  RunReport,
  TestFileRef,
} from "../../../../src/core/types/index.js";

/*
 * What a run's report stores (011 C14, rows 011-41 and 011-48), as the
 * adapter kinds compare it: the files it completed and withheld, each
 * result's identity, outcome and fingerprint, the files that failed to load
 * with theirs, as `recordsForFile` stores them (review of cand/0.1.232, B1).
 * The pytest and node:test kinds also read here what the adapter decides
 * before a run (`decided`) and what the core withholds after one
 * (`storedRun`, row 016-17).
 */

export const sortedRefs = (refs: readonly TestFileRef[] = []) =>
  refs.map((ref) => `${ref.project}:${ref.path}`).sort();

/** A file-level error's fingerprint as `recordsForFile` stores it: at its first error's location. */
const loadFingerprint = (errors: readonly CheckError[]) =>
  describeFailure(errors, errors[0]?.location ?? null).fingerprint;

const byText =
  <T>(text: (v: T) => string) =>
  (a: T, b: T) =>
    text(a) < text(b) ? -1 : text(a) > text(b) ? 1 : 0;

/** What a run's report stores, as a decision reads it: a fingerprint is compared through `sameFingerprint`. */
export function storedOf(report: RunReport) {
  return {
    completed: sortedRefs(report.completedFiles),
    withheld: sortedRefs(report.withheld),
    results: report.results
      .map((r) => ({
        check: JSON.stringify(r.check),
        outcome: r.outcome,
        fingerprint:
          r.outcome === "fail" ? describeFailure(r.errors, r.location).fingerprint : null,
      }))
      .sort(byText((r) => r.check)),
    loadErrors: report.fileErrors
      .map((e) => ({
        file: `${e.testFile.project}:${e.testFile.path}`,
        fingerprint: loadFingerprint(e.errors),
      }))
      .sort(byText((e) => e.file)),
  };
}

/**
 * Of a focused run (`RunOptions.checks`, row 011-144), at both trees, the
 * results of the checks its texts select: a tree that does not focus runs
 * the file whole, so the comparison asks whether the selected checks'
 * outcomes agree. The text rule is literal, as `holdsCheckText`, which an
 * older tree lacks.
 */
export function selectedOf(
  report: RunReport,
  checks: readonly FocusedFile[] | undefined,
): RunReport {
  if (checks === undefined) return report;
  const results = report.results.filter(({ check }) => {
    const texts = checks
      .filter((c) => c.testFile.project === check.project && c.testFile.path === check.testPath)
      .flatMap((c) => c.texts);
    return texts.length === 0 || texts.some((text) => check.fullName.includes(text));
  });
  return { ...report, results };
}

/**
 * What the core keeps of a case's runs and keys with (016 D4): per test
 * file, the paths observed beyond its closure and the paths a process it
 * started imported (`direct`); per project, the start-up paths. In a
 * fixture git ignores nothing, so the core drops none. A tree before D4
 * kept them in the adapter, whose answers hold them.
 */
export class Kept {
  readonly #observed = new Map<string, Set<RelativePath>>();
  readonly #direct = new Map<string, Set<RelativePath>>();
  readonly #startup = new Map<string, Set<RelativePath>>();

  /** Keeps what `report` observed. */
  add(report: RunReport): void {
    const into = (
      map: Map<string, Set<RelativePath>>,
      key: string,
      paths: readonly RelativePath[],
    ) => map.set(key, new Set([...(map.get(key) ?? []), ...paths]));
    for (const o of report.observed ?? []) {
      into(this.#observed, o.testFile.path, [...o.paths, ...o.directories.map(listingPath)]);
      into(this.#direct, o.testFile.path, o.direct ?? []);
    }
    for (const e of report.environmentObserved ?? []) into(this.#startup, e.project, e.paths);
  }

  /** `paths` with what the core keeps for `key` of `map`, sorted. */
  #with(map: "observed" | "direct" | "startup", key: string, paths: readonly RelativePath[]) {
    const kept = { observed: this.#observed, direct: this.#direct, startup: this.#startup }[map];
    return [...new Set([...paths, ...(kept.get(key) ?? [])])].sort(compare);
  }

  closure(path: string, paths: readonly RelativePath[]): RelativePath[] {
    return this.#with("observed", path, paths);
  }

  environment(project: string, files: readonly RelativePath[]): RelativePath[] {
    return this.#with("startup", project, files);
  }

  /** Whether a process `path` started imported `changed`, which makes it a direct importer. */
  marks(path: string, changed: RelativePath): boolean {
    return this.#direct.get(path)?.has(changed) ?? false;
  }
}

/**
 * What the adapter, and the core with what it `kept`, decide before a row
 * is stored, at one point of a case (the pytest and node:test kinds): each
 * environment, the listed test files, each file's closure and static
 * checks, and what a path's edit reaches.
 */
export async function decided(
  adapter: RunnerAdapter,
  affected: readonly RelativePath[],
  kept: Kept = new Kept(),
) {
  // `observedLoads` is no hash input but the core's gate on what it keeps (016 D4, O8): a tree
  // before it kept the module loads in the adapter, so both read alike.
  const environments = (await adapter.environment()).map(
    ({ packages: _, observedLoads: __, ...e }) => ({
      ...e,
      files: kept.environment(e.project, e.files),
    }),
  );
  const files = await adapter.testFiles();
  const closures: Record<string, readonly string[]> = {};
  const checks: Record<string, unknown> = {};
  for (const file of files) {
    closures[file.path] = kept.closure(file.path, (await adapter.closure(file)).paths);
    checks[file.path] = (await adapter.enumerate(file)).map((c) => ({
      check: JSON.stringify(c.check),
      location: c.location,
    }));
  }
  const reached: Record<string, unknown> = {};
  for (const path of affected) {
    const { direct, transitive } = await adapter.affected([path]);
    // 016 D4: the core's keys reach a file whose kept closure holds `path`, a direct
    // importer when a process it started imported it (`observedDirectOf`). A file the
    // adapter no longer lists is in no ledger, so the scheduler drops it.
    const reaching = files.filter((f) => closures[f.path]?.includes(path));
    const first = new Set(sortedRefs(direct));
    const listed = new Set(sortedRefs(files));
    const all = new Set(
      sortedRefs([...direct, ...transitive, ...reaching]).filter((id) => listed.has(id)),
    );
    const isDirect = (id: string) =>
      first.has(id) || kept.marks(id.slice(id.indexOf(":") + 1), path);
    reached[path] = {
      direct: [...all].filter(isDirect),
      transitive: [...all].filter((id) => !isDirect(id)),
    };
  }
  return { environments, files: sortedRefs(files), closures, checks, affected: reached };
}

export type Decided = Awaited<ReturnType<typeof decided>>;

/**
 * A run's report as stored: a completed file whose closure and environment
 * files, as keyed before the run, lack a path the run loaded at start-up
 * is withheld (`RunReport.environmentObserved`).
 */
export function storedRun(report: RunReport, before: Decided) {
  const stored = storedOf(report);
  const loaded = (report.environmentObserved ?? []).flatMap((e) => e.paths);
  const environment = before.environments.flatMap((e) => e.files);
  const lacks = (file: TestFileRef) => {
    const keyed = new Set([...(before.closures[file.path] ?? []), ...environment]);
    return loaded.some((path) => !keyed.has(path));
  };
  const grown = new Set(sortedRefs(report.completedFiles.filter(lacks)));
  return {
    ...stored,
    completed: stored.completed.filter((file) => !grown.has(file)),
    withheld: [...new Set([...stored.withheld, ...grown])].sort(),
    skipped: sortedRefs((report.skippedFiles ?? []).map((s) => s.testFile)),
  };
}
