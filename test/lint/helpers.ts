import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { lineHash } from "../../src/core/lint/fingerprint.js";
import { isLintStoreOpenFailure, openLintStore } from "../../src/core/lint/store/index.js";
import type { LintStore } from "../../src/core/lint/store/types.js";
import { DEFAULT_POLICY, type Policy } from "../../src/core/types/index.js";
import type { LintCheckId, LintFinding } from "../../src/core/types/lint.js";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

/** The policy with `lint.enabled` on and every code feature off. */
export const LINT_ON: Policy = {
  ...DEFAULT_POLICY,
  complexity: { ...DEFAULT_POLICY.complexity, enabled: false },
  coverage: { ...DEFAULT_POLICY.coverage, enabled: false },
  lint: { ...DEFAULT_POLICY.lint, enabled: true },
};

/** A fresh git common dir, removed after the test. */
export function commonDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "squeal-lint-"));
  cleanups.push(() =>
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
  );
  const git = join(dir, ".git");
  mkdirSync(git);
  return git;
}

/** Opens a lint store that must open, closed after the test. */
export function open(
  dir: string,
  options: { create?: boolean; busyTimeoutMs?: number } = {},
): LintStore {
  const store = openLintStore(dir, LINT_ON, { busyTimeoutMs: 10_000, ...options });
  if (isLintStoreOpenFailure(store)) throw new Error(`open failed: ${JSON.stringify(store)}`);
  cleanups.push(() => store.close());
  return store;
}

export function check(path = "src/a.ts"): LintCheckId {
  return { kind: "lint", path, tool: "eslint" };
}

/** An error finding on `line`, whose text is `line N` unless given. */
export function finding(
  rule: string | null,
  message: string,
  line = 1,
  text = `line ${line}`,
): LintFinding {
  return { rule, message, severity: "error", line, column: 1, lineHash: lineHash(text) };
}
