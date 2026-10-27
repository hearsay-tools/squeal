import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";
import { REPO_ROOT } from "../../src/harness/claude-code/build.js";
import { runCodexHook } from "../../src/harness/codex/index.js";
import { runtimeDir } from "../harness/bundle-helpers.js";
import { codexRecorded } from "../harness/codex/helpers.js";
import { appendRevisions, fakeRepo, seedStore } from "../status/helpers.js";
import { fixedPluginAt } from "./codex-launcher-fixture.js";

/* Spec 002 D1, D6 and goal 8: `squeal init --harness codex` and the Codex status line. */

/** tsx's loader by URL, since the CLI runs in a directory with no node_modules. */
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

function run(argv: string[], cwd: string, env: Record<string, string> = {}) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    cwd,
    env,
  };
  const code = main(argv, io);
  return { code, stdout, stderr };
}

/** Every file under `dir`, relative, with its content. */
function snapshot(dir: string): Record<string, string> {
  if (!existsSync(dir)) return {};
  const files: Record<string, string> = {};
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files[path.slice(dir.length)] = readFileSync(path, "utf8");
  }
  return files;
}

describe("squeal init --harness codex", () => {
  it("writes squeal.config.json, prints the plugin commands and the trust step, and no Claude settings", () => {
    const repo = fakeRepo();
    const { code, stdout, stderr } = run(["init", "--harness", "codex"], repo.main);
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(JSON.parse(readFileSync(join(repo.main, "squeal.config.json"), "utf8"))).toEqual(
      DEFAULT_POLICY,
    );
    expect(existsSync(join(repo.main, ".claude"))).toBe(false);
    expect(stdout).toContain("wrote squeal.config.json");
    expect(stdout).toContain("codex plugin marketplace add hearsay-tools/marketplace\n");
    expect(stdout).toContain("codex plugin add squeal@hearsay\n");
    expect(stdout).toContain("trust the hooks of squeal@hearsay");
    expect(stdout).toContain("/hooks");
  });

  it("seeds nodeTest from the repository's node --test scripts, as squeal init does (spec 003 D1)", () => {
    const repo = fakeRepo();
    writeFileSync(
      join(repo.main, "package.json"),
      `${JSON.stringify({ scripts: { "test:unit": "node --import tsx --test test/unit/*.test.ts" } })}\n`,
    );
    const { code, stdout } = run(["init", "--harness", "codex"], repo.main);
    expect(code).toBe(0);
    const config = JSON.parse(readFileSync(join(repo.main, "squeal.config.json"), "utf8"));
    expect(config.nodeTest).toEqual([
      { name: "test:unit", argv: ["--import", "tsx"], include: ["test/unit/*.test.ts"] },
    ]);
    expect(stdout).toContain("test:unit");
  });

  it("keeps an existing squeal.config.json", () => {
    const repo = fakeRepo();
    writeFileSync(join(repo.main, "squeal.config.json"), "{}\n");
    const { code, stdout } = run(["init", "--harness=codex"], repo.main);
    expect(code).toBe(0);
    expect(stdout).toContain("kept squeal.config.json");
    expect(readFileSync(join(repo.main, "squeal.config.json"), "utf8")).toBe("{}\n");
  });

  // Two CLI processes, each compiling the source through tsx: about a second
  // alone, past the 5 s default under a loaded full suite (task 001-309).
  it("touches nothing under a scratch HOME/.codex or CODEX_HOME, run as the CLI", () => {
    const repo = fakeRepo();
    const home = runtimeDir();
    const codexHome = join(home, "codex-home");
    mkdirSync(join(home, ".codex"));
    mkdirSync(codexHome);
    writeFileSync(join(home, ".codex", "config.toml"), 'model = "x"\n');
    writeFileSync(join(codexHome, "config.toml"), 'model = "y"\n');
    // A fixed plugin in the scratch cache, so the launcher config has one to name (002-31).
    fixedPluginAt(join(codexHome, "plugins", "cache", "hearsay", "squeal", "1.0.0"));
    const before = snapshot(home);
    const env = { PATH: process.env.PATH ?? "", HOME: home, CODEX_HOME: codexHome };
    const cli = (args: string[]) =>
      spawnSync(
        process.execPath,
        [
          "--disable-warning=ExperimentalWarning",
          "--import",
          TSX,
          join(REPO_ROOT, "src/cli/index.ts"),
          "init",
          "--harness",
          "codex",
          ...args,
        ],
        { cwd: repo.main, env, encoding: "utf8" },
      );
    const first = cli([]);
    expect(first.stderr).toBe("");
    expect(first.status).toBe(0);
    expect(cli(["--print-launcher-config"]).status).toBe(0);
    expect(snapshot(home)).toEqual(before);
    expect(existsSync(join(repo.main, "squeal.config.json"))).toBe(true);
  }, 60_000);

  it("rejects an unknown harness, a stray argument and the launcher flag without codex", () => {
    const repo = fakeRepo();
    for (const args of [
      ["--harness", "pi"],
      ["--harness"],
      ["--harness", "codex", "--force"],
      ["--print-launcher-config"],
    ]) {
      const { code, stderr } = run(["init", ...args], repo.main);
      expect(code, args.join(" ")).toBe(2);
      expect(stderr, args.join(" ")).toMatch(/^squeal init: takes no arguments but those below; /);
    }
    expect(existsSync(join(repo.main, "squeal.config.json"))).toBe(false);
  });

  it("keeps the Claude Code behaviour under --harness claude-code", () => {
    const repo = fakeRepo();
    expect(run(["init", "--harness", "claude-code"], repo.main).code).toBe(0);
    expect(existsSync(join(repo.main, ".claude", "settings.json"))).toBe(true);
  });
});

