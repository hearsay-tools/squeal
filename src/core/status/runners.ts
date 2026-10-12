import { readPolicy } from "../daemon/policy.js";
import { vitestDetected } from "../daemon/runner.js";

/**
 * The runners the daemon builds in `root`, by its own rule (spec 003 D7: Vitest
 * when detected or when no node:test project is configured), named for the
 * status counts so they never read as every suite's result (experiment for
 * 001-292: the a5-uncovered false passes quoted "30 passed" as the whole answer).
 */
export function runnerNames(root: string): string[] {
  const policy = readPolicy(root);
  const vitest = policy.nodeTest.length === 0 || vitestDetected(root);
  return [
    ...(vitest ? ["Vitest"] : []),
    ...policy.nodeTest.map((project) => `node:test (${project.name})`),
  ];
}
