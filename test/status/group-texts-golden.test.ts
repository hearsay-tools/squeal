import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { headerLines } from "../../src/core/delivery/header.js";
import { publishSlowActivity } from "../../src/core/slow/state.js";
import { readHeader } from "../../src/core/state/header.js";
import { clockText } from "../../src/core/state/slow-text.js";
import { formatStatus } from "../../src/core/status/format-status.js";
import { readStatus } from "../../src/core/status/snapshot.js";
import {
  FAST,
  keys,
  NOW,
  type Seeded,
  SLOW_A,
  SLOW_B,
  SLOW_POLICY,
  seed,
  states,
} from "./slow-tier-seed.js";

/*
 * Row 019-16 (spec 019 D6, wave 2's contract "Unchanged without `checks`"):
 * today's texts, recorded before the per-group lines, the moments sentence
 * and the commit line were written. With no `checks` key each must stay
 * byte-identical: the status text and the header's two forms. Row 005-94
 * (the human, 2026-11-17) changed the full form: no counts or checkpoint, and
 * no line after the title with nothing to say. Row 005-128 removed the primer
 * this pinned: the start message no longer names groups.
 */

let runtime: string;
beforeEach(() => {
  runtime = mkdtempSync(join(tmpdir(), "squeal-group-golden-"));
  vi.stubEnv("XDG_RUNTIME_DIR", runtime);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(runtime, { recursive: true, force: true });
});

/** A slow file current, one running, the fast one pending. */
function busy(policy: object | null = SLOW_POLICY): Seeded {
  const s = seed(policy, { revisions: 3 });
  keys(s.store, s.repo, { [SLOW_A]: null, [SLOW_B]: "running", [FAST]: "queued" });
  states(s.store, s.repo, [{ observedAt: 2 }], [SLOW_A]);
  publishSlowActivity(s.store, s.repo.mainId, {
    kind: "running",
    path: SLOW_B,
    since: NOW - 30_000,
    lastDurationMs: 240_000,
  });
  return s;
}

function texts({ repo, store }: Seeded): { status: string; full: string[]; news: string[] } {
  const header = readHeader(store, repo.mainId);
  const full = headerLines(header, "squeal");
  const news = headerLines(header, "squeal", "news", { slowTierChanged: true });
  store.close();
  const status = formatStatus(readStatus(repo.main, { now: () => NOW }), NOW);
  // The clock is local time: the recorded text names it apart from the host's zone.
  const strip = (text: string) =>
    text.replaceAll(repo.main, "<root>").replaceAll(clockText(NOW - 30_000), "<clock>");
  return { status: strip(status), full: full.map(strip), news: news.map(strip) };
}

describe("texts without a `checks` key are today's (019-16 golden)", () => {
  it("status and the header with slow files declared", () => {
    expect(texts(busy())).toMatchInlineSnapshot(`
      {
        "full": [
          "Slow tier: 2 test files; 1 current at revision 2; running test/e2e/b.test.ts since <clock> (last run 4 min). Squeal runs them after the fast tests; \`squeal run --slow --wait 60000\` waits for its result.",
        ],
        "news": [
          "Revision 3.",
          "Slow tier: 2 test files; 1 current at revision 2; running test/e2e/b.test.ts since <clock> (last run 4 min). Squeal runs them after the fast tests; \`squeal run --slow --wait 60000\` waits for its result.",
        ],
        "status": "Revision: 3
      Known failures: 0; not current: 2 of 3 test files (1 running, 1 queued)
      Affected checks: 1 passed (1 test), 0 running, 0 queued; among them 1 slow test file, test/e2e/b.test.ts: \`squeal run --slow --wait 60000\` waits for its result; 2 test files without checks yet: 1 running, 1 queued
      Full-suite checkpoint: none completed at any revision (the counts are for revision 3; \`squeal run --all\` requests one)
      Slow tier: 2 test files; 1 current at revision 2; running test/e2e/b.test.ts since <clock> (last run 4 min). Squeal runs them after the fast tests; \`squeal run --slow --wait 60000\` waits for its result.
      Running: 1 test file: test/e2e/b.test.ts
      Queued: 1 test file: src/a.test.ts
      Outstanding:
        1 test file queued; no run is open and nothing recorded holds it: src/a.test.ts; the store records no reason the daemon has not taken it (\`squeal status --json\` lists each file's state)
      Complexity: no file counted yet.
      More: \`squeal status --full\` adds the worktree and daemon
      ",
      }
    `);
  });

  it("status and the header with no slow files", () => {
    expect(texts(busy(null))).toMatchInlineSnapshot(`
      {
        "full": [],
        "news": [
          "Revision 3.",
        ],
        "status": "Revision: 3
      Known failures: 0; not current: 2 of 3 test files (1 running, 1 queued)
      Affected checks: 1 passed (1 test), 0 running, 0 queued; 2 test files without checks yet: 1 running, 1 queued
      Full-suite checkpoint: none completed at any revision (the counts are for revision 3; \`squeal run --all\` requests one)
      Running: 1 test file: test/e2e/b.test.ts
      Queued: 1 test file: src/a.test.ts
      Outstanding:
        1 test file running in the vitest lane: test/e2e/b.test.ts
        1 test file queued; no run is open and nothing recorded holds it: src/a.test.ts; the store records no reason the daemon has not taken it (\`squeal status --json\` lists each file's state)
      Complexity: no file counted yet.
      More: \`squeal status --full\` adds the worktree and daemon
      ",
      }
    `);
  });
});
