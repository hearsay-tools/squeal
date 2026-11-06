import type { Keyer } from "./keyer.js";
import { environmentOf } from "./keys.js";
import { type LintCursor, lintScope, readInputs } from "./records.js";
import type { RekeyContext } from "./rekey.js";

/**
 * Row 017-29: whether the environment moved only by closure files a lint
 * call read first, after the cursor's keying (its inputs record, 019-21).
 * The worker's reads hold for its thread, and a part stores nothing when
 * its report names a closure file its keys lack (`lint-part.ts`), so a
 * check judged before such a read was linted by a thread that had not read
 * the file: its key stands. The keys made from now on hold the file, and
 * its later change moves the environment. A closure that lost a file, a
 * recorded input at other bytes, or a file read at a refresh (the config's
 * load, which can change computed configs) is no growth.
 */
export function grownByLint(
  ctx: Pick<RekeyContext, "worktreeId" | "tool" | "store" | "lint" | "readByLint">,
  keyer: Keyer,
  cursor: LintCursor,
): boolean {
  const inputs = readInputs(ctx.store.meta, lintScope(ctx.worktreeId, ctx.tool));
  if (inputs === null || inputs.environment !== cursor.environment) return false;
  const recorded = new Set(inputs.files.map(([path]) => path));
  const { snapshot } = keyer.basis;
  const added = snapshot.closure.filter((path) => !recorded.has(path));
  if (added.length === 0 || !added.every((path) => ctx.readByLint.has(path))) return false;
  const closure = snapshot.closure.filter((path) => recorded.has(path));
  const before = { ...keyer.basis, snapshot: { ...snapshot, closure } };
  return environmentOf(before, ctx.lint, keyer.inputBlobOf) === cursor.environment;
}
