import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CODEX_HASH_VERSION,
  type HooksFile,
  hookHashes,
  PLUGIN_KEY_SOURCE,
} from "../../../src/cli/codex/hash.js";
import { REPO_ROOT } from "../../../src/harness/claude-code/build.js";

/*
 * Spec 002 D1 and the 002-12/002-13 contract in `tasks/wave-1.md`: nine
 * entries, one-string commands with `${PLUGIN_ROOT}` literal, 2 s budgets
 * (Interrupt and SessionEnd 3 s), the per-tool hooks behind the `$PWD` fast
 * path of D4.
 */
const PLUGIN = join(REPO_ROOT, "plugins/codex");
const readJson = (path: string): unknown => JSON.parse(readFileSync(join(PLUGIN, path), "utf8"));
const hooksJson = readJson("hooks/hooks.json") as HooksFile;

const all = Object.entries(hooksJson.hooks).flatMap(([event, groups]) =>
  groups.flatMap((group) => group.hooks.map((hook) => ({ event, matcher: group.matcher, hook }))),
);

/**
 * Codex's `currentHash` of every handler. Codex runs a plugin hook only while
 * the hash the user trusted equals this one, so a change here means every
 * user must trust the changed hooks again (`/hooks` in the TUI).
 */
const PINNED: Readonly<Record<string, string>> = {
  "session_start:0:0": "sha256:7e93ecb03dc286c33b94dbb4d02aac267aeb7e7774dd38902e2811037aae7889",
  "user_prompt_submit:0:0":
    "sha256:99d0a808c4d10b0fde56f0b2643d44c334751a713b33f51f552689f2c2932cc3",
  "pre_tool_use:0:0": "sha256:a6ba49607b132b3e6c8d82b7a34b9007ba31956bd79903cdc846aceedcd67aa8",
  "post_tool_use:0:0": "sha256:0d223fa997899ca3d134252818a7a63c10724ab73147fa852a42060076adda93",
  "stop:0:0": "sha256:b12e266e37eed5c3d357bedb1033e2597dab78086956aa4f226d79d52944d57b",
  "subagent_start:0:0": "sha256:381c9dd53469eefbffc0e212f6d1b31b3662a77fbfd5f6f2b8d60a252440a060",
  "subagent_stop:0:0": "sha256:dfaf3d7dedb0ff43021702d23222664f722e1dc58d0c7ad55b4ad9f6b4565c95",
  "interrupt:0:0": "sha256:52408cd2f6e874fded60beb198998db543bece6021995c5c58ee3572f0dce301",
  "session_end:0:0": "sha256:d1a5f7bb8570fe98e5275cb18587be495f74dcca39845c4b2339448236822336",
};

describe("plugins/codex/hooks/hooks.json", () => {
  it("declares exactly the contract's nine entries with their budgets", () => {
    const table = all.map(({ event, matcher, hook }) => {
      const bundle = /"\$\{PLUGIN_ROOT\}\/dist\/([a-z-]+\.mjs)"$/.exec(hook.command)?.[1];
      return [event, matcher ?? "", bundle, hook.timeout].join(" ");
    });
    expect(table).toEqual([
      "SessionStart  session-start.mjs 2",
      "UserPromptSubmit  user-prompt-submit.mjs 2",
      "PreToolUse * pre-tool-use.mjs 2",
      "PostToolUse * post-tool-use.mjs 2",
      "Stop  stop.mjs 2",
      "SubagentStart  subagent-start.mjs 2",
      "SubagentStop  subagent-stop.mjs 2",
      "Interrupt  interrupt.mjs 3",
      "SessionEnd  session-end.mjs 3",
    ]);
  });

  it("gives every handler one command string, no args, and an unexpanded PLUGIN_ROOT", () => {
    for (const { event, hook } of all) {
      expect(Object.keys(hook).sort(), event).toEqual(["command", "timeout", "type"]);
      expect(hook.type, event).toBe("command");
      expect(hook.command, event).toContain(`"\${PLUGIN_ROOT}/dist/`);
      expect(hook.command, event).not.toMatch(/CLAUDE_/);
    }
  });

  it("runs the per-tool hooks behind the $PWD fast path and the rest as plain node", () => {
    for (const { event, hook } of all) {
      const name = /dist\/([a-z-]+)\.mjs/.exec(hook.command)?.[1];
      if (event === "PreToolUse" || event === "PostToolUse") {
        expect(hook.command, event).toMatch(/^s\(\) \{ /);
        expect(hook.command, event).toContain(
          `s "$PWD" 2>/dev/null || exit 0; exec node "\${PLUGIN_ROOT}/dist/${name}.mjs"`,
        );
      } else {
        expect(hook.command, event).toBe(`node "\${PLUGIN_ROOT}/dist/${name}.mjs"`);
      }
    }
  });

  it(`keeps the trust hashes users trusted (Codex ${CODEX_HASH_VERSION})`, () => {
    const actual = Object.fromEntries(
      hookHashes(hooksJson, PLUGIN_KEY_SOURCE).map(({ key, hash }) => [
        key.slice(PLUGIN_KEY_SOURCE.length + 1),
        hash,
      ]),
    );
    expect(
      actual,
      "a changed hooks.json declaration changes its trust hash: every user must trust that hook " +
        "again with /hooks in Codex. If the change is intended, update PINNED and say so in the release notes",
    ).toEqual(PINNED);
  });
});

describe("the Codex plugin package", () => {
  it("names the plugin squeal at the root version, in a marketplace of its own", () => {
    const manifest = readJson(".codex-plugin/plugin.json") as { name: string; version: string };
    const root = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      version: string;
    };
    expect(manifest.name).toBe("squeal");
    expect(manifest.version).toBe(root.version);
    const marketplace = JSON.parse(
      readFileSync(join(REPO_ROOT, ".agents/plugins/marketplace.json"), "utf8"),
    ) as { name: string; plugins: { name: string; source: unknown }[] };
    expect(marketplace.name).toBe("squeal");
    expect(marketplace.plugins.map((p) => [p.name, p.source])).toEqual([
      ["squeal", "./plugins/codex"],
    ]);
  });

  it("leaves the Claude Code marketplace with its one entry", () => {
    const claude = JSON.parse(
      readFileSync(join(REPO_ROOT, ".claude-plugin/marketplace.json"), "utf8"),
    ) as { plugins: { source: string }[] };
    expect(claude.plugins.map((p) => p.source)).toEqual(["./plugins/claude-code"]);
  });
});
