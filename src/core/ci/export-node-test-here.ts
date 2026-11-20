import { projectEnv } from "../../runners/node-test/recorders.js";
import { tokenizeNodeOptions } from "../../runners/process/node-options.js";
import { compare } from "../fs/compare.js";
import type { WorktreeKeys } from "../scheduler/keying.js";
import type { AbsolutePath, ProjectName, RelativePath } from "../types/common.js";
import type { Policy } from "../types/policy.js";
import type { RunnerAdapter, RunnerEnvironment } from "../types/runner.js";
import type { NamedPart } from "./export-check.js";
import type { NodeTestAssignment, NodeTestEntryHere } from "./export-node-test.js";
import { hereOf, uncertifiedWhy } from "./inputs.js";

/*
 * Spec 018 D26 (row 018-48): what `ci export` reads of the node:test
 * entries in its own checkout, and the start-up paths their recorded
 * processes loaded (016 D4). Each entry is read from the adapter a daemon
 * builds for it: its `cwd`, its Node's probe (`runnerVersion`, the config's
 * `nodeBuild`, D18) and the files it lists; its `argv` and `env` from the
 * checkout's `squeal.config.json`. The start-up paths a part's processes
 * loaded before their test file (`PartNodeTest.preloads`) join the entry's
 * environment as a daemon's run joins them (`RunReport.environmentObserved`,
 * `seeStartup`), so a preload that loads by a computed specifier keys as in
 * a daemon-made export; each needs its part's read evidence (D9), or the
 * entry's files are left out.
 */

/** The `runnerVersion` of a node:test environment whose Node does not run (`NODE_UNAVAILABLE`). */
const UNAVAILABLE = "unavailable";

/** Each node:test adapter's entry as this checkout has it; an entry `policy.nodeTest` does not name is not read. */
export async function nodeTestEntries(
  adapters: readonly RunnerAdapter[],
  policy: Policy,
  env: NodeJS.ProcessEnv,
): Promise<NodeTestEntryHere[]> {
  const entries: NodeTestEntryHere[] = [];
  for (const adapter of adapters) {
    if (adapter.name !== "node-test") continue;
    const [environment] = await adapter.environment();
    const entry = policy.nodeTest.find((project) => project.name === environment?.project);
    if (environment === undefined || entry === undefined) continue;
    const listed = await adapter.testFiles();
    entries.push({
      name: entry.name,
      cwd: environment.root ?? "",
      argv: entry.argv,
      // B1: as the adapter reads them (`nodeOptionsOf`), from this job's env.
      nodeOptions: tokenizeNodeOptions(projectEnv(entry, env).NODE_OPTIONS ?? "") ?? [],
      env: entry.env,
      node: nodeOf(environment),
      files: new Set(listed.filter((f) => f.project === entry.name).map((f) => f.path)),
    });
  }
  return entries;
}

function nodeOf(environment: RunnerEnvironment): NodeTestEntryHere["node"] {
  if (environment.runnerVersion === UNAVAILABLE) return null;
  const { nodeBuild } = JSON.parse(environment.resolvedConfig) as { nodeBuild?: unknown };
  if (typeof nodeBuild !== "string") return null;
  return { version: environment.runnerVersion, nodeBuild };
}

/**
 * Adds to `keys` the start-up paths the processes of each entry in
 * `assignment` loaded, then reads `environments` again with them, as a
 * daemon's record does. An entry with a start-up path a part of it holds no
 * evidence of, or other content of, is left out: its files leave the
 * returned parts and are counted, with a line.
 */
export async function withStartup(
  root: AbsolutePath,
  keys: WorktreeKeys,
  environments: readonly RunnerEnvironment[],
  assignment: NodeTestAssignment,
): Promise<NodeTestAssignment> {
  const loaded = new Map<ProjectName, Set<RelativePath>>();
  for (const { part } of assignment.parts) {
    for (const project of projectsOf(part)) {
      const paths = loaded.get(project) ?? new Set<RelativePath>();
      for (const path of part.header.nodeTest?.preloads ?? []) paths.add(path);
      loaded.set(project, paths);
    }
  }
  if ([...loaded.values()].every((paths) => paths.size === 0)) return assignment;
  for (const [project, paths] of loaded) keys.seeStartup(project, [...paths].sort(compare));
  await keys.setEnvironments(environments);
  const here = hereOf(root, (path) => keys.cache.hashOf(path));
  const refused = new Map<ProjectName, string>();
  for (const { file, part } of assignment.parts) {
    const preloads = part.header.nodeTest?.preloads ?? [];
    const [first] = uncertifiedWhy(preloads, part.evidence, here);
    if (first === undefined) continue;
    for (const project of projectsOf(part)) {
      refused.set(
        project,
        `project ${JSON.stringify(project)}: its node:test processes loaded ${first.path} before their test files, and ${file} holds no evidence of its content here`,
      );
    }
  }
  if (refused.size === 0) return assignment;
  const left = (part: NamedPart) => part.part.testFiles.filter((f) => refused.has(f.project));
  const count = (project: ProjectName) =>
    assignment.parts.flatMap(left).filter((f) => f.project === project).length;
  const lines = [...refused]
    .sort(([a], [b]) => compare(a, b))
    .map(([project, why]) => `${why}: left out (${filesText(count(project))})`);
  const parts = assignment.parts.flatMap((named) => {
    const testFiles = named.part.testFiles.filter((f) => !refused.has(f.project));
    return testFiles.length === 0 ? [] : [{ ...named, part: { ...named.part, testFiles } }];
  });
  return {
    parts,
    leftOut: assignment.leftOut + assignment.parts.flatMap(left).length,
    lines: [...assignment.lines, ...lines],
  };
}

function projectsOf(part: NamedPart["part"]): ProjectName[] {
  return [...new Set(part.testFiles.map((f) => f.project))];
}

function filesText(count: number): string {
  return `${count} test file${count === 1 ? "" : "s"}`;
}
