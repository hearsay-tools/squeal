import { existsSync } from "node:fs";
import type { TestSpecification, Vitest } from "vitest/node";
import type { AbsolutePath } from "../../core/types/index.js";
import { directImports, importClosure, isMissingTarget } from "./graph.js";
import { isProjectInput, projectInputs, snapshotPath } from "./project.js";
import { relatedSpecifications } from "./related.js";

/** Affected test specifications, split as `AffectedTestFiles` (D5 step 4). */
export interface AffectedSpecifications {
  readonly direct: TestSpecification[];
  readonly transitive: TestSpecification[];
}

/**
 * Test files affected by `changed`.
 *
 * Spec 001 D4: "the `related` walk [...]. Squeal adds what Vitest's walk
 * misses: all test files of a project when a setup file, its closure,
 * `globalSetup`, or the config changed; the owning test file when a `.snap`
 * changed." One more miss found while building this: Vitest's walk drops
 * edges to files that no longer exist, so importers of a deleted file are
 * added from our own walk.
 *
 * Spec 001 D5 step 4: a file is `direct` when it changed itself, owns a
 * changed snapshot, or imports a changed path in one hop; the transforms are
 * cached by the walk, so the hop costs a lookup. A file reached only through
 * the environment (config, setup files) is `transitive`.
 */
export async function affectedTestFiles(
  vitest: Vitest,
  specs: readonly TestSpecification[],
  changed: readonly AbsolutePath[],
): Promise<AffectedSpecifications> {
  if (changed.length === 0) return { direct: [], transitive: [] };
  const known = new Map(specs.map((s) => [specKey(s), s]));
  const affected = new Map<string, TestSpecification>();
  /** Reached through the module graph or a snapshot: candidates for `direct`. */
  const imported = new Set<string>();
  const direct = new Set<string>();
  const add = (spec: TestSpecification, through: "graph" | "snapshot" | "environment") => {
    const current = known.get(specKey(spec));
    if (!current) return;
    affected.set(specKey(spec), current);
    if (through === "graph") imported.add(specKey(spec));
    if (through === "snapshot") direct.add(specKey(spec));
  };

  let related: readonly TestSpecification[];
  try {
    related = await relatedSpecifications(vitest, changed);
  } catch {
    // Vitest's walk rejects when any test file fails to transform (a syntax
    // error mid-edit). Our walk skips such files, so it answers instead.
    related = await walkRelated(specs, changed);
  }
  for (const spec of related) add(spec, "graph");

  const gone = changed.filter((p) => !existsSync(p));
  const snapshots = changed.filter((p) => p.endsWith(".snap"));
  for (const project of vitest.projects) {
    const projectSpecs = specs.filter((s) => s.project === project);
    const inputs = await projectInputs(vitest, project);
    if (changed.some((p) => isProjectInput(inputs, p))) {
      for (const spec of projectSpecs) add(spec, "environment");
    }
    for (const spec of projectSpecs) {
      if (snapshots.includes(snapshotPath(project, spec.moduleId))) add(spec, "snapshot");
    }
    if (gone.length === 0) continue;
    for (const spec of projectSpecs) {
      const closure = await importClosure(project, [spec.moduleId]);
      if (gone.some((p) => isMissingTarget(closure, p))) add(spec, "graph");
    }
  }

  for (const id of imported) {
    const spec = affected.get(id);
    if (!spec || direct.has(id)) continue;
    if (changed.includes(spec.moduleId)) {
      direct.add(id);
      continue;
    }
    const imports = await directImports(spec.project, spec.moduleId);
    if (changed.some((p) => imports.files.has(p) || isMissingTarget(imports, p))) direct.add(id);
  }
  const result: AffectedSpecifications = { direct: [], transitive: [] };
  for (const [id, spec] of affected)
    (direct.has(id) ? result.direct : result.transitive).push(spec);
  return result;
}

async function walkRelated(
  specs: readonly TestSpecification[],
  changed: readonly AbsolutePath[],
): Promise<TestSpecification[]> {
  const hits: TestSpecification[] = [];
  for (const spec of specs) {
    const closure = await importClosure(spec.project, [spec.moduleId]);
    if (changed.some((p) => closure.files.has(p) || isMissingTarget(closure, p))) hits.push(spec);
  }
  return hits;
}

const specKey = (spec: TestSpecification) => `${spec.project.name}\0${spec.moduleId}`;
