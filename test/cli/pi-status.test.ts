import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { INSTALL_SH_COMMAND, piCliCommand, piInstallCommand } from "../../src/cli/pi/status.js";
import { statusCommand } from "../../src/cli/status-command.js";
import { shellWord } from "../../src/core/text.js";
import { piCommand } from "../../src/harness/pi/worker.js";
import { runtimeDir } from "../harness/bundle-helpers.js";
import { appendRevisions, fakeRepo, seedStore } from "../status/helpers.js";

/* Spec 009 D7 and goal 8: `squeal status` in a Pi shell. */

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

describe("squeal status in a Pi shell (spec 009 D7)", () => {
  const LINE =
    /^Pi: no Squeal consumer is registered for this session in this worktree \(PI_SESSION_ID 0199-pi\)\. Either the Squeal Pi extension is not loaded in it, or it has not registered the session yet: .* install it with (.*), then start Pi again\.$/m;
  const PI = { PI_SESSION_ID: "0199-pi" };

  it("adds the line, with the install command, when PI_SESSION_ID has no consumer", () => {
    const repo = storeRepo(["0199-other"]);
    const { code, stdout } = run(["status"], repo.main, PI);
    expect(code).toBe(0);
    expect(stdout).toMatch(/^Revision: 1/);
    // This CLI is not a Pi package's, so the command is install.sh's.
    expect(LINE.exec(stdout)?.[1]).toBe(INSTALL_SH_COMMAND);
  });

  it("adds it when no store exists either", () => {
    const { stdout } = run(["status"], fakeRepo().main, PI);
    expect(stdout).toMatch(/^Status unavailable/);
    expect(stdout).toMatch(LINE);
  });

  it("stays silent when the session is registered, outside Pi, and in --json", () => {
    const registered = storeRepo(["0199-pi"]);
    expect(run(["status"], registered.main, PI).stdout).not.toMatch(/^Pi:/m);
    const unregistered = storeRepo([]);
    expect(run(["status"], unregistered.main).stdout).not.toMatch(/^Pi:/m);
    expect(run(["status"], unregistered.main, { PI_SESSION_ID: "" }).stdout).not.toMatch(/^Pi:/m);
    const json = run(["status", "--json"], unregistered.main, PI);
    expect(() => JSON.parse(json.stdout)).not.toThrow();
  });

  it("names pi install of the package when the CLI is the Pi package's", () => {
    const root = join(runtimeDir(), "squeal pi", "0.1.170");
    mkdirSync(join(root, "dist", "cli"), { recursive: true });
    const cli = join(root, "dist", "cli", "squeal.mjs");
    expect(piInstallCommand(cli)).toBe(INSTALL_SH_COMMAND);
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "squeal", version: "1" }));
    expect(piInstallCommand(cli)).toBe(INSTALL_SH_COMMAND);
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "squeal-pi" }));
    expect(piInstallCommand(cli)).toBe(`pi install '${root}'`);
  });

  it("names the CLI as the extension's texts do, since squeal is not on a Pi agent's PATH", () => {
    const cli = "/data/squeal/pi/0.1.170/dist/cli/squeal.mjs";
    expect(statusCommand(PI, cli)).toBe(
      `${shellWord(process.execPath)} --disable-warning=ExperimentalWarning ${cli}`,
    );
    expect(piCliCommand(cli, "/opt/node")).toBe(piCommand(cli, "/opt/node"));
    expect(statusCommand({}, cli)).toBe("squeal");
    // A Codex shell keeps the Codex command.
    expect(statusCommand({ ...PI, CODEX_SESSION_ID: "t" }, cli)).toMatch(/^node /);
  });
});
