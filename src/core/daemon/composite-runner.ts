import { compare } from "../fs/index.js";
import type { ProjectName, RunEnd, RunnerAdapter, RunReport, TestFileRef } from "../types/index.js";
import { Flights, withheld } from "./composite-flights.js";
import type { RunnerSet } from "./runner-set.js";

/**
 * Several runners behind one `RunnerAdapter`. Spec 003 D7: "`testFiles()`
 * and `environment()` concatenate, `affected()` and `invalidate()` fan out
 * and merge, `run()` dispatches by project, `close()` closes each.
 * `RunnerAdapter` is unchanged." `lane()` names a file's runner by its
 * adapter's name, so a tier of one runner runs beside another runner's
 * (001 D5 as amended, task 001-140); adapters of one name share a lane.
 * `releaseLane` goes to every adapter, and `run` passes its options,
 * the lane among them, to each part (task 004-18).
 *
 * Each project belongs to the adapter that lists it in `testFiles()` or
 * `environment()`; a project two adapters list is an error, since a check id
 * names its project and not its runner. A call that one adapter rejects
 * rejects as a whole, as a single runner's would, except `run`: there a
 * rejection is that adapter's part crashing, and the other parts keep their
 * results.
 *
 * The members are `adapters` and those of `sets`, read live (011 C10,
 * *Projects at a reload*, row 011-78): `invalidate` reconciles each set
 * first and reports every project it removed, added or replaced as
 * recreated, so the scheduler reads the environments and the listing
 * again and forgets a removed project's files. A removed member's part in
 * flight is stopped as `squeal stop` stops one, a replaced member's
 * finishes, and each is closed once its parts end. A part of either not
 * started yet is withheld: its files queue again for the reload's listing.
 */
export function createCompositeRunner(
  adapters: readonly RunnerAdapter[],
  sets: readonly RunnerSet[] = [],
): RunnerAdapter {
  const all = () => [...adapters, ...sets.flatMap((set) => set.members())];
  // The sets change only at a reconcile below, so the members are read again only then.
  let members: readonly RunnerAdapter[] = all();
  const owners = new Map<ProjectName, RunnerAdapter>();
  const flights = new Flights();

  const own = (adapter: RunnerAdapter, projects: Iterable<ProjectName>): void => {
    for (const project of projects) {
      const owner = owners.get(project);
      if (owner !== undefined && owner !== adapter) {
        throw new Error(
          `project ${JSON.stringify(project)} is reported by both ${owner.name} and ${adapter.name}; rename one`,
        );
      }
      owners.set(project, adapter);
    }
  };

  /** Brings every set in line with the configuration: its projects, sorted. */
  const reconcile = (): ProjectName[] => {
    if (sets.length === 0) return [];
    const changes = sets.map((set) => set.reconcile());
    members = all();
    for (const { removed, replaced } of changes) {
      for (const runner of removed) flights.stop(runner);
      // Every set's leavers go before any listing owns their names again: a swap is no conflict.
      for (const runner of [...removed, ...replaced]) {
        for (const [project, owner] of owners) if (owner === runner) owners.delete(project);
        flights.retire(runner);
      }
    }
    return changes.flatMap((change) => change.projects);
  };

  /** Results of one call to every adapter, each paired with the adapter it came from. */
  const each = <T>(call: (adapter: RunnerAdapter) => Promise<T>) =>
    Promise.all(members.map(async (adapter) => ({ adapter, value: await call(adapter) })));

  const environment = async () => {
    const parts = await each((adapter) => adapter.environment());
    for (const { adapter, value } of parts)
      own(
        adapter,
        value.map((e) => e.project),
      );
    return parts.flatMap((part) => part.value);
  };

  const ownerOf = async (testFile: TestFileRef): Promise<RunnerAdapter> => {
    if (!owners.has(testFile.project)) await environment();
    const owner = owners.get(testFile.project);
    if (owner === undefined) {
      throw new Error(
        `no runner owns project ${JSON.stringify(testFile.project)} (${testFile.path})`,
      );
    }
    return owner;
  };

  return {
    get name() {
      return members.map((adapter) => adapter.name).join("+");
    },
    get adapterVersion() {
      return members.map((adapter) => adapter.adapterVersion).join("+");
    },
    async invalidate(paths) {
      const reconciled = reconcile();
      const parts = await Promise.all(members.map((adapter) => adapter.invalidate(paths)));
      const projects = new Set([...reconciled, ...parts.flatMap((part) => part.recreatedProjects)]);
      return { recreatedProjects: [...projects].sort(compare) };
    },
    async recheck() {
      const parts = await Promise.all(
        members.map((adapter) => adapter.recheck?.() ?? { recreatedProjects: [] }),
      );
      const projects = new Set(parts.flatMap((part) => part.recreatedProjects));
      return { recreatedProjects: [...projects].sort(compare) };
    },
    async affected(changedPaths) {
      const parts = await Promise.all(members.map((adapter) => adapter.affected(changedPaths)));
      return {
        direct: parts.flatMap((part) => part.direct).sort(compareRefs),
        transitive: parts.flatMap((part) => part.transitive).sort(compareRefs),
      };
    },
    // A project no adapter listed yet has the composite's lane: its run fails on its own.
    lane: (testFile) => owners.get(testFile.project)?.name ?? members.map((a) => a.name).join("+"),
    closure: async (testFile) => (await ownerOf(testFile)).closure(testFile),
    enumerate: async (testFile) => (await ownerOf(testFile)).enumerate(testFile),
    async testFiles() {
      const parts = await each((adapter) => adapter.testFiles());
      for (const { adapter, value } of parts)
        own(
          adapter,
          value.map((f) => f.project),
        );
      return parts.flatMap((part) => part.value);
    },
    omittedTestFiles: () =>
      members.reduce((sum, adapter) => sum + (adapter.omittedTestFiles?.() ?? 0), 0),
    environment,
    // The parts run one after another: a slow tier starts only the first file's owner's (004 D2).
    slowWidth(testFiles) {
      const owner = testFiles[0] === undefined ? undefined : owners.get(testFiles[0].project);
      if (owner === undefined) return testFiles.length;
      const end = testFiles.findIndex((f) => owners.get(f.project) !== owner);
      const own = end === -1 ? testFiles : testFiles.slice(0, end);
      return owner.slowWidth?.(own) ?? own.length;
    },
    // A backlog tier holds one lane, so one owner's files (task 001-366).
    tierWidth: (testFile, grant) =>
      owners.get(testFile.project)?.tierWidth?.(testFile, grant) ?? grant,
    // `run` below runs the owners one after another (review wave-3 B1).
    tierPart(testFile) {
      const owner = owners.get(testFile.project);
      if (owner === undefined) return "";
      return `${members.indexOf(owner)}:${owner.tierPart?.(testFile) ?? ""}`;
    },
    besideBacklog: (testFile) => owners.get(testFile.project)?.besideBacklog?.(testFile) ?? false,
    backlogSlot: (testFile) => owners.get(testFile.project)?.backlogSlot?.(testFile) ?? null,
    async run(testFiles, options) {
      // Grouped in one synchronous pass once every owner is known: no reload lands between files.
      if (testFiles.some((f) => !owners.has(f.project))) await environment();
      const groups = new Map<RunnerAdapter, TestFileRef[]>();
      for (const testFile of testFiles) {
        const owner = owners.get(testFile.project) ?? (await ownerOf(testFile));
        groups.set(owner, [...(groups.get(owner) ?? []), testFile]);
      }
      // Spec 001 D11: "Runs go one at a time", so the parts do too, in adapter order.
      const order = [...members, ...[...groups.keys()].filter((a) => !members.includes(a))];
      const parts: Part[] = [];
      for (const adapter of order) {
        const files = groups.get(adapter);
        // A `squeal stop` starts no further part: its files stay queued (D10, task 001-367).
        if (files === undefined || options.stop?.aborted === true) continue;
        // 011 C10: a reload's leaver starts no part, and a removed one's part reports nothing.
        if (flights.left(adapter)) parts.push({ adapter, report: withheld(files, 0) });
        else parts.push({ adapter, report: await flights.run(adapter, files, options) });
      }
      return merge(parts);
    },
    // Each adapter knows its own lanes (a slow instance, task 004-18); the others ignore it.
    async releaseLane(lane) {
      await Promise.all(members.map((adapter) => adapter.releaseLane?.(lane)));
    },
    async close() {
      const closed = await Promise.allSettled([
        ...members.map((adapter) => adapter.close()),
        flights.close(),
      ]);
      const failed = closed.find((result) => result.status === "rejected");
      if (failed !== undefined) throw failed.reason;
    },
  };
}

