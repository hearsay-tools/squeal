import { compare } from "../fs/compare.js";
import {
  type Difference,
  type EnvironmentDescriptor,
  importDifferences,
} from "../keys/environment-descriptor.js";
import { KEY_FORMAT_VERSION } from "../keys/key-format.js";
import type { ProjectName } from "../types/common.js";
import type { Part, PartProject } from "./parts.js";

/*
 * Spec 018 D9 (row 018-17): the parts `squeal ci export` refuses, each with
 * a named reason. One export holds one commit's passes in one environment
 * per project, so every part must come from that commit, have completed, and
 * hold each test file once, and the parts must be every shard of one run
 * (2026-11-09, review of 0.1.421 B3).
 */

/** Why a set of parts makes no export. */
export type RefusalKind =
  | "key-format"
  | "incomplete"
  | "no-commit"
  | "commits"
  | "checkout"
  | "shards"
  | "snapshot"
  | "duplicate"
  | "environment";

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
 * the project's command does not (`adapter.ts`, `#start`): `includeTaskLocation`,
 * and `snapshotOptions.updateSnapshot` (`update: "none"`), which a part
 * holds apart (`updateSnapshot`, refused unless `none`). The other snapshot
 * options are compared field by field (`RunView.snapshotOptions`; review of
 * 0.1.421 B2). A part's descriptor is the run's, so these differ from the
 * job's by design (018-16 notes).
 */
const SQUEAL_FIELDS: readonly string[] = ["includeTaskLocation", "snapshotOptions"];

/**
 * The first reason `parts` make no export at `head`, the commit of the
 * checkout the job runs in; `null` when they make one. The environment of
 * the job itself is checked once it is read (`runDifferences`).
 */
export function partsRefusal(parts: readonly NamedPart[], head: string | null): Refusal | null {
  for (const { file, part } of parts) {
    const { keyFormat, end, commit } = part.header;
    if (keyFormat !== KEY_FORMAT_VERSION) {
      const text = `${file} was made with key format ${keyFormat}; this Squeal keys with ${KEY_FORMAT_VERSION}`;
      return { kind: "key-format", text };
    }
    if (end !== "completed") {
      return { kind: "incomplete", text: `${file} is of a run that did not complete (${end})` };
    }
    if (commit === null) return { kind: "no-commit", text: `${file} names no commit` };
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
  return (
    shardRefusal(parts) ??
    snapshotRefusal(parts) ??
    duplicateRefusal(parts) ??
    environmentRefusal(parts)
  );
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

/** A part whose run could write snapshots: its passes may be of snapshots it wrote (D9). */
function snapshotRefusal(parts: readonly NamedPart[]): Refusal | null {
  for (const { file, part } of parts) {
    for (const { descriptor, updateSnapshot } of part.projects) {
      if (updateSnapshot === "none") continue;
      const text = `${file} ran project ${JSON.stringify(descriptor.project)} with snapshot update "${updateSnapshot}"; only runs that write no snapshot ("none", as in CI) are exported`;
      return { kind: "snapshot", text };
    }
  }
  return null;
}

/** A test file two parts hold: the shards overlapped, so neither result is the one. */
function duplicateRefusal(parts: readonly NamedPart[]): Refusal | null {
  const seen = new Map<string, string>();
  for (const { file, part } of parts) {
    for (const testFile of part.testFiles) {
      const id = `${testFile.project}\0${testFile.path}`;
      const other = seen.get(id);
      if (other !== undefined) {
        const name = `${testFile.project === "" ? "" : `${testFile.project}:`}${testFile.path}`;
        return {
          kind: "duplicate",
          text: `test file ${name} is in two parts: ${other} and ${file}`,
        };
      }
      seen.set(id, file);
    }
  }
  return null;
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
 * job's environment, so it must be the shards' too.
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

/** The refusal of a project whose shards' environment is not the job's. */
export function jobRefusal(project: ProjectName, differences: readonly Difference[]): Refusal {
  const text = `the shards ran project ${JSON.stringify(project)} in another environment than this job's: ${texts(differences)} (the export as the shards', here as this job's)`;
  return { kind: "environment", text };
}

function texts(differences: readonly Difference[]): string {
  return differences.map((d) => d.text).join("; ");
}
