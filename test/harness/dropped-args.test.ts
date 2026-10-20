import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../src/harness/claude-code/build.js";
import { runtimeDir } from "./bundle-helpers.js";

/*
 * Spec 012 CC1 as amended 2026-10-20 (task 012-01). Cursor CLI imports this
 * plugin, keeps each entry's `command` and drops its `args`
 * (research/cursor-dropped-args.md). It runs that command through a shell with
 * CLAUDE_PLUGIN_ROOT set and the payload on stdin, written directly or as a
 * heredoc, and exit 2 blocks the tool. So every command on its own runs
 * nothing, reads none of its stdin as code, and exits 0 silently.
 */

const PLUGIN = join(REPO_ROOT, "plugins/claude-code");
const PROBE = join(
  REPO_ROOT,
  "docs/specifications/012-claude-code-adapter/research/probes/cursor-dropped-args",
);
const hooksJson = JSON.parse(readFileSync(join(PLUGIN, "hooks/hooks.json"), "utf8")) as {
  hooks: Record<string, { hooks: { command: string }[] }[]>;
};
const entries = Object.entries(hooksJson.hooks).flatMap(([event, groups]) =>
  groups.flatMap((g, i) => g.hooks.map((h, j) => ({ name: `${event} ${i}:${j}`, ...h }))),
);

interface Run {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
}

/** `sh -c <script>` with `stdin`, from `cwd`, with only the environment Cursor gives a hook. */
function shell(script: string, stdin: string, cwd: string, root = PLUGIN): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", script], {
      cwd,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: cwd,
        CLAUDE_PLUGIN_ROOT: root,
        CURSOR_PLUGIN_ROOT: root,
        CLAUDE_PROJECT_DIR: cwd,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => (stdout += b.toString("utf8")));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code }));
    // A command that exits before it reads its stdin closes the pipe early.
    child.stdin.on("error", () => {});
    child.stdin.end(stdin);
  });
}

/** Cursor's two transports: the payload written to stdin, or `<command> <<'CURSOR_HOOK_EOF'`. */
const FORMS = {
  stdin: (command: string, payload: string, cwd: string, root?: string) =>
    shell(command, payload, cwd, root),
  heredoc: (command: string, payload: string, cwd: string, root?: string) =>
    shell(`${command} <<'CURSOR_HOOK_EOF'\n${payload}\nCURSOR_HOOK_EOF`, "", cwd, root),
};

/** A Squeal project, so a command that tested for Squeal would find it, and two markers. */
function project() {
  const dir = runtimeDir();
  mkdirSync(join(dir, ".git", "squeal"), { recursive: true });
  writeFileSync(join(dir, "squeal.config.json"), "{}\n");
  const markers = [join(dir, "dollar-paren"), join(dir, "backtick")];
  const content = `see $(touch ${markers[0]}) and \`touch ${markers[1]}\``;
  // One compact line, as Cursor sends it: `sh` reads it as words and runs both spans.
  const substitution = JSON.stringify({
    hook_event_name: "preToolUse",
    tool_name: "Write",
    tool_input: { file_path: join(dir, "a.md"), content },
    cwd: dir,
  });
  const redirectSpan = readFileSync(join(PROBE, "redirect-span.json"), "utf8").trimEnd();
  return { dir, markers, payloads: { substitution, redirectSpan } };
}

describe("every hooks.json command run without its args (012 CC1, task 012-01)", () => {
  it.each(entries)("$name runs nothing and exits 0 silently", async ({ command }) => {
    const { dir, markers, payloads } = project();
    for (const [form, run] of Object.entries(FORMS)) {
      for (const [payload, stdin] of Object.entries(payloads)) {
        const out = await run(command, stdin, dir);
        expect(out, `${form}, ${payload}`).toEqual({ stdout: "", stderr: "", code: 0 });
        for (const marker of markers) expect(existsSync(marker), `${form}, ${marker}`).toBe(false);
      }
    }
  });

  // Review 012-01 B1 and CC1's exception: Claude Code spawns the command in exec
  // form, where quotes would be part of the path, so a shell splits a root with
  // whitespace. The first word names no file: the hook fails, never blocks
  // (exit 2), and runs and reads nothing.
  it.each(entries)(
    "$name under a plugin root with whitespace runs nothing and never blocks",
    async ({ command }) => {
      const { dir, markers, payloads } = project();
      const root = join(dir, "plugin with spaces");
      mkdirSync(join(root, "hooks"), { recursive: true });
      copyFileSync(join(PLUGIN, "hooks/run"), join(root, "hooks/run"));
      for (const [form, run] of Object.entries(FORMS)) {
        for (const [payload, stdin] of Object.entries(payloads)) {
          const out = await run(command, stdin, dir, root);
          expect(out.code, `${form}, ${payload}`).toBe(127);
          expect(out.stdout, `${form}, ${payload}`).toBe("");
          for (const marker of markers)
            expect(existsSync(marker), `${form}, ${marker}`).toBe(false);
        }
      }
    },
  );
});
