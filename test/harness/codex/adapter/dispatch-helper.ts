import { type ChildProcess, fork } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect } from "vitest";
import { tempDir } from "../../../store/helpers.js";
import { fixedPlugin, type Ran, runAdapter, write } from "./fixture.js";

const CONTEXT_EVENTS: Readonly<Record<string, string>> = {
  "session-start": "SessionStart",
  "user-prompt-submit": "UserPromptSubmit",
  "subagent-start": "SubagentStart",
};

export type HookResult =
  | { readonly kind: "ran"; readonly runtime: Ran }
  | { readonly kind: "selection-busy" }
  | { readonly kind: "silent" };

export function dispatched(result: HookResult): Ran {
  expect(result.kind).toBe("ran");
  if (result.kind !== "ran") throw new Error(`Expected dispatch, got ${result.kind}`);
  return result.runtime;
}

/** A fixed plugin with a seed, empty data and a repository using Squeal. */
export function machine(adapter: string, seed: string) {
  const dir = tempDir("sq-adapter-machine-");
  const plugin = fixedPlugin(join(dir, "plugin"), seed);
  const data = join(dir, "data");
  const repo = join(dir, "repo");
  write(join(repo, "squeal.config.json"), "{}\n");
  const env = { PLUGIN_ROOT: plugin, PLUGIN_DATA: data };
  const hook = async (name: string, session: string, cwd = repo): Promise<HookResult> => {
    const out = await runAdapter(adapter, name, { session_id: session, cwd }, env);
    expect(out, `${name} ${session}`).toMatchObject({ code: 0, stderr: "" });
    if (out.stdout === "") {
      expect(CONTEXT_EVENTS[name], `silent ${name}`).toBeUndefined();
      return { kind: "silent" };
    }
    const value: unknown = JSON.parse(out.stdout);
    if (typeof value === "object" && value !== null && "hookSpecificOutput" in value) {
      expect(CONTEXT_EVENTS[name], `context from ${name}`).toBeDefined();
      expect(value).toEqual({
        hookSpecificOutput: {
          hookEventName: CONTEXT_EVENTS[name],
          additionalContext:
            `SQUEAL · validation unavailable in this session. Squeal runtime selection under ${data} is busy. Retry this hook or command; no session runtime was changed.\n` +
            "Squeal reports no test results here until this is fixed: run the project's tests yourself meanwhile.",
        },
      });
      return { kind: "selection-busy" };
    }
    expect(value).toEqual({
      version: expect.any(String),
      name,
      root: expect.any(String),
      data,
      adapter: plugin,
      session,
    });
    const runtime = value as Ran;
    expect(runtime.root).toBe(join(data, "versions", runtime.version));
    return { kind: "ran", runtime };
  };
  const dispatch = async (name: string, session: string, cwd = repo): Promise<Ran> =>
    dispatched(await hook(name, session, cwd));
  // Only an exact busy diagnostic is retryable. Silence and other errors fail.
  const retryBusy = async (name: string, session: string, first: HookResult): Promise<Ran> => {
    expect(CONTEXT_EVENTS[name]).toBeDefined();
    let result = first;
    for (let attempt = 0; attempt < 5 && result.kind === "selection-busy"; attempt++) {
      result = await hook(name, session);
    }
    return dispatched(result);
  };
  return { dir, plugin, data, repo, env, hook, dispatch, retryBusy };
}

const holders = new Set<ChildProcess>();
afterEach(async () => {
  await Promise.all(
    [...holders].map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }),
  );
  holders.clear();
});

/** A real selection transaction, with readiness and release acknowledged by IPC/exit. */
export async function holdSelection(data: string): Promise<() => Promise<void>> {
  const child = fork(fileURLToPath(new URL("./selection-owner.ts", import.meta.url)), [data], {
    execArgv: ["--import", import.meta.resolve("tsx"), "--disable-warning=ExperimentalWarning"],
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  holders.add(child);
  expect((await once(child, "message"))[0]).toBe("held");
  return async () => {
    const exited = once(child, "exit");
    child.send("release");
    expect(await exited).toEqual([0, null]);
    holders.delete(child);
  };
}
