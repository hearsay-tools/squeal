import { compare } from "../fs/compare.js";
import type { ProjectName } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { RunnerAdapter, RunReport } from "../types/runner.js";
import { declareTraits } from "../types/runner-traits.js";
import { Flights, withheld } from "./composite-flights.js";
import { MERGE_RULES, type Part } from "./report-merge.js";
import type { RunnerSet } from "./runner-set.js";

/**
 * Several runners behind one `RunnerAdapter`. Spec 003 D7: "`testFiles()`
 * and `environment()` concatenate, `affected()` and `invalidate()` fan out
 * and merge, `run()` dispatches by project, `close()` closes each.
 * `RunnerAdapter` is unchanged." Its traits are each file's owner's, but
 * its lane names a file's runner by its adapter's name, so a tier of one
 * runner runs beside another runner's (001 D5 as amended, task 001-140);
 * adapters of one name share a lane.
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

  /** The traits of the runner that owns `testFile`'s project; none listed it yet: undefined. */
  const of = (testFile: TestFileRef) => owners.get(testFile.project)?.traits;
  // Each answer is the owner's, so a project no member owns yet gets the defaults (`declareTraits`).
  const traits = declareTraits({
    omittedTestFiles: () =>
      members.reduce((sum, adapter) => sum + adapter.traits.omittedTestFiles(), 0),
    // The parts run one after another: a slow tier starts only the first file's owner's (004 D2).
    slowWidth(testFiles) {
      const owner = testFiles[0] === undefined ? undefined : owners.get(testFiles[0].project);
      const end = testFiles.findIndex((f) => owners.get(f.project) !== owner);
      return owner?.traits.slowWidth(end === -1 ? testFiles : testFiles.slice(0, end));
    },
    // A backlog tier holds one lane, so one owner's files (task 001-366).
    tierWidth: (testFile, grant) => of(testFile)?.tierWidth(testFile, grant),
    // `run` below runs the owners one after another (review wave-3 B1).
    tierPart(testFile) {
      const owner = owners.get(testFile.project);
      if (owner === undefined) return undefined;
      return `${members.indexOf(owner)}:${owner.traits.tierPart(testFile)}`;
    },
    besideBacklog: (testFile) => of(testFile)?.besideBacklog(testFile),
    backlogSlot: (testFile) => of(testFile)?.backlogSlot(testFile),
    // Row 011-145: a focused tier goes only to a file whose owner honours `RunOptions.checks`.
    focuses: (testFile) => of(testFile)?.focuses(testFile),
    // A project no adapter listed yet has the composite's lane: its run fails on its own.
    lane: (testFile) => owners.get(testFile.project)?.name ?? members.map((a) => a.name).join("+"),
  });

  return {
    get name() {
      return members.map((adapter) => adapter.name).join("+");
    },
    get adapterVersion() {
      return members.map((adapter) => adapter.adapterVersion).join("+");
    },
    traits,
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

/**
 * One report from the parts, by the report merge's rule for each field
 * (`MERGE_RULES`, `report-merge.ts`); a rule's `undefined` leaves its
 * field absent. The keys come in the rules' order.
 */
export function merge(parts: readonly Part[]): RunReport {
  const fields = Object.entries(MERGE_RULES)
    .map(([field, rule]) => [field, rule(parts)] as const)
    .filter(([, value]) => value !== undefined);
  // Sound: `MergeRules` has a rule for every field, each answering its field's
  // type, and `undefined` only for an optional field, which stays absent.
  return Object.fromEntries(fields) as unknown as RunReport;
}

function compareRefs(a: TestFileRef, b: TestFileRef): number {
  return a.project === b.project ? compare(a.path, b.path) : compare(a.project, b.project);
}
