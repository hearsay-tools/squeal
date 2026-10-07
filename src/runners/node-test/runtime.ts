import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AbsolutePath } from "../../core/types/index.js";

/** The two files Squeal loads into the project's Node (spec 003 D5). */
export interface NodeTestRuntime {
  readonly reporter: AbsolutePath;
  readonly recorder: AbsolutePath;
}

/**
 * Where the runtime files sit relative to `module`, the running code's own
 * file: from a bundled CLI at `<plugin>/dist/cli/`, the plugin's
 * `dist/node-test/`; from the TypeScript sources, `runtime/` beside this
 * file. Both are dependency-free `.mjs` copied verbatim (D5).
 */
const CANDIDATES = ["../node-test/", "./runtime/"] as const;

export function nodeTestRuntime(module: URL = new URL(import.meta.url)): NodeTestRuntime {
  const tried: string[] = [];
  for (const candidate of CANDIDATES) {
    const dir = new URL(candidate, module);
    const reporter = fileURLToPath(new URL("reporter.mjs", dir));
    const recorder = fileURLToPath(new URL("recorder.mjs", dir));
    if (existsSync(reporter) && existsSync(recorder)) return { reporter, recorder };
    tried.push(fileURLToPath(dir));
  }
  throw new Error(
    `node:test runtime files not found beside ${module.href}: tried ${tried.join(", ")}`,
  );
}
