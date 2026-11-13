import { compare } from "../fs/compare.js";
import {
  type Difference,
  type EnvironmentDescriptor,
  importDifferences,
} from "../keys/environment-descriptor.js";
import { KEY_FORMAT_VERSION } from "../keys/key-format.js";
import type { ProjectName } from "../types/common.js";
import type { Part, PartProject } from "./parts.js";
import { firstShared } from "./reuse.js";

/*
 * Spec 018 D9 (row 018-17): the parts `squeal ci export` refuses, each with
 * a named reason. One export holds one commit's passes in one environment
 * per project, so every part must come from that commit, have completed, and
 * hold each test file once, and the parts must be every shard of one run
 * (2026-11-09, review of 0.1.421 B3).
 *
 * Whether one part's run of a project is evidence somewhere else has one
 * owner, `reuseRefusal`, which `squeal code --base --parts` applies too
 * (020 D13.2; the human, 2026-11-10, after review 0.1.427-r2 B1). A new
 * refusal of one run goes there, so that both commands make it. Whether a
 * part gives one test file, and which parts hold it, is `FileReuse`'s
 * (`reuse.ts`, row 020-52), which asks `reuseRefusal` of the file's run.
 */

/** Why one part's run of a project is no evidence elsewhere: the kinds `reuseRefusal` gives. */
export type RunRefusalKind = "key-format" | "incomplete" | "snapshot" | "environment";

/**
 * Why a set of parts makes no export: a run that is no evidence, or parts
 * that are not every shard of one run of this checkout's commit.
 */
export type RefusalKind =
  | RunRefusalKind
  | "no-commit"
  | "commits"
  | "checkout"
  | "shards"
  | "duplicate";

export interface Refusal {
  readonly kind: RefusalKind;
  /** One line for a person, naming the parts by their files. */
  readonly text: string;
}

/** A part and the file it was read from, which the refusals name. */
export interface NamedPart {
  readonly file: string;
  readonly part: Part;
}

/** What the comparisons read of a project's run: its descriptor and its snapshot options by field. */
export type RunView = Pick<PartProject, "descriptor" | "snapshotOptions">;

/**
 * Resolved Vitest fields Squeal's own instance sets for itself and a run of
 * the project's command may not (`adapter.ts`, `#start`): `includeTaskLocation`,
 * which `ci record` sets as well since row 018-43 (a part of an earlier
 * Squeal at this key format has not), and
 * `snapshotOptions.updateSnapshot` (`update: "none"`), which a part
 * holds apart (`updateSnapshot`, which `reuseRefusal` refuses unless `none`
 * before it compares). The other snapshot options are compared field by
 * field (`RunView.snapshotOptions`; review of 0.1.421 B2). A part's
 * descriptor is the run's, so these differ from the job's by design (018-16
 * notes).
 */
const SQUEAL_FIELDS: readonly string[] = ["includeTaskLocation", "snapshotOptions"];

/**
 * The first reason `parts` make no export at `head`, the commit of the
 * checkout the job runs in; `null` when they make one. Each part's runs
 * are refused as `reuseRefusal` refuses them; their environment is compared
 * with the job's once it is read (`export.ts`).
 */
export function partsRefusal(parts: readonly NamedPart[], head: string | null): Refusal | null {
  for (const named of parts) {
    const refused = reuseRefusal(named);
    if (refused !== null) return refused;
    if (named.part.header.commit === null) {
      return { kind: "no-commit", text: `${named.file} names no commit` };
    }
  }
  const commits = [...new Set(parts.map((p) => p.part.header.commit as string))].sort(compare);
  if (commits.length > 1) {
    return {
      kind: "commits",
      text: `the parts come from different commits: ${commits.join(", ")}`,
    };
  }
  const [commit] = commits;
  if (commit !== undefined && commit !== head) {
    const here = head ?? "no commit";
    const text = `the parts are of commit ${commit}, and this checkout is at ${here}: run the export in a checkout of the parts' commit`;
    return { kind: "checkout", text };
  }
  return shardRefusal(parts) ?? duplicateRefusal(parts) ?? environmentRefusal(parts);
}

