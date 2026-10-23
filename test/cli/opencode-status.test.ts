import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { opencodeCliCommand } from "../../src/cli/opencode/status.js";
import { INSTALL_SH_COMMAND } from "../../src/cli/pi/status.js";
import { statusCommand } from "../../src/cli/status-command.js";
import { shellWord } from "../../src/core/text.js";
import { opencodeCommand } from "../../src/harness/opencode/bridge.js";
import { appendRevisions, fakeRepo, seedStore } from "../status/helpers.js";

/* Spec 008 D7 and goal 8: `squeal status` in an OpenCode shell. */

function run(argv: string[], cwd: string, env: Record<string, string> = {}) {
  let stdout = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: () => {},
    cwd,
    env,
  };
  return { code: main(argv, io), stdout };
}

function storeRepo(consumers: [session: string, agent: string][]) {
  const repo = fakeRepo();
  const store = seedStore(repo);
  appendRevisions(store, repo.mainId, 1, { head: null, dirty: false });
  for (const [sessionId, agentId] of consumers) {
    store.consumers.register({ worktreeId: repo.mainId, sessionId, agentId }, 1);
  }
  store.close();
  return repo;
}

const ROOT = "ses_root";
const SHELL = { OPENCODE: "1", OPENCODE_PID: "4242", OPENCODE_SESSION_ID: ROOT };
const UNREGISTERED =
  /^OpenCode: no Squeal consumer is registered for this session in this worktree \(OPENCODE_SESSION_ID ses_root\)\. .* install it with (.*), then start OpenCode again\.$/m;
const NOT_SET_UP =
  /^OpenCode: this repository is not set up for Squeal \(no squeal\.config\.json and no Squeal store\), so the Squeal OpenCode plugin stays off in it\. Run squeal setup, then start OpenCode again\.$/m;
const NEVER_RAN =
  /^OpenCode: this shell runs under OpenCode \(OPENCODE=1\) without OPENCODE_SESSION_ID, so the Squeal OpenCode plugin did not run in this session\. Install it with (.*), then start OpenCode again\.$/m;

describe("squeal status in an OpenCode shell (spec 008 D7)", () => {
  it("adds the line, with the install command, when OPENCODE_SESSION_ID has no consumer", () => {
    const repo = storeRepo([["ses_other", "main"]]);
    const { code, stdout } = run(["status"], repo.main, SHELL);
    expect(code).toBe(0);
    expect(stdout).toMatch(/^Revision: 1/);
    expect(UNREGISTERED.exec(stdout)?.[1]).toBe(INSTALL_SH_COMMAND);
    expect(stdout).not.toMatch(NEVER_RAN);
  });

  it("adds it when a squeal.config.json is there but no store yet", () => {
    const repo = fakeRepo();
    writeFileSync(join(repo.main, "squeal.config.json"), "{}\n");
    const { stdout } = run(["status"], repo.main, SHELL);
    expect(stdout).toMatch(/^Status unavailable/);
    expect(stdout).toMatch(UNREGISTERED);
    expect(stdout).not.toMatch(NOT_SET_UP);
  });

  it("says the plugin never ran when OPENCODE=1 comes without OPENCODE_SESSION_ID in a set-up repository", () => {
    const repo = storeRepo([[ROOT, "main"]]);
    for (const env of [{ OPENCODE: "1" }, { OPENCODE: "1", OPENCODE_SESSION_ID: "" }]) {
      const { stdout } = run(["status"], repo.main, env);
      expect(NEVER_RAN.exec(stdout)?.[1]).toBe(INSTALL_SH_COMMAND);
      expect(stdout).not.toMatch(UNREGISTERED);
      expect(stdout).not.toMatch(NOT_SET_UP);
    }
    // Set up by its config alone, from a subdirectory of the worktree.
    const configured = fakeRepo();
    writeFileSync(join(configured.main, "squeal.config.json"), "{}\n");
    mkdirSync(join(configured.main, "src"));
    expect(run(["status"], join(configured.main, "src"), { OPENCODE: "1" }).stdout).toMatch(
      NEVER_RAN,
    );
  });

  it("names setup, not the install, when the repository is not set up (lessons defect 2)", () => {
    // Neither a config nor a store: the plugin's fast path keeps it off (D4).
    for (const env of [{ OPENCODE: "1" }, SHELL]) {
      const { stdout } = run(["status"], fakeRepo().main, env);
      expect(stdout).toMatch(/^Status unavailable/);
      expect(stdout).toMatch(NOT_SET_UP);
      expect(stdout).not.toMatch(NEVER_RAN);
      expect(stdout).not.toMatch(UNREGISTERED);
      expect(stdout).not.toContain(INSTALL_SH_COMMAND);
    }
    // A linked worktree of a set-up repository is set up: the store is in the common dir.
    const repo = storeRepo([]);
    const linked = repo.addWorktree("linked");
    expect(run(["status"], linked.root, { OPENCODE: "1" }).stdout).toMatch(NEVER_RAN);
  });

  it("stays silent when any agent of the session is registered, outside OpenCode, and in --json", () => {
    expect(run(["status"], storeRepo([[ROOT, "main"]]).main, SHELL).stdout).not.toMatch(
      /^OpenCode:/m,
    );
    // A child shell names the root session: its child consumer counts too.
    const child = storeRepo([[ROOT, "ses_child"]]);
    const childShell = { ...SHELL, OPENCODE_AGENT_ID: "ses_child" };
    expect(run(["status"], child.main, childShell).stdout).not.toMatch(/^OpenCode:/m);
    const unregistered = storeRepo([]);
    expect(run(["status"], unregistered.main).stdout).not.toMatch(/^OpenCode:/m);
    expect(run(["status"], unregistered.main, { OPENCODE_PID: "1" }).stdout).not.toMatch(
      /^OpenCode:/m,
    );
    const json = run(["status", "--json"], unregistered.main, SHELL);
    expect(() => JSON.parse(json.stdout)).not.toThrow();
    expect(run(["status", "--json"], unregistered.main, { OPENCODE: "1" }).stdout).not.toMatch(
      /OpenCode:/,
    );
  });

  it("names the CLI as the plugin's texts do", () => {
    const cli = "/data/squeal/opencode/0.1.176/dist/cli/squeal.mjs";
    expect(statusCommand(SHELL, cli)).toBe(
      `${shellWord(process.execPath)} --disable-warning=ExperimentalWarning ${cli}`,
    );
    expect(opencodeCliCommand(cli, "/opt/node")).toBe(opencodeCommand(cli, "/opt/node"));
    // Without the plugin's shell, the PATH's squeal.
    expect(statusCommand({ OPENCODE: "1" }, cli)).toBe("squeal");
    expect(statusCommand({}, cli)).toBe("squeal");
    // Codex and Pi shells keep their commands.
    expect(statusCommand({ ...SHELL, CODEX_SESSION_ID: "t" }, cli)).toMatch(/^node /);
    expect(statusCommand({ ...SHELL, PI_SESSION_ID: "p" }, cli)).toBe(
      `${shellWord(process.execPath)} --disable-warning=ExperimentalWarning ${cli}`,
    );
  });
});
