import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";
import { recordMachine } from "../../../src/core/runner-host/remote/machines-store.js";
import type {
  MachineRecord,
  ReleaseReason,
  RemoteMachine,
  RemoteMachineProvider,
} from "../../../src/core/runner-host/remote/provider.js";
import { remoteSettingsPath } from "../../../src/core/runner-host/remote/settings.js";
import type { AbsolutePath, WorktreeId } from "../../../src/core/types/common.js";

/*
 * Row 026-37 (#301): a user whose `remote.json` names a `command` lane for
 * `/repo`, its machines reached through a fake provider of that kind that
 * records each release. `releases` decides each release: resolve, reject
 * or never settle, or a promise the test settles. Nothing runs a hook or
 * reads the real home.
 */

/** A release resolves, rejects, never settles, or settles as the given promise does. */
export type ReleaseBehaviour = "ok" | "fail" | "hang" | Promise<void>;

/** `lane`: more keys of the `/repo` lane, such as row 026-43's `deleteUnusedHours`. */
export function pruneUser(
  behaviour: (id: string) => ReleaseBehaviour = () => "ok",
  lane: Record<string, unknown> = {},
) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "squeal-prune-")));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const env: NodeJS.ProcessEnv = {
    XDG_CONFIG_HOME: join(dir, "config"),
    XDG_STATE_HOME: join(dir, "state"),
    HOME: join(dir, "home"),
    PATH: process.env.PATH,
  };
  mkdirSync(join(dir, "config", "squeal"), { recursive: true });
  writeFileSync(
    remoteSettingsPath(env),
    JSON.stringify({
      repositories: {
        "/repo": {
          provider: "command",
          providerConfig: { acquire: ["unused"], release: ["unused"] },
          ...lane,
        },
      },
    }),
  );
  const live = join(dir, "worktree");
  mkdirSync(live, { recursive: true });
  const released: [string, ReleaseReason][] = [];
  const machineOf = (record: MachineRecord): RemoteMachine => ({
    id: record.id,
    provider: record.provider,
    ssh: { destination: record.destination, args: [] } as unknown as RemoteMachine["ssh"],
    places: record.places,
    capabilities: record.capabilities,
    wake: async () => {},
    sleep: async () => {},
    release: (reason) => {
      released.push([record.id, reason]);
      const how = behaviour(record.id);
      if (typeof how !== "string") return how;
      if (how === "hang") return new Promise<void>(() => {});
      if (how === "fail") return Promise.reject(new Error("HTTP 503 Service Unavailable"));
      return Promise.resolve();
    },
  });
  const provider: RemoteMachineProvider = {
    kind: "command",
    validate: () => null,
    acquire: () => Promise.reject(new Error("no acquire here")),
    reattach: (record) => machineOf(record),
  };
  let n = 0;
  return {
    env,
    live,
    gone: (name = `gone-${++n}`) => join(dir, name),
    released,
    providerOf: (kind: string) => (kind === "command" ? provider : null),
    track(over: Partial<MachineRecord>): void {
      recordMachine(
        {
          provider: "command",
          id: `cmd:${++n}`,
          worktreeId: `w${n}` as WorktreeId,
          worktreeRoot: live as AbsolutePath,
          repositoryKey: "/repo",
          destination: "dev@host",
          sshArgs: [],
          places: { node: "node", cache: "c" },
          capabilities: { hasGitRepository: false, sleepOnIdle: true, ephemeralHostKey: false },
          status: "detached",
          // Row 026-43: used a minute ago, so no record is unused unless a test makes it so.
          createdAt: Date.now() - 3_600_000,
          lastUsedAt: Date.now() - 60_000,
          ...over,
        } as MachineRecord,
        env,
      );
    },
  };
}
