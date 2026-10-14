import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../../src/core/fs/index.js";
import {
  type OpenCodeRun,
  opencodeUnavailable,
  runOpenCode,
  textOf,
} from "../../helpers/opencode.js";
import { liveSocket, quietCli, runtimeDir } from "../bundle-helpers.js";
import { type SquealRepo, squealRepo } from "../helpers.js";
import { buildOpencodeBundles } from "./helpers.js";
import { pluginShim } from "./real.js";

/*
 * Spec 008 goal 5 in the first session after `squeal setup` (008-22), with
 * the real OpenCode 1.18.35 under `run`: the message finds a config and no
 * store, so `register` starts the daemon and registers nothing; the daemon
 * creates the store; the first tool call registers the consumer, and from
 * the next request on the primer is in the system prompt.
 */

const unavailable = opencodeUnavailable();
if (unavailable && process.env.CI)
  throw new Error(`OpenCode fixture unavailable on CI: ${unavailable}`);

const PRIMER = "Squeal runs this repository's";
/** How long the model takes to call its tool: the stand-in daemon has made the store by then. */
const THINK_MS = 5_000;

let built = { dir: "", cleanup: () => {} };
const runs: OpenCodeRun[] = [];
beforeAll(async () => {
  built = await buildOpencodeBundles();
}, 120_000);
afterAll(() => built.cleanup());
afterEach(() => {
  for (const run of runs.splice(0)) run.cleanup();
});

const system = (request: { messages: { role: string; content?: unknown }[] } | undefined) =>
  (request?.messages ?? [])
    .filter((m) => m.role === "system")
    .map((m) => textOf(m))
    .join("\n");

describe.skipIf(unavailable !== undefined)("a session that starts before the store", () => {
  it("run: carries the primer from the request after the tool call that registered it", {
    timeout: 180_000,
  }, async () => {
    const dir = runtimeDir();
    const daemon = quietCli();
    let poll: ReturnType<typeof setInterval> | undefined;
    /** The store, once the stand-in daemon ran. */
    const made: { repo?: SquealRepo } = {};
    try {
      const run = await runOpenCode({
        mode: "run",
        prompt: "list the files",
        plan: [
          {
            tools: [{ name: "bash", arguments: { command: "ls", description: "list" } }],
            delayMs: THINK_MS,
          },
          { text: "done" },
        ],
        plugins: [pluginShim(built.dir)],
        files: { "squeal.config.json": "{}\n" },
        env: { XDG_RUNTIME_DIR: dir, SQUEAL_CLI: daemon.cli },
        timeoutMs: 120_000,
        setup: (cwd) => {
          // The daemon `register` starts makes the store, as a real one does at its start.
          poll = setInterval(() => {
            if (!existsSync(daemon.ran)) return;
            clearInterval(poll);
            const main = realpathSync(cwd);
            const repo = squealRepo({
              commonDir: join(main, ".git"),
              main,
              mainId: worktreeIdFor(main),
              addWorktree: () => {
                throw new Error("not a fixture with worktrees");
              },
            });
            repo.apply(repo.pass());
            made.repo = repo;
            void liveSocket(join(dir, `squeal-${repo.worktreeId}.sock`));
          }, 20);
        },
      });
      runs.push(run);
      expect(run.exitCode, run.stderr).toBe(0);
      const { repo } = made;
      if (repo === undefined) throw new Error("the stand-in daemon never ran");
      const [first, second] = run.requests;
      expect(run.requests).toHaveLength(2);
      // No store at the message: nothing registered, so no primer yet.
      expect(system(first)).not.toContain(PRIMER);
      // The tool call registered the consumer: its result says so, and the next request has the primer.
      expect(textOf(second?.messages.at(-1))).toMatch(/SQUEAL · registered at revision \d+/);
      expect(system(second)).toContain(PRIMER);
      expect(repo.store.consumers.list(repo.worktreeId)).toHaveLength(1);
    } finally {
      clearInterval(poll);
    }
  });
});
