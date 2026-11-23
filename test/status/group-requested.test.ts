import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { squealEvidence } from "../../evals/lib/index.mjs";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { publishNarrowAsks } from "../../src/core/scheduler/narrow-asks-row.js";
import { publishPromotions } from "../../src/core/scheduler/promotions-row.js";
import { readHeader } from "../../src/core/state/header.js";
import type { EpochMs } from "../../src/core/types/common.js";
import { inTurn, keys, NOW, type Seeded, seed, status } from "./slow-tier-seed.js";

/*
 * Row 023-67 (dogfood round 8, X2): a request-only group whose files a
 * request queued says so, and does not ask for `squeal run <group>`. All
 * 10 round 8 s1 sessions read "browser: 97 test files; 97 pending, waiting
 * for `squeal run browser`. Squeal runs them only on request" after their
 * first `status --at … --run` had queued the 97 in that daemon; s1-06
 * repeated it as fact.
 */

let runtime: string;
beforeEach(() => {
  runtime = mkdtempSync(join(tmpdir(), "squeal-group-requested-"));
  vi.stubEnv("XDG_RUNTIME_DIR", runtime);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(runtime, { recursive: true, force: true });
});

const BROWSER = {
  checks: [
    {
      name: "browser",
      runner: "vitest",
      tests: ["test/browser/**"],
      at: "manual",
      limits: { maxParallel: 1 },
    },
  ],
};
const FILES = ["test/browser/a.test.ts", "test/browser/b.test.ts", "test/browser/c.test.ts"];
const id = (path: string) => testFileId({ project: "", path });

/**
 * The browser files queued; the daemon publishes a narrow run's asks for
 * `asked` at their keys (`at`: when; `key`: the key each was asked at).
 */
function queued(
  asked: readonly string[],
  at: number = NOW,
  key: (path: string) => string = (path) => `key-${path}`,
): Seeded {
  const s = seed(BROWSER, { revisions: 3 });
  keys(s.store, s.repo, Object.fromEntries(FILES.map((path) => [path, "queued" as const])));
  const asks = asked.map((path) => [id(path), key(path)] as const);
  publishNarrowAsks(s.store, s.repo.mainId, asks, at as EpochMs);
  inTurn(s);
  return s;
}

/** The groups the evals parser reads as waiting for their run (`squeal-text.mjs`, `waitingOf`). */
const waitingIn = (text: string): string[] =>
  (squealEvidence(text, "pull") as { waiting?: string[] } | null)?.waiting ?? [];

const lineOf = (text: string) => text.split("\n").find((line) => line.startsWith("browser:"));
const REQUESTS = "(`squeal status --at <commit> --run` or `squeal run browser <path>...`)";

describe("a request-only group a request queued (row 023-67, X2)", () => {
  it("reads as queued, not as waiting for `squeal run browser`", () => {
    const s = queued(FILES);
    expect(readHeader(s.store, s.repo.mainId).groupTiers?.[0]).toMatchObject({
      pending: 3,
      requested: 3,
    });
    const text = status(s);
    expect(lineOf(text)).toBe(
      `browser: 3 test files; 3 queued by a request ${REQUESTS}. Squeal runs them now; \`squeal run browser --wait 60000\` waits for their results.`,
    );
    expect(text).not.toContain("waiting for `squeal run browser`");
    expect(text).not.toContain("only on request");
    // The evals parser reads the status as it is printed: the group waits for no run.
    expect(waitingIn(text)).not.toContain("browser");
  });

  it("says which files a request queued and which still wait for one", () => {
    const text = status(queued(FILES.slice(0, 2)));
    expect(lineOf(text)).toBe(
      `browser: 3 test files; 2 queued by a request ${REQUESTS}, 1 pending, waiting for \`squeal run browser\`. Squeal runs the requested ones now, the other pending ones only on request; \`squeal run browser --wait 60000\` runs them now and waits for their results.`,
    );
  });

  it("keeps the wait for `squeal run browser` with no request, or one an earlier daemon published", () => {
    const old =
      "browser: 3 test files; 3 pending, waiting for `squeal run browser`. Squeal runs them only on request; `squeal run browser --wait 60000` runs them now and waits for their results.";
    const none = status(queued([]));
    expect(lineOf(none)).toBe(old);
    expect(waitingIn(none)).toContain("browser");
    // The seeded daemon started at NOW - 60 s: a batch row written before is its predecessor's.
    expect(lineOf(status(queued(FILES, NOW - 120_000)))).toBe(old);
  });

  it("counts no named wait's batch and no ask at a key the file left (review 0.1.610 B1)", () => {
    const old =
      "browser: 3 test files; 3 pending, waiting for `squeal run browser`. Squeal runs them only on request; `squeal run browser --wait 60000` runs them now and waits for their results.";
    // A plain `squeal status --wait <path>` batches the files and runs no held one.
    const waited = queued([]);
    const files = FILES.map(id);
    const batch = { files, estimatedEnd: null };
    publishPromotions(
      waited.store,
      waited.repo.mainId,
      [{ files, until: NOW as EpochMs, batch }],
      NOW as EpochMs,
    );
    expect(readHeader(waited.store, waited.repo.mainId).groupTiers?.[0]?.requested).toBeUndefined();
    expect(lineOf(status(waited))).toBe(old);
    // An edit re-keyed the files after the ask: the lane no longer runs them.
    expect(lineOf(status(queued(FILES, NOW, (path) => `old-${path}`)))).toBe(old);
  });
});
