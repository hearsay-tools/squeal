import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDelta } from "../../src/core/delivery/format.js";
import { readHeader } from "../../src/core/state/header.js";
import type { Delta } from "../../src/core/types/delivery.js";
import type { StatusHeader } from "../../src/core/types/status.js";
import { keys, seed } from "../status/slow-tier-seed.js";

/*
 * Row 019-49 (spec 019 D6, "No test group at `edit`"): with no test group
 * at `edit`, the edit lines that say passing results stay silent say
 * instead that silence between edits is not a pass and name the narrow run,
 * as the primer does. The header carries the condition; with a test group
 * at `edit`, the lines read as before.
 */

let runtime: string;
beforeEach(() => {
  runtime = mkdtempSync(join(tmpdir(), "squeal-no-edit-group-"));
  vi.stubEnv("XDG_RUNTIME_DIR", runtime);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(runtime, { recursive: true, force: true });
});

/** D6's example: every test group at `stop` or `manual`, lint at `stop`. */
const QUIET_POLICY = {
  checks: [
    { name: "lint", lint: true, at: "stop" },
    { name: "unit", runner: "vitest", tests: ["src/**"], at: "stop" },
    { name: "browser", runner: "vitest", tests: ["test/**"], at: "manual" },
  ],
};

const header: StatusHeader = {
  revision: 7,
  counts: { current: 4, pending: 2, stale: 0, unknown: 0 },
  fileLevelCounts: { current: 1, pending: 1, stale: 0, unknown: 0 },
  testFilesWithoutChecks: { pending: 0, unknown: 0 },
  fullSuite: { atCurrentRevision: false, lastCompletedRevision: null },
  inheritedCount: 0,
};

function delta(h: StatusHeader, extra: Partial<Delta>): Delta {
  const consumer = { worktreeId: "wt-a", sessionId: "s1", agentId: "main" };
  return { schemaVersion: 1, consumer, header: h, label: "transitions", entries: [], ...extra };
}

const QUIET =
  "no test group runs after each edit, so silence between edits is not a pass; `squeal run <group> <path>... --wait 60000` runs the test files your paths select.";

describe("the edit lines with no test group at edit (019-49)", () => {
  const quiet = { ...header, noTestsAtEdit: true as const };

  it("say the edit re-keyed files and silence is not a pass, never that they were queued", () => {
    const text = formatDelta(delta(quiet, { sawEdit: { queued: 2 } }));
    expect(text).toContain(`Squeal saw your edit, which re-keyed 2 test files; ${QUIET}`);
    expect(text).not.toContain("stay silent");
    expect(text).not.toContain("queued 2");
  });

  it("say it beside settled files, and name the CLI as the delivery does", () => {
    const settled = { since: 6, files: 1, unknown: 0 };
    const text = formatDelta(delta(quiet, { sawEdit: { queued: 1 }, editsSettled: settled }));
    expect(text).toContain(
      `Squeal saw your edit; the 1 test file it re-keyed is current, and ${QUIET}`,
    );
    const codex = formatDelta(
      delta(quiet, { sawEdit: { queued: 2 }, editsSettled: { since: 6, files: 2, unknown: 1 } }),
      "/x/squeal",
    );
    expect(codex).toContain(
      "of the 2 test files it re-keyed, 1 current and 1 with no result (unknown); no test group runs after each edit, so silence between edits is not a pass; `/x/squeal run <group> <path>... --wait 60000`",
    );
  });

  it("read as before without the flag", () => {
    expect(formatDelta(delta(header, { sawEdit: { queued: 2 } }))).toContain(
      "Squeal saw your edit and queued 2 test files; results arrive with later tool calls, and passing ones stay silent.",
    );
  });
});

describe("the header's flag (019-49)", () => {
  it("is set with no test group at edit, and the default tests group owning nothing", () => {
    const s = seed(QUIET_POLICY, { revisions: 2 });
    keys(s.store, s.repo, { "src/a.test.ts": null, "test/b.test.ts": null });
    expect(readHeader(s.store, s.repo.mainId).noTestsAtEdit).toBe(true);
    s.store.close();
  });

  it("is absent once the default tests group owns a listed file", () => {
    const policy = { checks: QUIET_POLICY.checks.slice(0, 2) };
    const s = seed(policy, { revisions: 2 });
    keys(s.store, s.repo, { "src/a.test.ts": null, "test/b.test.ts": null });
    expect(readHeader(s.store, s.repo.mainId).noTestsAtEdit).toBeUndefined();
    s.store.close();
  });

  it("is absent with a test group at edit, and without a checks key", () => {
    const policy = {
      checks: [...QUIET_POLICY.checks, { name: "fast", runner: "vitest", at: "edit" }],
    };
    const s = seed(policy, { revisions: 2 });
    keys(s.store, s.repo, { "src/a.test.ts": null });
    expect(readHeader(s.store, s.repo.mainId).noTestsAtEdit).toBeUndefined();
    s.store.close();
    const none = seed({}, { revisions: 2 });
    expect(readHeader(none.store, none.repo.mainId).noTestsAtEdit).toBeUndefined();
    none.store.close();
  });
});
