import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { isCodeStoreOpenFailure, openCodeStore } from "../../src/core/code/store/index.js";
import type { CodeStore } from "../../src/core/code/store/types.js";
import type { CodeCheckId, CodeFile, FileCount } from "../../src/core/types/code.js";
import { DEFAULT_POLICY, type Policy } from "../../src/core/types/index.js";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

/** The policy with `complexity.enabled` on. */
export const ON: Policy = {
  ...DEFAULT_POLICY,
  complexity: { ...DEFAULT_POLICY.complexity, enabled: true },
};

/** A fresh git common dir, removed after the test. */
export function commonDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "squeal-code-"));
  cleanups.push(() =>
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
  );
  const git = join(dir, ".git");
  mkdirSync(git);
  return git;
}

/** Opens a code store that must open, closed after the test. */
export function open(
  dir: string,
  options: { create?: boolean; busyTimeoutMs?: number } = {},
): CodeStore {
  const store = openCodeStore(dir, ON, { busyTimeoutMs: 10_000, ...options });
  if (isCodeStoreOpenFailure(store)) throw new Error(`open failed: ${JSON.stringify(store)}`);
  cleanups.push(() => store.close());
  return store;
}

export function check(qualifiedName: string, path = "src/a.ts", occurrence = 0): CodeCheckId {
  return { kind: "code", path, qualifiedName, occurrence };
}

/** A count of one blob holding one function of complexity `cc`. */
export function count(blob: string, cc = 3, counterVersion = 1): FileCount {
  return {
    blob,
    language: "typescript",
    counterVersion,
    functions: [
      {
        qualifiedName: "Ledger.settle",
        occurrence: 0,
        range: { startLine: 2, startColumn: 3, endLine: 9, endColumn: 4 },
        bodyHash: `body-${blob}`,
        complexity: cc,
        decisions: { if: cc - 1 },
      },
    ],
    errors: [],
  };
}

export function file(path: string, blob: string, counterVersion = 1, revision = 1): CodeFile {
  return { path, blob, language: "typescript", counterVersion, size: 100, revision };
}
