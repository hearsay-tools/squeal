import { spawnSync } from "node:child_process";
import { realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { worktreeIdFor } from "../../../src/core/fs/index.js";
import type { ConsumerRecord } from "../../../src/core/types/index.js";
import type { ScriptedStep } from "../../fixtures/opencode/scripted-provider.js";
import { type OpenCodeLive, type OpenCodeRun, runOpenCode } from "../../helpers/opencode.js";
import type { FakeRepo } from "../../status/helpers.js";
import { tempDir } from "../../store/helpers.js";
import { liveSocket, quietCli, runtimeDir } from "../bundle-helpers.js";
import { type SquealRepo, squealRepo } from "../helpers.js";

/*
 * The real OpenCode 1.18.35 with the built Squeal plugin (spec 008 Testing),
 * through `runOpenCode` only: the project it creates is seeded as a Squeal
 * repository with a live daemon socket and a quiet CLI, so the bridge runs
 * the shared code on a store the test drives.
 */

/**
 * A plugin file for the run's `plugins/`: OpenCode loads the named exports
 * of a file there as plugins, and the package's `dist/plugin.mjs`
 * default-exports `{ id, server }`, which `opencode plugin` reads.
 */
export function pluginShim(dist: string): string {
  const shim = join(tempDir("squeal-oc-shim-"), "squeal.js");
  writeFileSync(
    shim,
    `import mod from ${JSON.stringify(join(dist, "plugin.mjs"))};\nexport const Squeal = mod.server;\n`,
  );
  return shim;
}

/** `cwd`, the git repository `runOpenCode` made, as the fixture repository. */
function repoAt(cwd: string): FakeRepo {
  const main = realpathSync(cwd);
  return {
    commonDir: join(main, ".git"),
    main,
    mainId: worktreeIdFor(main),
    addWorktree: () => {
      throw new Error("not a fixture with worktrees");
    },
  };
}

export interface SquealRun {
  readonly run: OpenCodeRun;
  readonly r: SquealRepo;
}

export interface SquealRunOptions {
  readonly dist: string;
  readonly mode: "run" | "serve";
  readonly plan: ScriptedStep[];
  readonly prompt: string;
  /** Once the first consumer registers, as soon as the bridge wrote it. */
  readonly onRegistered?: (r: SquealRepo, consumer: ConsumerRecord) => void;
  readonly afterReply?: (live: OpenCodeLive, r: SquealRepo) => Promise<void>;
  readonly timeoutMs?: number;
}

/** One OpenCode run on a Squeal repository at a passing baseline. */
export async function squealOpenCode(options: SquealRunOptions): Promise<SquealRun> {
  const dir = runtimeDir();
  let repo: SquealRepo | null = null;
  let poll: ReturnType<typeof setInterval> | undefined;
  const sockets: { close(): void }[] = [];
  const env = { XDG_RUNTIME_DIR: dir, SQUEAL_CLI: quietCli().cli };
  try {
    const run = await runOpenCode({
      mode: options.mode,
      plan: options.plan,
      prompt: options.prompt,
      plugins: [pluginShim(options.dist)],
      env,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      setup: async (cwd) => {
        const r = squealRepo(repoAt(cwd));
        r.apply(r.pass());
        repo = r;
        sockets.push(await liveSocket(join(dir, `squeal-${r.worktreeId}.sock`)));
        const { onRegistered } = options;
        if (onRegistered === undefined) return;
        poll = setInterval(() => {
          const [first] = r.store.consumers.list(r.worktreeId);
          if (first === undefined) return;
          clearInterval(poll);
          onRegistered(r, first);
        }, 20);
      },
      ...(options.afterReply === undefined
        ? {}
        : {
            afterReply: (live: OpenCodeLive) => {
              if (repo === null) throw new Error("no repository");
              return options.afterReply?.(live, repo) ?? Promise.resolve();
            },
          }),
    });
    if (repo === null) throw new Error("setup never ran");
    return { run, r: repo };
  } finally {
    clearInterval(poll);
    for (const socket of sockets) socket.close();
  }
}

/** The bridge processes of `kind` still running from `dist`. */
export function bridgesRunning(dist: string, file: string): number[] {
  const out = spawnSync("pgrep", ["-f", join(dist, "hooks", file)], { encoding: "utf8" });
  return out.stdout.split("\n").filter(Boolean).map(Number);
}
