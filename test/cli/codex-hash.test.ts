import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CODEX_HASH_VERSION,
  type HooksFile,
  hookHashes,
  LAUNCHER_KEY_SOURCE,
} from "../../src/cli/codex/hash.js";
import { REPO_ROOT } from "../../src/harness/claude-code/build.js";

/*
 * Spec 002 D1: the trust hash is a port of an undocumented Codex format, so
 * it is pinned against what Codex itself listed. `logs/q3-trust.txt` is the
 * `hooks/list` of Codex 0.160.1 for the plugin `probes/wave-0-checks/bin/mkrepo.sh`
 * writes; the declarations below are that plugin's `hooks.json`, rebuilt.
 */
const LOG = join(
  REPO_ROOT,
  "docs/specifications/002-codex-adapter/research/probes/wave-0-checks/logs/q3-trust.txt",
);
const KEY_SOURCE = "squeal-codex@squeal:hooks/hooks.json";

const L = `sh "\${PLUGIN_ROOT}/hooks/log.sh"`;
const probe = (postToolUse: string): HooksFile => ({
  hooks: {
    SessionStart: [{ hooks: [{ type: "command", command: `${L} SessionStart`, timeout: 2 }] }],
    UserPromptSubmit: [
      { hooks: [{ type: "command", command: `${L} UserPromptSubmit`, timeout: 2 }] },
    ],
    PreToolUse: [
      { matcher: "*", hooks: [{ type: "command", command: `${L} PreToolUse`, timeout: 2 }] },
      {
        matcher: "apply_patch",
        hooks: [
          {
            type: "command",
            command: `${L} PreToolUse-patch`,
            timeout: 2,
            statusMessage: "squeal",
          },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: "*",
        hooks: [
          {
            type: "command",
            command: `${L} ${postToolUse}`,
            timeout: 2,
            additionalContextLimit: 0,
          },
        ],
      },
    ],
    Stop: [{ matcher: "ignored", hooks: [{ type: "command", command: `${L} Stop`, timeout: 2 }] }],
    SubagentStart: [{ hooks: [{ type: "command", command: `${L} SubagentStart` }] }],
    SessionEnd: [{ hooks: [{ type: "command", command: `${L} SessionEnd`, timeout: 3 }] }],
    Interrupt: [{ hooks: [{ type: "command", command: `${L} Interrupt`, timeout: 9 }] }],
  },
});

/** `key -> currentHash` of the lines Codex listed in one section of the log. */
function listed(section: string): Map<string, string> {
  const text = readFileSync(LOG, "utf8");
  const start = text.indexOf(`== ${section}`);
  const end = text.indexOf("\n== ", start + 1);
  const lines = text.slice(start, end === -1 ? undefined : end).split("\n");
  const found = new Map<string, string>();
  for (const line of lines) {
    const [key, hash, status] = line.split(" ");
    if (key?.startsWith(KEY_SOURCE) && status !== undefined) found.set(key, hash ?? "");
  }
  return found;
}

const computed = (file: HooksFile) =>
  new Map(hookHashes(file, KEY_SOURCE).map(({ key, hash }) => [key, hash]));

describe(`the trust hash port (Codex ${CODEX_HASH_VERSION})`, () => {
  it("reproduces every currentHash Codex listed after install", () => {
    const recorded = listed("hooks/list after install");
    expect(recorded.size).toBe(9);
    expect(computed(probe("PostToolUse"))).toEqual(recorded);
  });

  it("reproduces the hash of the one handler Codex marked modified after a command change", () => {
    const recorded = listed("change one hook command");
    const changed = computed(probe("PostToolUse-v2"));
    expect(recorded.size).toBe(9);
    expect(changed).toEqual(recorded);
    expect(changed.get(`${KEY_SOURCE}:post_tool_use:0:0`)).toBe(
      "sha256:02344b1bc27040fd4c71edd63fcff9aca0dcf7cfb35edffcf00caa195f8a9a8e",
    );
  });

  it("names keys by event label, group and handler position", () => {
    expect([...computed(probe("PostToolUse")).keys()]).toContain(`${KEY_SOURCE}:pre_tool_use:1:0`);
  });
});

describe("launcher hooks (thread/start config)", () => {
  // `probes/wave-0-checks/bin/q2-appserver.sh`: two hooks declared in `thread/start`
  // `config` and trusted only by these hashes, which Codex then ran.
  const B =
    "/home/agent/projects/squeal/.ai/cezar/worktrees/fdeedfc7-56f7-493a-82c7-4c4ce46afa71/docs/specifications/002-codex-adapter/research/probes/wave-0-checks/bin";
  const shellProbe =
    'echo "$0|$-|$(shopt -q login_shell 2>/dev/null && echo login || echo non-login)|launcher" >> /tmp/w0c/logs/q2-shell.txt; ' +
    `sh ${B}/hook.sh launcher-SessionStart`;

  it("reproduces the recorded launcher hashes under the session-flags key source", () => {
    const recorded = readFileSync(LOG.replace("q3-trust.txt", "q2-launcher-hashes.txt"), "utf8")
      .trim()
      .split("\n")
      .map((line) => line.split(" "));
    const file: HooksFile = {
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: shellProbe, timeout: 2 }] }],
        PostToolUse: [
          {
            matcher: "*",
            hooks: [
              { type: "command", command: `sh ${B}/hook.sh launcher-PostToolUse`, timeout: 2 },
            ],
          },
        ],
      },
    };
    expect(hookHashes(file, LAUNCHER_KEY_SOURCE).map(({ key, hash }) => [key, hash])).toEqual(
      recorded,
    );
  });
});
