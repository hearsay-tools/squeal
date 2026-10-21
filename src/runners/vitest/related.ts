import type { TestSpecification, Vitest } from "vitest/node";
import type { AbsolutePath } from "../../core/types/index.js";

/** The part of Vitest's private `specifications` the walk calls. */
interface Specifications {
  filterTestsBySource(specs: TestSpecification[]): Promise<TestSpecification[]>;
}

/**
 * Vitest's `--related` walk over `listed`: those that transitively import one
 * of `changed`. Transforms test files without executing them.
 *
 * The only place that touches `config.related` and
 * `specifications.filterTestsBySource()`. They back the documented
 * `--related` CLI flag but are not documented API themselves (spec 001 open
 * question 4); if they change, this file changes.
 *
 * Walks only `listed`, never Vitest's whole include (013 V7 as amended,
 * 011-82 row B): a test file Squeal excludes is loaded into the instance
 * only when a listed file imports it, so its edits during a run withhold
 * nothing.
 *
 * Rejects when a test file fails to transform; the caller falls back to its
 * own walk. Rejects too when a run ended during the walk (task 001-150: the
 * walk overlaps a run): each run resets `config.related` as it ends, and a
 * walk that reads it reset answers every test file.
 */
export async function relatedSpecifications(
  vitest: Vitest,
  listed: readonly TestSpecification[],
  changed: readonly AbsolutePath[],
): Promise<TestSpecification[]> {
  if (changed.length === 0) return [];
  const related = [...changed];
  vitest.config.related = related;
  try {
    const specifications = (vitest as unknown as { specifications: Specifications }).specifications;
    const specs = await specifications.filterTestsBySource([...listed]);
    if (vitest.config.related !== related) {
      throw new Error("vitest adapter: a run ended during the related walk and reset it");
    }
    return specs;
  } finally {
    // Vitest checks `config.related` for presence; exactOptionalPropertyTypes forbids assigning undefined.
    if (vitest.config.related === related) delete vitest.config.related;
  }
}
