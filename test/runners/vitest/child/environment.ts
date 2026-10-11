// Prints the Vitest adapter's environments of the project at argv[2], and
// what std-env detected, from a fresh process: std-env reads the environment
// once, when it loads, so each environment under test needs its own process.
import { isAgent, isCI } from "std-env";
import { createVitestAdapter } from "../../../../src/runners/vitest/index.js";

const adapter = await createVitestAdapter({ root: process.argv[2] as string });
try {
  const environments = await adapter.environment();
  process.stdout.write(JSON.stringify({ isAgent, isCI, environments }));
} finally {
  await adapter.close();
}
