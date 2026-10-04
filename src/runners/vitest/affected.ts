import { existsSync } from "node:fs";
import type { TestSpecification, Vitest } from "vitest/node";
import type { AbsolutePath } from "../../core/types/index.js";
import { importClosure, isMissingTarget } from "./graph.js";
import { isProjectInput, projectInputs, snapshotPath } from "./project.js";
import { relatedSpecifications } from "./related.js";

/**
 * Test files affected by `changed`.
 *
 * Spec 001 D4: "the `related` walk [...]. Squeal adds what Vitest's walk
 * misses: all test files of a project when a setup file, its closure,
 * `globalSetup`, or the config changed; the owning test file when a `.snap`
 * changed." One more miss found while building this: Vitest's walk drops
 * edges to files that no longer exist, so importers of a deleted file are
 * added from our own walk.
 */
export async function affectedTestFiles(
  vitest: Vitest,
  specs: readonly TestSpecification[],
  changed: readonly AbsolutePath[],
): Promise<TestSpecification[]> {
  if (changed.length === 0) return [];
  const known = new Map(specs.map((s) => [specKey(s), s]));
  const affected = new Map<string, TestSpecification>();
  const add = (spec: TestSpecification) => {
    const current = known.get(specKey(spec));
    if (current) affected.set(specKey(spec), current);
  };

  let related: readonly TestSpecification[];
  try {
    related = await relatedSpecifications(vitest, changed);
  } catch {
    // Vitest's walk rejects when any test file fails to transform (a syntax
    // error mid-edit). Our walk skips such files, so it answers instead.
    related = await walkRelated(specs, changed);
  }
  related.forEach(add);

  const gone = changed.filter((p) => !existsSync(p));
  const snapshots = changed.filter((p) => p.endsWith(".snap"));
  for (const project of vitest.projects) {
    const projectSpecs = specs.filter((s) => s.project === project);
    const inputs = await projectInputs(vitest, project);
    if (changed.some((p) => isProjectInput(inputs, p))) {
      projectSpecs.forEach(add);
      continue;
    }
    for (const spec of projectSpecs) {
      if (snapshots.includes(snapshotPath(project, spec.moduleId))) add(spec);
    }
    if (gone.length === 0) continue;
    for (const spec of projectSpecs) {
      const closure = await importClosure(project, [spec.moduleId]);
      if (gone.some((p) => isMissingTarget(closure, p))) add(spec);
    }
  }
  return [...affected.values()];
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
