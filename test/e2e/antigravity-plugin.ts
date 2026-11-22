import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { REPO_ROOT } from "../../src/harness/build.js";
import type { BundleRun } from "../harness/bundle-helpers.js";
import type { HookName, Plugin } from "./plugins.js";
import { runShell } from "./shell.js";

/*
 * Spec 024 Testing, end to end: the Antigravity plugin copy's hooks run as
 * Antigravity's plugin hook runner runs them (D4), each command string of the
 * copied `hooks.json` under `sh -c` with the plugin root as working
 * directory, so `./hooks/run` and its `--if-squeal` fast path run for real,
 * with `PLUGIN_ROOT` and `PLUGIN_DATA` set (D1) and no `CLAUDE_*` or
 * `CODEX_*` variable, fed the recorded JSON of
 * `test/fixtures/antigravity-hooks/` pointed at the worktree.
 */

const FIXTURES = join(REPO_ROOT, "test/fixtures/antigravity-hooks");
/** The workspace the recorded payloads name; every occurrence becomes the worktree. */
const RECORDED_ROOT = "/home/user/project";

/**
 * A scenario's events plus two only Antigravity has: the PreInvocation at a
 * user turn's start (`invocationNum: 0`) and the second, waiting Stop entry.
 */
export type AntigravityHook = HookName | "pre-invocation-first" | "stop-slow";

type Entry = readonly [event: string, index: number, fixture: string];

/** Each event's `hooks.json` entry and recorded payload; SessionEnd has none (D2). */
const ENTRY: Readonly<Record<Exclude<AntigravityHook, "session-end">, Entry>> = {
  "session-start": ["SessionStart", 0, "session-start"],
  "post-tool-batch": ["PreInvocation", 0, "pre-invocation-after-tools"],
  "pre-invocation-first": ["PreInvocation", 0, "pre-invocation-first"],
  "pre-tool-use": ["PreToolUse", 0, "pre-tool-use-write-file"],
  stop: ["Stop", 0, "stop"],
  "stop-slow": ["Stop", 1, "stop"],
};

interface HooksJson {
  readonly squeal: Record<
    string,
    readonly { readonly command?: string; readonly hooks?: readonly { command: string }[] }[]
  >;
}

/** The command of entry `index` of `event` in the copy's `hooks.json`, a matcher group's first hook. */
export function antigravityCommand(copy: string, event: string, index = 0): string {
  const json = JSON.parse(readFileSync(join(copy, "hooks.json"), "utf8")) as HooksJson;
  const entry = json.squeal[event]?.[index];
  const command = entry?.command ?? entry?.hooks?.[0]?.command;
  if (command === undefined) throw new Error(`no ${event}[${index}] hook in ${copy}/hooks.json`);
  return command;
}

/** `value` with every string's recorded workspace replaced by `root`. */
function rooted(value: unknown, root: string): unknown {
  if (typeof value === "string") return value.replaceAll(RECORDED_ROOT, root);
  if (Array.isArray(value)) return value.map((v) => rooted(v, root));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rooted(v, root)]));
  }
  return value;
}

/**
 * The scenario overrides in Antigravity's terms: `session_id` is the
 * `conversationId` (D2) and `stop_hook_active` a Stop after a continuation
 * (`executionNum: 1`, D3); every other key is the payload's own.
 */
function translated(overrides: object): Record<string, unknown> {
  const { session_id, stop_hook_active, ...rest } = overrides as Record<string, unknown>;
  return {
    ...(session_id === undefined ? {} : { conversationId: session_id }),
    ...(stop_hook_active === true ? { executionNum: 1 } : {}),
    ...rest,
  };
}

/** The recorded payload of `fixture` for the worktree `root`, `overrides` applied. */
export function antigravityPayload(
  fixture: string,
  root: string,
  overrides: object = {},
): Record<string, unknown> {
  const recorded = JSON.parse(readFileSync(join(FIXTURES, `${fixture}.json`), "utf8")) as object;
  return {
    ...(rooted(recorded, root) as Record<string, unknown>),
    cwd: root,
    workspacePaths: [root],
    ...translated(overrides),
  };
}

/** The fixtures' main conversation, every scenario's default consumer. */
export const ANTIGRAVITY_SESSION = String(antigravityPayload("session-start", "/").conversationId);

/**
 * Scratch-only state, as an installed plugin's hooks get it (D1,
 * `research/wave-0-checks.md` 2): `PLUGIN_ROOT` the copy, `PLUGIN_DATA`
 * beside it and present before the first hook, a HOME of its own, and the
 * `node` running this suite first on PATH, so Node 22 and 24 each test themselves.
 */
export function antigravityEnvironment(copy: string): Record<string, string> {
  const data = `${copy}.data`;
  const home = `${copy}.home`;
  mkdirSync(data, { recursive: true });
  mkdirSync(home, { recursive: true });
  return {
    HOME: home,
    PLUGIN_ROOT: copy,
    PLUGIN_DATA: data,
    PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
  };
}

/** Antigravity has no SessionEnd hook (D2): the shared cleanup's call is a silent no-op. */
const NO_HOOK: BundleRun = { stdout: "", stderr: "", code: 0, ms: 0 };

/** Runs `hook` of the plugin copy at `copy` for the worktree `root`, as Antigravity would. */
export function runAntigravity(
  copy: string,
  hook: AntigravityHook,
  root: string,
  overrides: object,
  env: Readonly<Record<string, string>>,
): Promise<BundleRun> {
  if (hook === "session-end") return Promise.resolve(NO_HOOK);
  const [event, index, fixture] = ENTRY[hook];
  const payload = antigravityPayload(fixture, root, overrides);
  return runShell("sh", antigravityCommand(copy, event, index), JSON.stringify(payload), copy, {
    ...antigravityEnvironment(copy),
    ...env,
  });
}

export const ANTIGRAVITY: Plugin = {
  name: "antigravity",
  boundary: "PreInvocation",
  editTool: "write_file",
  bin: false,
  init: ["init", "--harness", "antigravity"],
  run: runAntigravity,
};