interface Part {
  readonly adapter: RunnerAdapter;
  readonly report: RunReport;
}

const SEVERITY: Readonly<Record<RunEnd, number>> = { completed: 0, "timed-out": 1, crashed: 2 };

/**
 * One report from the parts. The end is the worst part's, so the run is
 * recorded as it went wrong; files stay trusted per part, because a crashed
 * part lists no completed files and a completed one does not depend on it.
 */
function merge(parts: readonly Part[]): RunReport {
  const reports = parts.map((part) => part.report);
  const end = reports.reduce<RunEnd>(
    (worst, report) => (SEVERITY[report.end] > SEVERITY[worst] ? report.end : worst),
    "completed",
  );
  const failures = parts.flatMap(({ adapter, report }) =>
    report.failure === null ? [] : [`${adapter.name}: ${report.failure}`],
  );
  const timed = reports.some((report) => report.fileDurations !== undefined);
  const observed = reports.some((report) => report.observed !== undefined);
  const read = reports.some((report) => report.reads !== undefined);
  const environment = reports.flatMap((report) => report.environmentObserved ?? []);
  const skipped = reports.flatMap((report) => report.skippedFiles ?? []);
  const withheld = reports.flatMap((report) => report.withheld ?? []);
  // Task 001-382: one adapter runs Vitest, so at most one part failed to start.
  const startup = reports.find((report) => report.startupFailure !== undefined)?.startupFailure;
  const started = [...new Set(reports.flatMap((report) => report.startedProjects ?? []))];
  return {
    end,
    durationMs: reports.reduce((sum, report) => sum + report.durationMs, 0),
    completedFiles: reports.flatMap((report) => report.completedFiles),
    results: reports.flatMap((report) => report.results),
    fileErrors: reports.flatMap((report) => report.fileErrors),
    failure: failures.length === 0 ? null : failures.join("; "),
    ...(timed ? { fileDurations: reports.flatMap((report) => report.fileDurations ?? []) } : {}),
    ...(observed ? { observed: reports.flatMap((report) => report.observed ?? []) } : {}),
    ...(read ? { reads: reports.flatMap((report) => report.reads ?? []) } : {}),
    ...(environment.length > 0 ? { environmentObserved: environment } : {}),
    ...(skipped.length > 0 ? { skippedFiles: skipped } : {}),
    ...(withheld.length > 0 ? { withheld } : {}),
    ...(startup === undefined ? {} : { startupFailure: startup }),
    ...(started.length === 0 ? {} : { startedProjects: started.sort(compare) }),
  };
}

function compareRefs(a: TestFileRef, b: TestFileRef): number {
  return a.project === b.project ? compare(a.path, b.path) : compare(a.project, b.project);
}
