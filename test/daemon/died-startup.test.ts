import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDaemonNotes } from "../../src/core/notes.js";
import { buildSnapshot } from "../../src/core/status/index.js";
import { daemonExitMetaKey } from "../../src/core/types/index.js";
import { type HookResult, runHook } from "../../src/harness/claude-code/index.js";
import { recorded } from "../harness/helpers.js";
import { daemonSuite, SLOW, spawnCli, waitFor, withStore } from "./helpers.js";

/*
 * Review wave-13ag B1 (001-274): a daemon stopped while it starts writes its
 * shutdown's mark, then startup goes on and its node:test projects with a
 * missing working directory write a diagnostic note each, more than the 20
 * notes the store keeps. Killed before the shutdown finishes, it is down, not
 * dead: the mark is a `daemon-exit:` row, which no note evicts and the next
 * registration clears. With no such project, the control, it reads the same.
 */

const suite = daemonSuite();
/** Past the daemon's heartbeat window (two 5 s intervals). */
const LATER_MS = 60_000;

/**
 * Starts the daemon in-process, stops it at once, and records its
 * registration then: renamed into place, so the test, which waits for the
 * file to exist, never reads it half written (014-20).
 */
const DRIVER = `import { renameSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const [daemonPath, root, out, commonDir] = process.argv.slice(2);
const daemonUrl = pathToFileURL(daemonPath);
const { startDaemon } = await import(daemonUrl);
const { openStore } = await import(new URL("../store/index.js", daemonUrl));
const daemon = await startDaemon({ root, env: process.env });
if ("reason" in daemon) throw new Error(daemon.message);
const stopping = daemon.stop("stop-requested");
const store = openStore(commonDir, { create: false, busyTimeoutMs: 10000 });
const staged = out + ".tmp";
writeFileSync(staged, JSON.stringify(store.worktrees.get(daemon.worktreeId).daemon));
renameSync(staged, out);
store.close();
await stopping;
`;

const context = (out: HookResult): string =>
  (JSON.parse(out.stdout) as { hookSpecificOutput: { additionalContext: string } })
    .hookSpecificOutput.additionalContext;

describe.runIf(process.platform === "linux")(
  "a stop during startup killed after its diagnostics (review wave-13ag B1)",
  SLOW,
  () => {
    it.each([25, 0])("is down, not dead, after %i missing-cwd projects' notes", async (missing) => {
      const dir = mkdtempSync(join(tmpdir(), "sq-001-274-"));
      suite.cleanup(() => rmSync(dir, { recursive: true, force: true }));
      const release = join(dir, "release");
      const held = join(dir, "held");
      const registered = join(dir, "registered");
      // The last project's Node holds its version probe, so startup waits there.
      const node = join(dir, "node.sh");
      writeFileSync(
        node,
        `#!/bin/sh\n: > '${held}'\nwhile [ ! -e '${release}' ]; do sleep 0.05; done\nexec '${process.execPath}' "$@"\n`,
        { mode: 0o755 },
      );
      const driver = join(dir, "driver.mjs");
      writeFileSync(driver, DRIVER);
      const project = { include: ["test/*.test.mjs"], argv: [], env: {} };
      const projects = [
        ...Array.from({ length: missing }, (_, i) => ({
          ...project,
          name: `missing-${i}`,
          cwd: `missing-${i}`,
        })),
        { ...project, name: "held-start", node },
      ];
      const repo = suite.fixture({ "squeal.config.json": JSON.stringify({ nodeTest: projects }) });
      const daemonPath = join(dirname(dirname(suite.cli)), "core/daemon/daemon.js");
      const spawned = spawnCli(driver, [daemonPath, repo.root, registered, repo.commonDir], {
        cwd: repo.root,
        env: repo.env,
      });
      try {
        await waitFor(() => existsSync(registered), 60_000, "the stop during startup");
        expect(JSON.parse(readFileSync(registered, "utf8"))).toMatchObject({
          token: expect.any(String),
        });
        await waitFor(() => existsSync(held), 60_000, "the held version probe");
        if (missing > 0) {
          await waitFor(
            () =>
              withStore(repo, (store) => {
                const notes = readDaemonNotes(store, repo.worktreeId);
                return notes.length === 20 && notes.every((n) => n.text.includes("cwd missing-"));
              }),
            60_000,
            "20 missing-cwd notes",
          );
        }
        expect(spawned.child.exitCode).toBeNull();
        spawned.child.kill("SIGKILL");
        expect(await spawned.exited).toEqual({ code: null, signal: "SIGKILL" });

        const later = Date.now() + LATER_MS;
        const snapshot = withStore(repo, (store) => {
          expect(store.worktrees.get(repo.worktreeId)?.daemon).not.toBeNull();
          return buildSnapshot(store, repo.root, later);
        });
        expect(snapshot.daemon.state).toBe("down");
        expect(snapshot.daemon).not.toHaveProperty("died");
        const out = await runHook(
          "session-start",
          recorded("session-start", repo.root, { session_id: "s1", source: "startup" }),
          {
            env: repo.env,
            ensureDaemon: async () => "unavailable",
            now: () => later,
            harnessProcess: () => null,
          },
        );
        expect(context(out)).not.toContain("died without shutting down");

        // The next registration clears the mark (task 001-274).
        writeFileSync(release, "");
        const read = () =>
          withStore(repo, (store) => ({
            token: store.worktrees.get(repo.worktreeId)?.daemon?.token,
            exit: store.meta.get(daemonExitMetaKey(repo.worktreeId)),
          }));
        const killed = read();
        expect(killed.exit).not.toBeNull();
        suite.daemon(repo);
        await waitFor(() => read().token !== killed.token, 60_000, "the next registration");
        expect(read().exit).toBeNull();
      } finally {
        writeFileSync(release, "");
        if (spawned.child.exitCode === null && spawned.child.signalCode === null) {
          spawned.child.kill("SIGKILL");
          await spawned.exited;
        }
      }
    });
  },
);
