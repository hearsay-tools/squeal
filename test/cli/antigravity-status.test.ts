import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ANTIGRAVITY_INSTALL_COMMAND } from "../../src/cli/antigravity/install.js";
import { type CliIo, main } from "../../src/cli/main.js";
import { statusCommand } from "../../src/cli/status-command.js";
import { runtimeDir } from "../harness/bundle-helpers.js";
import { appendRevisions, fakeRepo, seedStore } from "../status/helpers.js";

/* Spec 024 D6 and goal 8: `squeal status` in an Antigravity shell. */

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

function storeRepo(sessions: string[]) {
  const repo = fakeRepo();
  const store = seedStore(repo);
  appendRevisions(store, repo.mainId, 1, { head: null, dirty: false });
  for (const sessionId of sessions) {
    store.consumers.register({ worktreeId: repo.mainId, sessionId, agentId: "main" }, 1);
  }
  store.close();
  return repo;
}

/** A HOME whose `~/.gemini/config/` holds the plugin at `version`, and `config` as `config.json`. */
function geminiHome(version: string | null, config?: unknown): string {
  const home = join(runtimeDir(), `agy-home-${Math.random().toString(36).slice(2)}`);
  const plugin = join(home, ".gemini", "config", "plugins", "squeal");
  mkdirSync(plugin, { recursive: true });
  if (version !== null) writeFileSync(join(plugin, "plugin.json"), JSON.stringify({ version }));
  if (config !== undefined) {
    writeFileSync(join(home, ".gemini", "config", "config.json"), JSON.stringify(config));
  }
  return home;
}

const ID = "11111111-2222-4333-8444-555555555555";
const LINE = new RegExp(
  `^Antigravity: no Squeal consumer is registered for this conversation in this worktree \\(ANTIGRAVITY_CONVERSATION_ID ${ID}\\)\\. Either Squeal's hooks do not run in it, or none has registered it yet: .*the next prompt does\\.(.*)$`,
  "m",
);

describe("squeal status in an Antigravity shell (spec 024 D6)", () => {
  it("adds the line with the install command when the conversation has no consumer", () => {
    const repo = storeRepo(["other-conversation"]);
    const env = { ANTIGRAVITY_CONVERSATION_ID: ID, HOME: geminiHome(null) };
    const { code, stdout } = run(["status"], repo.main, env);
    expect(code).toBe(0);
    expect(stdout).toMatch(/^Revision: 1/);
    expect(LINE.exec(stdout)?.[1]).toBe(
      ` No Squeal plugin is in ~/.gemini/config/plugins/squeal: install it with ${ANTIGRAVITY_INSTALL_COMMAND}, then start Antigravity again.`,
    );
    expect(ANTIGRAVITY_INSTALL_COMMAND).toMatch(/install\.sh \| sh -s -- --antigravity$/);
  });

  it("adds it when no store exists either", () => {
    const env = { ANTIGRAVITY_CONVERSATION_ID: ID, HOME: geminiHome(null) };
    const { stdout } = run(["status"], fakeRepo().main, env);
    expect(stdout).toMatch(/^Status unavailable/);
    expect(stdout).toMatch(LINE);
  });

  it("says when the plugin is disabled and names the install command for installed plugins too (review 0.1.603 S1)", () => {
    const repo = storeRepo([]);
    const disabled = geminiHome("0.1.602", { plugins: { squeal: { enabled: false } } });
    const off = run(["status"], repo.main, { ANTIGRAVITY_CONVERSATION_ID: ID, HOME: disabled });
    expect(LINE.exec(off.stdout)?.[1]).toBe(
      ` Its hooks do not run: the Squeal plugin is disabled in ~/.gemini/config/config.json (agy plugin enable squeal enables it); to reinstall, run ${ANTIGRAVITY_INSTALL_COMMAND}.`,
    );
    const enabled = geminiHome("0.1.602", { plugins: { squeal: { enabled: true } } });
    const on = run(["status"], repo.main, { ANTIGRAVITY_CONVERSATION_ID: ID, HOME: enabled });
    expect(LINE.exec(on.stdout)?.[1]).toBe(
      ` If the hooks do not run, reinstall the plugin with ${ANTIGRAVITY_INSTALL_COMMAND}, then start Antigravity again.`,
    );
  });

  it("stays silent when the conversation is registered, outside Antigravity, and in --json", () => {
    const env = { ANTIGRAVITY_CONVERSATION_ID: ID, HOME: geminiHome(null) };
    const registered = storeRepo([ID]);
    expect(run(["status"], registered.main, env).stdout).not.toMatch(/^Antigravity:/m);
    const unregistered = storeRepo([]);
    expect(run(["status"], unregistered.main).stdout).not.toMatch(/^Antigravity:/m);
    const empty = { ANTIGRAVITY_CONVERSATION_ID: "" };
    expect(run(["status"], unregistered.main, empty).stdout).not.toMatch(/^Antigravity:/m);
    const json = run(["status", "--json"], unregistered.main, env);
    expect(() => JSON.parse(json.stdout)).not.toThrow();
  });
});

describe("statusCommand in an Antigravity shell (spec 024 D6)", () => {
  const AGY = { ANTIGRAVITY_CONVERSATION_ID: ID };

  it("names the installed CLI with node, since squeal is not on the PATH", () => {
    const cli = "/opt/u/.gemini/config/plugins/squeal/dist/cli/squeal.mjs";
    expect(statusCommand(AGY, cli)).toBe(`node --disable-warning=ExperimentalWarning ${cli}`);
    expect(statusCommand({ ...AGY, ANTIGRAVITY_CONVERSATION_ID: "" }, cli)).toBe("squeal");
  });

  it("names the launcher beside a retained copy in the plugin data directory", () => {
    const data = join(runtimeDir(), `agy-data-${Math.random().toString(36).slice(2)}`);
    const cli = join(data, "versions", "0.1.602", "dist", "cli", "squeal.mjs");
    mkdirSync(join(data, "bin"), { recursive: true });
    writeFileSync(join(data, "bin", "squeal"), "#!/bin/sh\n");
    expect(statusCommand(AGY, cli)).toBe(join(data, "bin", "squeal"));
  });
});
