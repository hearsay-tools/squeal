import { compare } from "../fs/index.js";
import type {
  ProjectName,
  RunEnd,
  RunnerAdapter,
  RunOptions,
  RunReport,
  TestFileRef,
} from "../types/index.js";

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
 */
export function createCompositeRunner(adapters: readonly RunnerAdapter[]): RunnerAdapter {
  const owners = new Map<ProjectName, RunnerAdapter>();

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

  /** Results of one call to every adapter, each paired with the adapter it came from. */
  const each = <T>(call: (adapter: RunnerAdapter) => Promise<T>) =>
    Promise.all(adapters.map(async (adapter) => ({ adapter, value: await call(adapter) })));

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
    name: adapters.map((adapter) => adapter.name).join("+"),
    adapterVersion: adapters.map((adapter) => adapter.adapterVersion).join("+"),
    async invalidate(paths) {
      const parts = await Promise.all(adapters.map((adapter) => adapter.invalidate(paths)));
      const projects = new Set(parts.flatMap((part) => part.recreatedProjects));
      return { recreatedProjects: [...projects].sort(compare) };
    },
    async affected(changedPaths) {
      const parts = await Promise.all(adapters.map((adapter) => adapter.affected(changedPaths)));
      return {
        direct: parts.flatMap((part) => part.direct).sort(compareRefs),
        transitive: parts.flatMap((part) => part.transitive).sort(compareRefs),
      };
    },
    // A project no adapter listed yet has the composite's lane: its run fails on its own.
    lane: (testFile) => owners.get(testFile.project)?.name ?? adapters.map((a) => a.name).join("+"),
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
    environment,
    async run(testFiles, options) {
      const groups = new Map<RunnerAdapter, TestFileRef[]>();
      for (const testFile of testFiles) {
        const owner = await ownerOf(testFile);
        groups.set(owner, [...(groups.get(owner) ?? []), testFile]);
      }
      // Spec 001 D11: "Runs go one at a time", so the parts do too, in adapter order.
      const parts: Part[] = [];
      for (const adapter of adapters) {
        const files = groups.get(adapter);
        if (files === undefined) continue;
        parts.push({ adapter, report: await runPart(adapter, files, options) });
      }
      return merge(parts);
    },
    // Each adapter knows its own lanes (a slow instance, task 004-18); the others ignore it.
    async releaseLane(lane) {
      await Promise.all(adapters.map((adapter) => adapter.releaseLane?.(lane)));
    },
    async close() {
      const closed = await Promise.allSettled(adapters.map((adapter) => adapter.close()));
      const failed = closed.find((result) => result.status === "rejected");
      if (failed !== undefined) throw failed.reason;
    },
  };
}

interface Part {
  readonly adapter: RunnerAdapter;
  readonly report: RunReport;
}

/** One adapter's part of a run. A rejection is a crash of that part only (001 D12). */
async function runPart(
  adapter: RunnerAdapter,
  testFiles: readonly TestFileRef[],
  options: RunOptions,
): Promise<RunReport> {
  const started = Date.now();
  try {
    return await adapter.run(testFiles, options);
  } catch (error) {
    return {
      end: "crashed",
      durationMs: Date.now() - started,
      completedFiles: [],
      results: [],
      fileErrors: [],
      failure: error instanceof Error ? error.message : String(error),
    };
  }
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
  const environment = reports.flatMap((report) => report.environmentObserved ?? []);
  return {
    end,
    durationMs: reports.reduce((sum, report) => sum + report.durationMs, 0),
    completedFiles: reports.flatMap((report) => report.completedFiles),
    results: reports.flatMap((report) => report.results),
    fileErrors: reports.flatMap((report) => report.fileErrors),
    failure: failures.length === 0 ? null : failures.join("; "),
    ...(timed ? { fileDurations: reports.flatMap((report) => report.fileDurations ?? []) } : {}),
    ...(observed ? { observed: reports.flatMap((report) => report.observed ?? []) } : {}),
    ...(environment.length > 0 ? { environmentObserved: environment } : {}),
  };
}

function compareRefs(a: TestFileRef, b: TestFileRef): number {
  return a.project === b.project ? compare(a.path, b.path) : compare(a.project, b.project);
}
