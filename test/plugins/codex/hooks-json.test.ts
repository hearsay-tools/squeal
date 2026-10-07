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
/** As the Claude Code hooks: node:sqlite must not write a warning to a hook's stderr on Node 22. */
const NODE = "node --disable-warning=ExperimentalWarning";

const all = Object.entries(hooksJson.hooks).flatMap(([event, groups]) =>
  groups.flatMap((group) => group.hooks.map((hook) => ({ event, matcher: group.matcher, hook }))),
);

/**
 * Codex's `currentHash` of every handler. Codex runs a plugin hook only while
 * the hash the user trusted equals this one, so a change here means every
 * user must trust the changed hooks again (`/hooks` in the TUI).
 */
const PINNED: Readonly<Record<string, string>> = {
  "session_start:0:0": "sha256:3c90c7d3e66843cbd6f9259f28634223d82e8617aabbdc7f05996fe116460cdc",
  "user_prompt_submit:0:0":
    "sha256:60bd87acc17ba299a0318c36f946bbf94030ed3099976781498b07880c6ae0e4",
  "pre_tool_use:0:0": "sha256:0c132913495a596585c293ba3dc3ee08e28d27884a83274999b617bcd8e91b96",
  "post_tool_use:0:0": "sha256:0c6cd3bc8223b7538d1f39dc491bf8cd61388f2fdcc481910368cef0e9190bf1",
  "stop:0:0": "sha256:f8c8dc32300fba6a3edb5b7e2777162170a8bd42326b17499b67ca2a761f0234",
  "subagent_start:0:0": "sha256:32e6dbd1fa103e891ad039499fce4bcaad9fb57cc45110e65c81387dfa8a333d",
  "subagent_stop:0:0": "sha256:a4a1287ccb38a20484fc59bb7067cd47c8b7e7210dc34664e296848741415aaa",
  "interrupt:0:0": "sha256:6d3a0b166e716f1139a99204e22dcd1d149b435b0ebaaa89c9820702d352fa31",
  "session_end:0:0": "sha256:6e9f03274a16b162ba7f3c16f691e3bc437b9e8eba2c545311a58d23e8e0de89",
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
          `s "$PWD" 2>/dev/null || exit 0; exec ${NODE} "\${PLUGIN_ROOT}/dist/${name}.mjs"`,
        );
      } else {
        expect(hook.command, event).toBe(`${NODE} "\${PLUGIN_ROOT}/dist/${name}.mjs"`);
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
