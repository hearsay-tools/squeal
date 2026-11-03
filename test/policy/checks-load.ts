import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { loadPolicy, POLICY_FILE } from "../../src/core/daemon/policy.js";

/** Loads `file` as `squeal.config.json` from a temp directory removed after each test. */
export function useLoad(): (file: unknown) => ReturnType<typeof loadPolicy> {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  return (file) => {
    const dir = mkdtempSync(join(tmpdir(), "squeal-policy-checks-"));
    dirs.push(dir);
    writeFileSync(join(dir, POLICY_FILE), JSON.stringify(file));
    return loadPolicy(dir);
  };
}

/** Spec 019 D1's example: e2e above unit, so the narrow group owns its files. */
export const EXAMPLE = [
  {
    name: "e2e",
    runner: "vitest",
    project: "e2e",
    at: "stop",
    after: ["unit"],
    limits: { maxParallel: 1 },
  },
  { name: "unit", runner: "vitest", tests: ["test/**"], at: "edit" },
  { name: "api", runner: "pytest", project: "api", at: "pause" },
  { name: "lint", lint: true, at: "commit" },
];

/** The `pytest` entry the example's `api` group names. */
export const API_PROJECT = { name: "api", include: ["tests/**/test_*.py"] };
