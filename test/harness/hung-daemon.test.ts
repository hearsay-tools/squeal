import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureDaemon, probeDaemon } from "../../src/core/daemon/ensure.js";
import { worktreeLiveness } from "../../src/core/delivery/index.js";
import { readStatus } from "../../src/core/status/index.js";
import { type HookDeps, type HookResult, runHook } from "../../src/harness/claude-code/index.js";
import {
  daemonSuite,
  delay,
  type FixtureRepo,
  SLOW,
  type SpawnedProcess,
  waitFor,
  waitReady,
  withStore,
} from "../daemon/helpers.js";
import { recorded } from "./helpers.js";

/*
 * Lessons, defect 22 (task 001-112): a SIGSTOPped daemon holds its lock and
 * its socket accepts connections, but it neither answers nor heartbeats. Once
 * its heartbeat is past grace, every tool boundary after an edit says that
 * edit has no result, so an agent cannot read silence as "no failures".
 */

const suite = daemonSuite();

/** The daemon's heartbeat interval (`Daemon#heartbeatMs`); grace is two of them. */
const HEARTBEAT_MS = 5_000;
/** A clock three intervals ahead: the stopped daemon's heartbeat is past grace without waiting. */
const later = () => Date.now() + 3 * HEARTBEAT_MS;

const EDIT = { tool_calls: [{ tool_name: "Edit", tool_input: {}, tool_use_id: "toolu_01A" }] };
const READ = { tool_calls: [{ tool_name: "Read", tool_input: {}, tool_use_id: "toolu_01B" }] };

const context = (out: HookResult): string =>
  out.stdout === ""
    ? ""
    : (JSON.parse(out.stdout) as { hookSpecificOutput: { additionalContext: string } })
        .hookSpecificOutput.additionalContext;

afterEach(() => {
  vi.unstubAllEnvs();
});

/** A ready daemon on the fixture with nothing pending, and a registered main session. */
async function served(): Promise<{ repo: FixtureRepo; daemon: SpawnedProcess; deps: HookDeps }> {
  const repo = suite.fixture();
  // Hooks find the socket in the environment they share with the daemon (spec 001 D1).
  vi.stubEnv("XDG_RUNTIME_DIR", repo.runtimeDir);
  const daemon = suite.daemon(repo);
  await waitReady(repo, daemon);
  await waitFor(
    () => {
      const status = readStatus(repo.root);
      if (!status.available) return null;
      const pending = status.counts.pending + status.testFilesWithoutChecks.pending;
      return pending === 0 && status.breakdown.testFiles > 0;
    },
    120_000,
    "no pending work",
  );
  const deps: HookDeps = { env: {}, cli: suite.cli };
  await runHook("session-start", recorded("session-start", repo.root), deps);
  return { repo, daemon, deps };
}

function breakMath(repo: FixtureRepo): void {
  writeFileSync(
    join(repo.root, "src/math.ts"),
    "export const add = (a: number, b: number) => a - b;\n",
  );
}

describe("a SIGSTOPped daemon (lessons, defect 22)", SLOW, () => {
  it("is down past grace, unresponsive on its socket, and not replaced", async () => {
    const { repo, daemon } = await served();
    daemon.child.kill("SIGSTOP");
    try {
      const record = withStore(repo, (store) => store.worktrees.get(repo.worktreeId));
      expect(worktreeLiveness(record, Date.now()).state).toBe("alive");
      expect(worktreeLiveness(record, later()).state).toBe("down");
      const probe = await probeDaemon(repo.root, 100, { now: later });
      expect(probe.state).toBe("unresponsive");
      expect(
        await ensureDaemon(repo.root, { socketTimeoutMs: 100, now: later, cli: suite.cli }),
      ).toBe("unavailable");
    } finally {
      daemon.child.kill("SIGCONT");
    }
  });

  it("says at every boundary with an edit that the edit has no result, then recovers", async () => {
    const { repo, daemon, deps } = await served();
    const hung: HookDeps = { ...deps, now: later };

    daemon.child.kill("SIGSTOP");
    try {
      await delay(50);
      const since = withStore(repo, (s) => s.worktrees.get(repo.worktreeId)?.daemon?.heartbeatAt);
      const line = `Not validated: no daemon has validated since ${new Date(since ?? 0).toISOString()}; any change this call made has no result.`;
      breakMath(repo);
      const first = context(
        await runHook("post-tool-batch", recorded("post-tool-batch", repo.root, EDIT), hung),
      );
      expect(first).toMatch(/^SQUEAL · no daemon is validating at revision \d+\n/);
      expect(first).toContain(line);

      const second = context(
        await runHook("post-tool-batch", recorded("post-tool-batch", repo.root, EDIT), hung),
      );
      expect(second).toBe(`SQUEAL · ${line}`);

      const read = context(
        await runHook("post-tool-batch", recorded("post-tool-batch", repo.root, READ), hung),
      );
      expect(read).toBe("");
    } finally {
      daemon.child.kill("SIGCONT");
    }

    const after: string[] = [];
    const recovered = await waitFor(
      async () => {
        const out = context(
          await runHook("post-tool-batch", recorded("post-tool-batch", repo.root, READ), deps),
        );
        after.push(out);
        return out.includes("FAIL") ? out : null;
      },
      120_000,
      "the edit's result after SIGCONT",
    );
    expect(recovered).toMatch(/^SQUEAL · 1 check changed at revision \d+\n/);
    expect(recovered).toContain("PASS -> FAIL");
    expect(after.join("\n")).not.toContain("Not validated");
  });
});
