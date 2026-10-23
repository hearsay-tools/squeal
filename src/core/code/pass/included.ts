import { extname } from "node:path";
import { createInputMatcher } from "../../keys/glob.js";
import { CODE_EXTENSIONS, type CodeLanguage } from "../../types/code.js";
import type { Policy, RelativePath } from "../../types/index.js";

/**
 * Spec 015 D1: the language a path is counted as, or `null` when it is not
 * included: an extension the counter does not read, outside `include`,
 * inside `exclude`, under `node_modules`, a test file or a file git ignores.
 * The size limit is not applied here: a file over it is still included, and
 * named as too big (D6).
 */
export type Included = (path: RelativePath) => CodeLanguage | null;

export function includedSet(
  complexity: Policy["complexity"],
  testFiles: readonly RelativePath[],
  ignored: readonly RelativePath[],
): Included {
  const include = createInputMatcher(complexity.include);
  const exclude = createInputMatcher(complexity.exclude);
  const never = new Set([...testFiles, ...ignored]);
  return (path) => {
    const language = CODE_EXTENSIONS[extname(path)];
    if (language === undefined || never.has(path)) return null;
    if (path.startsWith("node_modules/") || path.includes("/node_modules/")) return null;
    return include(path) && !exclude(path) ? language : null;
  };
}