/** Where a part's run would be evidence: the runs there, as `reuseRefusal` names and compares them. */
export interface Place {
  /** The runs there, as a refusal names them: `this job's`. */
  readonly name: string;
  /** The runner there, as a refusal names it: `this checkout's Vitest`. */
  readonly runner: string;
  /** Each project's run there; a project it lacks has none. */
  readonly runs: ReadonlyMap<ProjectName, RunView>;
}

/**
 * The first reason `named`'s run of `project` is no evidence at `here`, or
 * `null` when it is: the one rule of `ci export` and `squeal code --base
 * --parts` (018 D9, D10; 020 D13.2). The run must be of this key format,
 * have completed, and have written no snapshot, so that no pass is of a
 * snapshot it wrote: `updateSnapshot` must be `none`, as in CI, which
 * `runDifferences` therefore leaves out. Its environment must be the run's
 * at `here` (`runDifferences`). Without `project`, every project the part
 * ran; without `here`, all but the comparison, which `partsRefusal` makes
 * before the job's runner is open.
 */
export function reuseRefusal(
  named: NamedPart,
  here?: Place,
  project?: ProjectName,
): RunRefusal | null {
  const { file, part } = named;
  const { keyFormat, end } = part.header;
  if (keyFormat !== KEY_FORMAT_VERSION) {
    const text = `${file} was made with key format ${keyFormat}; this Squeal keys with ${KEY_FORMAT_VERSION}`;
    return { kind: "key-format", text };
  }
  if (end !== "completed") {
    return { kind: "incomplete", text: `${file} is of a run that did not complete (${end})` };
  }
  const runs = part.projects.filter(
    (r) => project === undefined || r.descriptor.project === project,
  );
  if (project !== undefined && runs.length === 0) {
    const text = `${file} holds no environment of project ${JSON.stringify(project)}`;
    return { kind: "environment", text };
  }
  for (const run of runs) {
    const refused = runRefusal(file, run, here);
    if (refused !== null) return refused;
  }
  return null;
}

/**
 * Spec 020 D19.6 (D13.4 as amended 2026-11-12): whether a coverage provider,
 * the project's or Squeal's, may have run in `part`'s run, so that a test
 * that imports `node:inspector` could see its coverage. `ci export` then
 * leaves out each file whose closure imports it, besides the files the part
 * marks. Not when `ci record` added none to a run without coverage of its
 * own (`no-provider`), nor in a format 3 part, which says nothing of it.
 * The collector is read for nothing else here (D19.5).
 */
export function providerRan(part: Part): boolean {
  const { coverage } = part.header;
  return coverage !== undefined && !("off" in coverage && coverage.off === "no-provider");
}

/** A refusal `reuseRefusal` makes. */
export type RunRefusal = Refusal & { readonly kind: RunRefusalKind };

/** `reuseRefusal` of one project's run in the part `file`. */
function runRefusal(file: string, run: PartProject, here: Place | undefined): RunRefusal | null {
  const project = JSON.stringify(run.descriptor.project);
  if (run.updateSnapshot !== "none") {
    const text = `${file} ran project ${project} with snapshot update "${run.updateSnapshot}"; only a run that writes no snapshot ("none", as in CI) gives evidence`;
    return { kind: "snapshot", text };
  }
  if (here === undefined) return null;
  const there = here.runs.get(run.descriptor.project);
  if (there === undefined) {
    return {
      kind: "environment",
      text: `${here.runner} has no project ${project}, which ${file} ran`,
    };
  }
  const differences = runDifferences(run, there);
  if (differences.length === 0) return null;
  const text = `${file} ran project ${project} in another environment than ${here.name}: ${texts(differences)} (the export as ${file}'s, here as ${here.name})`;
  return { kind: "environment", text };
}

/**
 * Parts that are not each shard of one run once: shards of different
 * counts, a missing shard, or two parts of one shard (two Vitest processes
 * in one shard's command, or a shard run twice). The union of a partial set
 * would pass for the whole suite.
 */
