import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDist } from "../../src/harness/build.js";
import {
  CLAUDE_CODE_PLUGIN,
  PLUGIN_DIR,
  rootVersion,
} from "../../src/harness/claude-code/build.js";
import { PRIMER } from "../../src/harness/shared/primer.js";
import { liveSocket, runBundle, runtimeDir } from "./bundle-helpers.js";
import { recorded, squealRepo } from "./helpers.js";

/*
 * Spec 005 D3 as amended 2026-10-21 (row 005-73, `research/plugin-cache-cleanup.md`
 * Recommendation, test 6): Claude Code marks an old version orphaned and
 * deletes it 14 days later, so it needs no copy. With its layout, an
 * `.orphaned_at` in the older version and nothing deleted, its hooks copy
 * nothing into the plugin data directory, its primer names `squeal`, and the
 * `squeal` on its Bash tool's PATH runs the bundle beside it.
 */

let dir = "";
let cache = "";
const version = rootVersion();
const OLDER = "0.1.1";
beforeAll(async () => {
  dir = mkdtempSync("/tmp/sq-cc-layout-");
  cache = join(dir, "home", ".claude", "plugins", "cache", "hearsay", "squeal");
  const root = join(cache, version);
  cpSync(PLUGIN_DIR, root, {
    recursive: true,
    filter: (from) => !from.startsWith(join(PLUGIN_DIR, "dist")),
  });
  await buildDist(CLAUDE_CODE_PLUGIN, join(root, "dist"));
  // The version an update left: orphaned, still whole.
  cpSync(root, join(cache, OLDER), { recursive: true });
  writeFileSync(join(cache, OLDER, ".orphaned_at"), `${Date.now()}`);
}, 120_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("Claude Code's layout is unchanged by the plugin data copies (005-73)", () => {
  it("test 6: its hooks copy nothing, its primer names squeal, and squeal runs its own bundle", async () => {
    const root = join(cache, version);
    const data = join(dir, "home", ".claude", "plugins", "data", "squeal-hearsay");
    const r = squealRepo();
    r.apply(r.pass());
    const env = {
      XDG_RUNTIME_DIR: runtimeDir(),
      HOME: join(dir, "home"),
      CLAUDE_PLUGIN_ROOT: root,
      CLAUDE_PLUGIN_DATA: data,
      // Codex's names too: a Claude Code hook reads neither.
      PLUGIN_ROOT: root,
      PLUGIN_DATA: data,
    };
    await liveSocket(join(env.XDG_RUNTIME_DIR, `squeal-${r.worktreeId}.sock`));
    const start = await runBundle(
      "session-start",
      recorded("session-start", r.root),
      env,
      join(root, "dist"),
    );
    expect(start).toMatchObject({ code: 0, stderr: "" });
    const text = (JSON.parse(start.stdout) as { hookSpecificOutput: { additionalContext: string } })
      .hookSpecificOutput.additionalContext;
    expect(text.endsWith(`\n\n${PRIMER}`)).toBe(true);
    expect(text).not.toContain(data);
    expect(existsSync(data)).toBe(false);

    const run = (cwd: string) =>
      spawnSync("bash", ["-c", "squeal --version"], {
        cwd,
        env: { PATH: `${join(cwd, "bin")}:${process.env.PATH ?? ""}`, HOME: env.HOME },
        encoding: "utf8",
      });
    expect(run(root)).toMatchObject({ status: 0, stdout: `${version}\n`, stderr: "" });
    expect(run(join(cache, OLDER))).toMatchObject({ status: 0, stdout: `${version}\n` });
    expect(existsSync(join(cache, OLDER, "dist", "cli", "squeal.mjs"))).toBe(true);
  });
});
