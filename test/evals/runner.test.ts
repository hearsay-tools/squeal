import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLAUDE_ALLOWED_TOOLS,
  cellEnv,
  codexConfig,
  patchPlugins,
  providerVariables,
  scanForSecrets,
  secretsOf,
  sessionCommand,
  waitForExit,
} from "../../evals/lib/index.mjs";

const dirs: string[] = [];
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "squeal-evals-test-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// Made-up values: the provider is read at run time and never written into this repository.
const REAL_CODEX = [
  'model = "gpt-6.1-sol"',
  'model_provider = "hostproxy"',
  "",
  "[model_providers.hostproxy]",
  'name = "Host proxy"',
  'base_url = "https://proxy.example.internal/v1"',
  'env_key = "HOSTPROXY_API_KEY"',
  "",
  "[mcp_servers.other]",
  'command = "x"',
].join("\n");
const PARENT = {
  PATH: "/usr/bin",
  HOME: "/home/someone",
  GH_TOKEN: "gh-token-value-0123456789",
  HOSTPROXY_API_KEY: "proxy-key-value-0123456789abcdefghijkl",
  ANTHROPIC_AUTH_TOKEN: "anthropic-token-0123456789",
  ANTHROPIC_BASE_URL: "https://claude-proxy.example.internal",
  CLAUDE_CODE_MESSAGING_TOKEN: "messaging-0123456789",
  CEZ_TOOL_TOKEN: "cez-0123456789",
  SSH_AUTH_SOCK: "/tmp/ssh-agent.sock",
};

describe("the cell's environment", () => {
  it("passes only the subject harness's own provider variables", () => {
    const claude = cellEnv(PARENT, "/tmp/cell", providerVariables("claude", PARENT, REAL_CODEX));
    expect(
      Object.keys(claude)
        .filter((k) => k in PARENT)
        .sort(),
    ).toEqual(["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "HOME", "PATH"]);
    expect(claude.HOME).toBe("/tmp/cell/home");
    const codex = cellEnv(PARENT, "/tmp/cell", providerVariables("codex", PARENT, REAL_CODEX));
    expect(
      Object.keys(codex)
        .filter((k) => k in PARENT)
        .sort(),
    ).toEqual(["HOME", "HOSTPROXY_API_KEY", "PATH"]);
    expect(codex.CODEX_HOME).toBe("/tmp/cell/codex");
  });

  it("copies the host's provider block into the scratch Codex config, never a key", () => {
    const config = codexConfig(REAL_CODEX, "gpt-6-luna");
    expect(config).toContain('model_provider = "hostproxy"\nmodel = "gpt-6-luna"');
    expect(config).toContain('[model_providers.hostproxy]\nname = "Host proxy"');
    expect(config).toContain('env_key = "HOSTPROXY_API_KEY"');
    expect(config).not.toContain("mcp_servers");
    expect(config).not.toContain(PARENT.HOSTPROXY_API_KEY);
  });

  it("finds a credential, its last 20 characters or the provider's host in scratch files", () => {
    const secrets = secretsOf(PARENT, REAL_CODEX);
    expect(secrets).toEqual(
      expect.arrayContaining([
        PARENT.GH_TOKEN,
        PARENT.HOSTPROXY_API_KEY.slice(-20),
        "proxy.example.internal",
        "claude-proxy.example.internal",
      ]),
    );
    expect(secrets).not.toContain(PARENT.SSH_AUTH_SOCK);
    const d = scratch();
    mkdirSync(join(d, "home/.claude"), { recursive: true });
    writeFileSync(
      join(d, "home/.claude.json"),
      `{"approved":["${PARENT.HOSTPROXY_API_KEY.slice(-20)}"]}`,
    );
    writeFileSync(join(d, "home/.claude/clean.json"), "{}");
    expect(scanForSecrets([d], secrets)).toEqual([
      { path: join(d, "home/.claude.json"), secrets: 1 },
    ]);
  });
});

describe("sessionCommand", () => {
  it("pins the effort in both harnesses and lets Claude Code run node", () => {
    const [claude, cargs] = sessionCommand({
      harness: "claude",
      prompt: "p",
      model: "claude-haiku-5-5",
      effort: "medium",
      pluginDir: "/pin/cc",
    });
    expect(claude).toBe("claude");
    expect(cargs.slice(cargs.indexOf("--effort"), cargs.indexOf("--effort") + 2)).toEqual([
      "--effort",
      "medium",
    ]);
    expect(cargs).toContain("--plugin-dir");
    expect(CLAUDE_ALLOWED_TOOLS).toContain("Bash(node:*)");
    const [codex, xargs] = sessionCommand({
      harness: "codex",
      prompt: "p",
      model: "gpt-6-luna",
      effort: "medium",
      pluginDir: null,
    });
    expect(codex).toBe("codex");
    expect(xargs).toContain('model_reasoning_effort="medium"');
  });
});

describe("patchPlugins", () => {
  const plugins = () => {
    const d = scratch();
    for (const p of ["claude-code", "codex"]) {
      mkdirSync(join(d, p, "dist/hooks"), { recursive: true });
      writeFileSync(join(d, p, "dist/hooks/a.mjs"), 'const s = "Run tests yourself.";');
    }
    return d;
  };

  it("replaces every match in the named plugins' bundles and records the count", () => {
    const d = plugins();
    const applied = patchPlugins(d, {
      patch: [
        { files: "plugins/*/dist/**/*.mjs", find: "yourself.", replace: "yourself!", min: 2 },
      ],
    });
    expect(applied).toEqual([{ find: "yourself.", count: 2 }]);
    expect(readFileSync(join(d, "codex/dist/hooks/a.mjs"), "utf8")).toContain("yourself!");
  });

  it("fails loudly when a patch matches fewer times than its minimum", () => {
    const d = plugins();
    expect(() =>
      patchPlugins(d, {
        patch: [{ files: "plugins/codex/dist/**/*.mjs", find: "yourself.", replace: "x", min: 2 }],
      }),
    ).toThrow(/matched 1 times, expected at least 2/);
    expect(() =>
      patchPlugins(d, {
        patch: [{ files: "plugins/*/dist/**/*.mjs", find: "moved", replace: "x" }],
      }),
    ).toThrow(/matched 0 times/);
  });
});

describe("waitForExit", () => {
  it("waits for a pid that exits, and signals one that does not", async () => {
    const quick = spawn(process.execPath, ["-e", "setTimeout(() => {}, 200)"]);
    const stuck = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
    const [q, s] = await waitForExit([quick.pid ?? 0, stuck.pid ?? 0], 1000);
    expect(q?.signal).toBeNull();
    expect(s?.signal).toBe("SIGTERM");
  });
});
