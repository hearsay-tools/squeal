import { describe, expect, it } from "vitest";
import { waitConsumer, waitForStatus } from "../../src/cli/status-wait.js";
import { tellRevision } from "../../src/core/delivery/liveness.js";
import { MAIN_AGENT, type RevisionNumber, type Store } from "../../src/core/types/index.js";
import { A, answering, NOW, options, repoWith } from "./status-wait-fixture.js";

/*
 * Spec 008 D2: the plugin's `shell.env` names the consumer in the agent's
 * shell, `OPENCODE_SESSION_ID` the root session and `OPENCODE_AGENT_ID` the
 * agent, `main` for the root and the child session's id for a child. A
 * `status --wait` pulled from that shell starts its window where that one
 * consumer was last told, not where the session's other agents were.
 */

const ROOT = "ses_root";
const CHILD = "ses_child";

function told(store: Store, worktreeId: string, agentId: string, revision: number) {
  const consumer = { worktreeId, sessionId: ROOT, agentId };
  store.consumers.register(consumer, NOW);
  tellRevision(store, consumer, revision as RevisionNumber);
}

describe("a status --wait pull from an OpenCode shell (spec 008 D2)", () => {
  it("reads the consumer from OPENCODE_SESSION_ID and OPENCODE_AGENT_ID", () => {
    expect(
      waitConsumer({ OPENCODE: "1", OPENCODE_SESSION_ID: ROOT, OPENCODE_AGENT_ID: CHILD }),
    ).toEqual({ session: ROOT, agent: CHILD });
    expect(waitConsumer({ OPENCODE_SESSION_ID: ROOT, OPENCODE_AGENT_ID: MAIN_AGENT })).toEqual({
      session: ROOT,
      agent: MAIN_AGENT,
    });
    // Without the agent, every consumer of the session counts, as for Codex.
    expect(waitConsumer({ OPENCODE_SESSION_ID: ROOT })).toEqual({ session: ROOT, agent: null });
    expect(waitConsumer({ OPENCODE_SESSION_ID: ROOT, OPENCODE_AGENT_ID: "" })).toEqual({
      session: ROOT,
      agent: null,
    });
    // The plugin never ran: no session to credit.
    expect(waitConsumer({ OPENCODE: "1" })).toEqual({ session: null, agent: null });
    expect(waitConsumer({ OPENCODE_SESSION_ID: "" })).toEqual({ session: null, agent: null });
  });

  it("keeps the Claude Code and Codex sessions first, and their agent unnamed", () => {
    const opencode = { OPENCODE_SESSION_ID: ROOT, OPENCODE_AGENT_ID: CHILD };
    expect(waitConsumer({ ...opencode, CLAUDE_CODE_SESSION_ID: "cc" })).toEqual({
      session: "cc",
      agent: null,
    });
    expect(waitConsumer({ ...opencode, CODEX_SESSION_ID: "cx" })).toEqual({
      session: "cx",
      agent: null,
    });
    expect(waitConsumer({})).toEqual({ session: null, agent: null });
  });

  it("credits a child's pull to (root, child) and a root's to (root, main)", async () => {
    const { repo, store } = repoWith([], [A]);
    told(store, repo.mainId, MAIN_AGENT, 3);
    told(store, repo.mainId, CHILD, 2);

    const child = answering(store, repo.mainId, [A]);
    const fromChild = await waitForStatus(repo.main, {
      ...options(child.sync),
      ...waitConsumer({ OPENCODE_SESSION_ID: ROOT, OPENCODE_AGENT_ID: CHILD }),
    });
    const root = answering(store, repo.mainId, [A]);
    const fromRoot = await waitForStatus(repo.main, {
      ...options(root.sync),
      ...waitConsumer({ OPENCODE_SESSION_ID: ROOT, OPENCODE_AGENT_ID: MAIN_AGENT }),
    });
    const whole = answering(store, repo.mainId, [A]);
    const fromSession = await waitForStatus(repo.main, {
      ...options(whole.sync),
      ...waitConsumer({ OPENCODE_SESSION_ID: ROOT }),
    });

    // The child was last told revision 2, the root 3: each window starts after its own.
    expect(fromChild).toMatchObject({ edit: { since: 3 } });
    expect(fromRoot).toMatchObject({ edit: { since: 4 } });
    // No agent named: after the session's oldest, as a Codex shell's pull.
    expect(fromSession).toMatchObject({ edit: { since: 3 } });
  });
});
