import type { NodeTestProject, RunnerAdapter } from "../../core/types/index.js";

/**
 * Bumped when the adapter changes what a result, closure or environment means,
 * so the environment hash re-keys every check (001 D3).
 */
export const NODE_TEST_ADAPTER_VERSION = "0";

/**
 * The node:test adapter of one configured project (spec 003 D1). A stub until
 * wave 1: it lists no test files and no environment, so a `nodeTest` entry is
 * accepted and a daemon starts with it, and nothing of the project is
 * scheduled. A call about a file it never listed rejects.
 */
export function createNodeTestAdapter(project: NodeTestProject): RunnerAdapter {
  const unlisted = (path: string) =>
    Promise.reject(
      new Error(`node-test project ${JSON.stringify(project.name)} lists no test files: ${path}`),
    );
  return {
    name: "node-test",
    adapterVersion: NODE_TEST_ADAPTER_VERSION,
    invalidate: async () => ({ recreatedProjects: [] }),
    affected: async () => ({ direct: [], transitive: [] }),
    closure: (testFile) => unlisted(testFile.path),
    enumerate: (testFile) => unlisted(testFile.path),
    testFiles: async () => [],
    environment: async () => [],
    run: (testFiles) => unlisted(testFiles.map((f) => f.path).join(", ")),
    close: async () => {},
  };
}
