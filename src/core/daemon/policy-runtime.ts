import { isRecord } from "../fs/index.js";
import { normalizeRuntimePath } from "../keys/runtime-files.js";
import type { RuntimeFileRule } from "../types/policy.js";
import type { Leaf } from "./config-file.js";
import { compiles } from "./policy-node-test.js";

/** A bad rule contributes no exclusions. Independent valid rules still apply. */
export const runtimeFiles: Leaf = (value) => {
  if (!Array.isArray(value)) return "an array of runtime-file rules";
  const kept: RuntimeFileRule[] = [];
  const problems: string[] = [];
  for (const [i, rule] of value.entries()) {
    try {
      if (!isRecord(rule)) throw new Error("must be an object");
      const unknown = Object.keys(rule).filter(
        (key) => !["project", "tests", "paths"].includes(key),
      );
      if (unknown.length) throw new Error(`unknown fields: ${unknown.join(", ")}`);
      if (typeof rule.project !== "string") throw new Error("project must be a string");
      for (const key of ["tests", "paths"] as const) {
        if (
          !Array.isArray(rule[key]) ||
          rule[key].length === 0 ||
          !rule[key].every((v) => typeof v === "string" && v.length > 0)
        )
          throw new Error(`${key} must be a nonempty array of nonempty strings`);
      }
      const tests = (rule.tests as string[]).map((glob) =>
        glob.replaceAll("\\", "/").replace(/^(\.\/)+/, ""),
      );
      if (tests.some((glob) => glob.startsWith("!") || glob.includes("\0")))
        throw new Error("invalid test glob");
      const problem = compiles(tests);
      if (problem !== null)
        throw new Error(typeof problem === "string" ? problem : problem.problem);
      kept.push({
        project: rule.project,
        tests,
        paths: [...new Set((rule.paths as string[]).map(normalizeRuntimePath))].sort(),
      });
    } catch (error) {
      problems.push(`runtimeFiles[${i}]: ${(error as Error).message}`);
    }
  }
  return { kept, problems };
};
