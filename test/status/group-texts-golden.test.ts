import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { headerLines } from "../../src/core/delivery/index.js";
import { publishSlowActivity } from "../../src/core/slow/state.js";
import { clockText, readHeader } from "../../src/core/state/index.js";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import { DEFAULT_COVERAGE } from "../../src/harness/shared/coverage.js";
import { primer } from "../../src/harness/shared/primer.js";
import { CODEX } from "../harness/primer-helpers.js";
import {
  FAST,
  keys,
  NOW,
  SLOW_A,
  SLOW_B,
  SLOW_POLICY,
  type Seeded,
  seed,
  states,
} from "./slow-tier-seed.js";

/*
 * Row 019-16 (spec 019 D6, wave 2's contract "Unchanged without `checks`"):
 * today's texts, recorded before the per-group lines, the moments sentence
 * and the commit line were written. With no `checks` key each must stay
 * byte-identical: the primer, the status text and the header's two forms.
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
          "Revision 3: 1 current (1 test), 0 pending, 0 stale, 0 unknown. Test files without checks: 2 pending, 0 unknown. Full-suite checkpoint: none completed at any revision (the counts are for revision 3; \`squeal run --all\` requests one).",
          "Slow tier: 2 test files; 1 current at revision 2; running test/e2e/b.test.ts since <clock> (last run 4 min). Squeal runs them after the fast tests; \`squeal run --slow --wait 60000\` waits for its result.",
        ],
        "news": [
          "Revision 3: test files without checks: 2 pending.",
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
        "full": [
          "Revision 3: 1 current (1 test), 0 pending, 0 stale, 0 unknown. Test files without checks: 2 pending, 0 unknown. Full-suite checkpoint: none completed at any revision (the counts are for revision 3; \`squeal run --all\` requests one).",
        ],
        "news": [
          "Revision 3: test files without checks: 2 pending.",
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

  it("the primer under each slow policy", () => {
    const slow = (o: object) => ({ ...DEFAULT_COVERAGE, slow: { files: 2, ...o } });
    expect({
      none: primer(),
      continuous: primer("squeal", slow({ requireSlowSuite: false })),
      idleRequired: primer("squeal", slow({ requireSlowSuite: true, pausesOnly: true })),
      codex: primer(CODEX, slow({ requireSlowSuite: true })),
    }).toMatchInlineSnapshot(`
      {
        "codex": "Squeal runs this repository's Vitest tests in the background after each edit; a SQUEAL message with your next tool call means a check changed, and passing results stay silent, so keep working; do not run Vitest to learn whether your edits broke something. Wait only when you need a result before your next step, for example before saying the task is done: \`node --disable-warning=ExperimentalWarning /home/someone/.codex/plugins/cache/squeal/squeal/0.1.107/dist/cli/squeal.mjs status --wait 60000\`. Slow test files run after the fast tests; this repository requires them once you change a file: before you say the task is done, wait with the CLI's \`run --slow --wait 60000\` unless the latest \`Slow tier:\` line says every slow file is current; Stop waits or holds you once. A slow failure arrives with your next prompt or tool call. Run tests yourself only when no daemon is validating, when results are unknown, or when the repository's own gate requires it. For a failure from load or a stopped service: the CLI's \`retry <file> --reason load|environment\`, never past a real one. A revision is Squeal's number for each saved change to this worktree's files; every result names the revision it ran at, and a header names the files its revision changed. Squeal covers Vitest, with 2 slow test files at the daemon's last listing. Squeal does not cover typecheck, build or any other test suite: run those yourself.",
        "continuous": "Squeal runs this repository's Vitest tests in the background after each edit; a SQUEAL message with your next tool call means a check changed, and passing results stay silent, so keep working; do not run Vitest to learn whether your edits broke something. Wait only when you need a result before your next step: \`squeal status --wait 60000 <path>...\` for the verdict on files you just changed; before you finish, \`squeal status --wait 60000\` or a checkpoint, \`squeal run --all --wait\`. Slow test files run after the fast tests; this repository does not require them before you finish: say slow tests pass only when the latest \`Slow tier:\` line states every slow file is current, else say how many are not, or wait for them with \`squeal run --slow --wait 60000\`. A slow failure wakes you when you are idle in an interactive session; otherwise it arrives with your next prompt or tool call. Run tests yourself only when no daemon is validating, when results are unknown, or when the repository's own gate requires it. For a failure from load or a stopped service: \`squeal retry <file> --reason load|environment\`, never past a real one. A revision is Squeal's number for each saved change to this worktree's files; every result names the revision it ran at, and a header names the files its revision changed. Squeal covers Vitest, with 2 slow test files at the daemon's last listing. Squeal does not cover typecheck, build or any other test suite: run those yourself.",
        "idleRequired": "Squeal runs this repository's Vitest tests in the background after each edit; a SQUEAL message with your next tool call means a check changed, and passing results stay silent, so keep working; do not run Vitest to learn whether your edits broke something. Wait only when you need a result before your next step: \`squeal status --wait 60000 <path>...\` for the verdict on files you just changed; before you finish, \`squeal status --wait 60000\` or a checkpoint, \`squeal run --all --wait\`. Slow test files run between your turns; this repository requires them once you change a file: before you say the task is done, wait with \`squeal run --slow --wait 60000\` unless the latest \`Slow tier:\` line says every slow file is current; Stop waits or holds you once. A slow failure wakes you when you are idle in an interactive session; otherwise it arrives with your next prompt or tool call. Run tests yourself only when no daemon is validating, when results are unknown, or when the repository's own gate requires it. For a failure from load or a stopped service: \`squeal retry <file> --reason load|environment\`, never past a real one. A revision is Squeal's number for each saved change to this worktree's files; every result names the revision it ran at, and a header names the files its revision changed. Squeal covers Vitest, with 2 slow test files at the daemon's last listing. Squeal does not cover typecheck, build or any other test suite: run those yourself.",
        "none": "Squeal runs this repository's Vitest tests in the background after each edit; a SQUEAL message with your next tool call means a check changed, and passing results stay silent, so keep working; do not run Vitest to learn whether your edits broke something. Wait only when you need a result before your next step: \`squeal status --wait 60000 <path>...\` for the verdict on files you just changed; before you finish, \`squeal status --wait 60000\` or a checkpoint, \`squeal run --all --wait\`. Run tests yourself only when no daemon is validating, when results are unknown, or when the repository's own gate requires it. For a failure from load or a stopped service: \`squeal retry <file> --reason load|environment\`, never past a real one. A revision is Squeal's number for each saved change to this worktree's files; every result names the revision it ran at, and a header names the files its revision changed. Squeal covers Vitest. Squeal does not cover typecheck, build or any other test suite: run those yourself.",
      }
    `);
  });
});
