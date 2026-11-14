import { spawnSync } from "node:child_process";
import { realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readTurn } from "../../../src/core/delivery/turn.js";
import { worktreeIdFor } from "../../../src/core/fs/git-layout.js";
import { formatCheck } from "../../../src/core/state/check-name.js";
import type { ConsumerRecord } from "../../../src/core/types/store-records.js";
import type { ScriptedStep } from "../../fixtures/opencode/scripted-provider.js";
import { type OpenCodeLive, type OpenCodeRun, runOpenCode } from "../../helpers/opencode.js";
import { awaitGroups, groupsRunning } from "../../helpers/process-groups.js";
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
  /** The plugin file for the run's `plugins/`; `pluginShim(dist)` when not given. */
  readonly plugin?: string;
  readonly mode: "run" | "serve";
  readonly plan: ScriptedStep[];
  readonly prompt: string;
  /** On the seeded repository before OpenCode starts. */
  readonly prepare?: (r: SquealRepo) => void;
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
      plugins: [options.plugin ?? pluginShim(options.dist)],
      env,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      settle: () => awaitBridges(options.dist),
      setup: async (cwd) => {
        const r = squealRepo(repoAt(cwd));
        r.apply(r.pass());
        options.prepare?.(r);
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
      evidence: () => (repo === null ? "store: no repository" : storeEvidence(repo)),
    });
    if (repo === null) throw new Error("setup never ran");
    return { run, r: repo };
  } finally {
    clearInterval(poll);
    for (const socket of sockets) socket.close();
  }
}

/**
 * The store as the plugin left it, read only, for a failed `afterReply`'s evidence
 * (row 011-287): each consumer with its turn and view, then the known states.
 */
function storeEvidence(r: SquealRepo): string {
  const consumers = r.store.consumers.list(r.worktreeId);
  const lines = consumers.length === 0 ? ["consumers: none registered"] : [];
  for (const { consumer, registeredAt, lastSeenAt, lastDeliveredAt } of consumers) {
    lines.push(
      `consumer ${consumer.sessionId}/${consumer.agentId}: registered at ${registeredAt}, last seen at ${lastSeenAt}, last delivered at ${lastDeliveredAt ?? "never"}`,
      `  turn: ${JSON.stringify(readTurn(r.store, consumer))}`,
      ...r.store.views
        .list(consumer)
        .map((view) => `  view: ${formatCheck(view.check)} ${view.outcome} told at ${view.toldAt}`),
    );
  }
  for (const state of r.store.knownStates.list(r.worktreeId)) {
    const phase = state.pendingPhase === null ? "" : ` (${state.pendingPhase})`;
    lines.push(
      `state: ${formatCheck(state.check)} ${state.outcome} ${state.validity}${phase} at revision ${state.observedAt}`,
    );
  }
  return lines.join("\n");
}

/** The bridge processes of `kind` still running from `dist`. */
export function bridgesRunning(dist: string, file: string): number[] {
  const out = spawnSync("pgrep", ["-f", join(dist, "hooks", file)], { encoding: "utf8" });
  return out.stdout.split("\n").filter(Boolean).map(Number);
}

/**
 * How long the plugin's bridges may run on once OpenCode's process group is gone. Each ends
 * within its hook's deadline, and the idle wake's `wait` within a second of OpenCode's end
 * (`PID_POLL_MS`); 30 s is a hang, as `HOSTS_LEAVE_MS` is for a daemon's runner hosts.
 */
const BRIDGES_LEAVE_MS = 30_000;

/**
 * Waits for the bridges the plugin from `dist` started (`<dist>/hooks/*.mjs`) to end, kills what
 * is left after `graceMs`, and then fails naming it. `callBridge` starts each with `detached:
 * true`, in a process group of its own, so the end of OpenCode's group misses them: OpenCode's
 * SIGTERM runs `dispose`, whose `end` bridge opens the store under the project while the run's
 * folder is removed (row 011-336, `research/enotempty-cleanup.md` finding 3). Each test file
 * builds its own `dist` and runs one OpenCode at a time, so what matches is this run's.
 */
export async function awaitBridges(dist: string, graceMs = BRIDGES_LEAVE_MS): Promise<void> {
  const hooks = [...new Set([dist, realpathSync(dist)])].map((dir) => `${join(dir, "hooks")}/`);
  const groups = groupsRunning((args) => hooks.some((prefix) => args.includes(prefix)));
  const killed = await awaitGroups(groups, graceMs);
  if (killed.length === 0) return;
  const named = killed.map(({ pid, args }) => `${pid} ${args}`).join("; ");
  throw new Error(
    `bridges from ${dist} still ran ${graceMs} ms after OpenCode ended; killed: ${named}`,
  );
}