function shardRefusal(parts: readonly NamedPart[]): Refusal | null {
  if (parts.length === 0) return { kind: "shards", text: "no part to export" };
  const counts = [...new Set(parts.map((p) => p.part.header.shard.count))].sort((a, b) => a - b);
  if (counts.length > 1) {
    return { kind: "shards", text: `the parts come from runs of ${counts.join(", ")} shards` };
  }
  const count = counts[0] as number;
  const byIndex = new Map<number, string[]>();
  for (const { file, part } of parts) {
    const { index } = part.header.shard;
    byIndex.set(index, [...(byIndex.get(index) ?? []), file]);
  }
  for (const [index, files] of [...byIndex].sort(([a], [b]) => a - b)) {
    if (index < 1 || index > count) {
      return { kind: "shards", text: `${files.join(", ")} names shard ${index}/${count}` };
    }
    if (files.length > 1) {
      const text = `shard ${index}/${count} has ${files.length} parts: ${files.join(", ")}; export takes one per shard`;
      return { kind: "shards", text };
    }
  }
  const missing = Array.from({ length: count }, (_, i) => i + 1).filter((i) => !byIndex.has(i));
  if (missing.length === 0) return null;
  const named = missing.map((i) => `${i}/${count}`).join(", ");
  const text = `no part of shard ${named}: export the parts of every shard, after all of them passed`;
  return { kind: "shards", text };
}

/**
 * A test file two parts hold: the shards overlapped, so neither result is
 * the one. The first such file refuses the whole set (`firstShared`); the
 * gate refuses only that file (`FileReuse.owner`).
 */
function duplicateRefusal(parts: readonly NamedPart[]): Refusal | null {
  const shared = firstShared(parts);
  if (shared === null) return null;
  const { project, path } = shared.file;
  const name = `${project === "" ? "" : `${project}:`}${path}`;
  const text = `test file ${name} is in two parts: ${shared.first} and ${shared.second}`;
  return { kind: "duplicate", text };
}

/** Two parts that ran one project in environments an imported pass may not share (D9, D10). */
function environmentRefusal(parts: readonly NamedPart[]): Refusal | null {
  const first = new Map<ProjectName, { file: string; run: RunView }>();
  for (const { file, part } of parts) {
    for (const run of part.projects) {
      const { descriptor } = run;
      const held = first.get(descriptor.project);
      if (held === undefined) {
        first.set(descriptor.project, { file, run });
        continue;
      }
      const differences = runDifferences(held.run, run);
      if (differences.length === 0) continue;
      const text = `${held.file} and ${file} ran project ${JSON.stringify(descriptor.project)} in different environments: ${texts(differences)} (the export as the first, here as the second)`;
      return { kind: "environment", text };
    }
  }
  return null;
}

/**
 * The parts runs `a` and `b` differ in beyond what an imported pass may
 * (D10) and what Squeal's instance sets for itself: `importDifferences` over
 * what a part's descriptor holds, neither files nor installed dependencies,
 * with each snapshot option but `updateSnapshot` as a config field of its
 * own, `snapshotOptions.<name>`. Between a shard's and the job's (as the
 * daemon computes it), a refusal when not empty: the export's keys hold the
 * job's environment, so it must be the shards' too. Alone it lets a run
 * that wrote snapshots pass: compare through `reuseRefusal` (review
 * 0.1.427-r2 B1).
 */
export function runDifferences(a: RunView, b: RunView): Difference[] {
  const comparable = ({ descriptor, snapshotOptions }: RunView): EnvironmentDescriptor => ({
    ...descriptor,
    installedDependencies: "",
    files: [],
    config: {
      ...Object.fromEntries(
        Object.entries(descriptor.config).filter(([name]) => !SQUEAL_FIELDS.includes(name)),
      ),
      ...Object.fromEntries(
        Object.entries(snapshotOptions).map(([name, hash]) => [`snapshotOptions.${name}`, hash]),
      ),
    },
  });
  return importDifferences(comparable(a), comparable(b));
}

function texts(differences: readonly Difference[]): string {
  return differences.map((d) => d.text).join("; ");
}
