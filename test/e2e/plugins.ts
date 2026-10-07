import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { REPO_ROOT } from "../../src/harness/claude-code/build.js";
import { type BundleRun, runNode } from "../harness/bundle-helpers.js";
import { recorded } from "../harness/helpers.js";

/*
 * Spec 002 Testing, end to end: the two shipped plugins, each archived from
 * HEAD and each hook run the way its harness runs it. Claude Code: `node
 * <bundle>` with the recorded JSON of `test/harness/recorded/`, as 001's
 * suite always ran it. Codex: the command string of the archived
 * `hooks/hooks.json`, shell fast path included, under `bash -c` in the
 * thread's `cwd` with `PWD` and `PLUGIN_ROOT` set and no `CLAUDE_*`
 * variable (`research/wave-0-checks.md` 2), fed the recorded JSON of
 * `test/fixtures/codex-hooks/`.
 */

/**
 * The events a scenario drives, named as Claude Code's. Codex has no
 * PostToolBatch: `post-tool-batch` runs its PostToolUse, the per-call
 * boundary with the same delivery.
 */
export type HookName =
  | "session-start"
  | "post-tool-batch"
  | "pre-tool-use"
  | "stop"
  | "session-end";

export type PluginName = "claude-code" | "codex";

export interface Plugin {
  readonly name: PluginName;
  /** The event `post-tool-batch` runs, for test names. */
  readonly boundary: "PostToolBatch" | "PostToolUse";
  /** The edit tool of the recorded PreToolUse, as a deny names it. */
  readonly editTool: string;
  /** Whether the plugin ships `bin/squeal`; Codex hooks call the bundled CLI by path (D1). */
  readonly bin: boolean;
  /** Runs `hook` of the plugin copy at `copy` for the worktree `root`, with `env` added. */
  run(
    copy: string,
    hook: HookName,
    root: string,
    overrides: object,
    env: Readonly<Record<string, string>>,
  ): Promise<BundleRun>;
}

const CLAUDE_CODE: Plugin = {
  name: "claude-code",
  boundary: "PostToolBatch",
  editTool: "Edit",
  bin: true,
  run: (copy, hook, root, overrides, env) =>
    runNode(
      ["--disable-warning=ExperimentalWarning", join(copy, "dist", `${hook}.mjs`)],
      recorded(hook, root, overrides),
      env,
    ),
};

const CODEX_FIXTURES = join(REPO_ROOT, "test/fixtures/codex-hooks");

/**
 * The recorded input of each scenario event: the `apply_patch` pair for the
 * tool events, since a scenario's file write stands for an edit and only an
 * edit can be denied, and the app-server thread, Cezar's mode, for the rest.
 */
const CODEX_INPUT: Readonly<Record<HookName, readonly [string, string]>> = {
  "session-start": ["app-server", "session-start"],
  "post-tool-batch": ["exec", "post-tool-use-apply-patch"],
  "pre-tool-use": ["exec", "pre-tool-use-apply-patch"],
  stop: ["app-server", "stop"],
  "session-end": ["app-server", "session-end"],
};

const CODEX_EVENT: Readonly<Record<HookName, string>> = {
  "session-start": "SessionStart",
  "post-tool-batch": "PostToolUse",
  "pre-tool-use": "PreToolUse",
  stop: "Stop",
  "session-end": "SessionEnd",
};

const codexFixture = (mode: string, name: string) =>
  JSON.parse(readFileSync(join(CODEX_FIXTURES, mode, `${name}.json`), "utf8")) as Record<
    string,
    unknown
  >;

/** The app-server thread every Codex scenario event belongs to, so the exec records join it. */
const CODEX_SESSION = String(codexFixture("app-server", "session-start").session_id);

interface CodexHooksJson {
  readonly hooks: Record<string, readonly { readonly hooks: readonly { command: string }[] }[]>;
}

/** The one handler's command of `event` in the copy's `hooks/hooks.json`, `${PLUGIN_ROOT}` literal. */
function codexCommand(copy: string, event: string): string {
  const json = JSON.parse(readFileSync(join(copy, "hooks/hooks.json"), "utf8")) as CodexHooksJson;
  const command = json.hooks[event]?.[0]?.hooks[0]?.command;
  if (command === undefined) throw new Error(`no ${event} handler in ${copy}/hooks/hooks.json`);
  return command;
}

const CODEX: Plugin = {
  name: "codex",
  boundary: "PostToolUse",
  editTool: "apply_patch",
  bin: false,
  run: (copy, hook, root, overrides, env) => {
    const [mode, name] = CODEX_INPUT[hook];
    const input: Record<string, unknown> = {
      ...codexFixture(mode, name),
      session_id: CODEX_SESSION,
      cwd: root,
      ...overrides,
    };
    // The thread's own transcript, named for the session the input carries: one named for
    // another session is an unserved thread (002 D2), so a test that overrides session_id
    // alone, as the second worktree's does, gets a matching transcript.
    if (!("transcript_path" in overrides)) {
      input.transcript_path = String(
        codexFixture("app-server", "session-start").transcript_path,
      ).replace(`${CODEX_SESSION}.jsonl`, `${String(input.session_id)}.jsonl`);
    }
    return runShell(codexCommand(copy, CODEX_EVENT[hook]), JSON.stringify(input), root, {
      // The `node` of the command is the one running this suite, so Node 22 and 24 each test themselves.
      PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
      PWD: root,
      PLUGIN_ROOT: copy,
      ...env,
    });
  },
};

export const PLUGINS: readonly Plugin[] = [CLAUDE_CODE, CODEX];

/** `git archive HEAD plugins/<name>` unpacked at `dest`, as a marketplace install copies it. */
export function archivePlugin(plugin: Plugin, dest: string): void {
  const archive = execFileSync("git", ["archive", "HEAD", `plugins/${plugin.name}`], {
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  const unpacked = `${dest}.archive`;
  mkdirSync(unpacked);
  execFileSync("tar", ["-x", "-C", unpacked], { input: archive });
  execFileSync("mv", [join(unpacked, "plugins", plugin.name), dest]);
  rmSync(unpacked, { recursive: true });
}

/** `bash -c <command>` in `cwd` with HOME and `env` only, stdin piped, timed. */
function runShell(
  command: string,
  stdin: string,
  cwd: string,
  env: Readonly<Record<string, string>>,
): Promise<BundleRun> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn("bash", ["-c", command], {
      cwd,
      env: { HOME: process.env.HOME ?? "", ...env },
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (b: Buffer) => out.push(b));
    child.stderr.on("data", (b: Buffer) => err.push(b));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        code,
        ms: performance.now() - started,
      }),
    );
    // A hook the fast path ends never reads its stdin.
    child.stdin.on("error", () => {});
    child.stdin.end(stdin);
  });
}
