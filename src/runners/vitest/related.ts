import type { TestSpecification, Vitest } from "vitest/node";
import type { AbsolutePath } from "../../core/types/index.js";

/**
 * Vitest's `--related` walk: test specifications that transitively import one
 * of `changed`. Transforms test files without executing them.
 *
 * The only place that touches `config.related` and
 * `getRelevantTestSpecifications()`. Both back the documented `--related` CLI
 * flag but are not documented API themselves (spec 001 open question 4); if
 * they change, this file changes.
 *
 * Rejects when a test file fails to transform; the caller falls back to its
 * own walk.
 */
export async function relatedSpecifications(
  vitest: Vitest,
  changed: readonly AbsolutePath[],
): Promise<TestSpecification[]> {
  if (changed.length === 0) return [];
  vitest.config.related = [...changed];
  try {
    return await vitest.getRelevantTestSpecifications();
  } finally {
    // Vitest checks `config.related` for presence; exactOptionalPropertyTypes forbids assigning undefined.
    delete vitest.config.related;
  }
}