describe("squeal status in a Codex shell (spec 002 D6)", () => {
  const LINE =
    /^Codex: no Squeal consumer is registered for this session in this worktree \(CODEX_SESSION_ID thread-1\)\..*\/hooks/m;
  /** A claim the line cannot know: the hooks may have run before the store existed (S1). */
  const FALSE_CAUSE = /have not run|did not run|never ran/;

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

  it("adds the line when CODEX_SESSION_ID has no consumer", () => {
    const repo = storeRepo(["thread-other"]);
    const { code, stdout } = run(["status"], repo.main, { CODEX_SESSION_ID: "thread-1" });
    expect(code).toBe(0);
    expect(stdout).toMatch(/^Revision: 1/);
    expect(stdout).toMatch(LINE);
  });

  it("adds it when no store exists either", () => {
    const { stdout } = run(["status"], fakeRepo().main, { CODEX_SESSION_ID: "thread-1" });
    expect(stdout).toMatch(/^Status unavailable/);
    expect(stdout).toMatch(LINE);
  });

  it("names no false cause after hooks ran in a first session with no store (review S1)", async () => {
    const repo = fakeRepo();
    writeFileSync(join(repo.main, "squeal.config.json"), "{}\n");
    const session = { session_id: "thread-1" };
    const deps = { env: {}, ensureDaemon: async () => "alive" as const };
    for (const [hook, fixture, extra] of [
      ["session-start", "session-start", {}],
      ["user-prompt-submit", "user-prompt-submit", {}],
      ["pre-tool-use", "pre-tool-use", { tool_name: "Bash" }],
    ] as const) {
      const input = codexRecorded("exec", fixture, repo.main, { ...session, ...extra });
      expect(await runCodexHook(hook, input, deps)).toEqual({ stdout: "", stderr: "" });
    }
    // The daemon has created the store by the time the agent runs `squeal status`.
    seedStore(repo).close();
    const { stdout } = run(["status"], repo.main, { CODEX_SESSION_ID: "thread-1" });
    expect(stdout).toMatch(LINE);
    expect(stdout).not.toMatch(FALSE_CAUSE);
  });

  it("stays silent when the session is registered, outside Codex, and in --json", () => {
    const registered = storeRepo(["thread-1"]);
    expect(run(["status"], registered.main, { CODEX_SESSION_ID: "thread-1" }).stdout).not.toMatch(
      /Codex/,
    );
    const unregistered = storeRepo([]);
    expect(run(["status"], unregistered.main).stdout).not.toMatch(/Codex/);
    const json = run(["status", "--json"], unregistered.main, { CODEX_SESSION_ID: "thread-1" });
    expect(() => JSON.parse(json.stdout)).not.toThrow();
  });
});
