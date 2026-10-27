import { expect, it, onTestFinished, vi } from "vitest";
import { noDaemonLine } from "../cli/stop-lines.js";
import { daemonSuite, SLOW, spawnCli } from "./helpers.js";

const suite = daemonSuite();
const identities = ["CODEX_SESSION_ID", "PI_SESSION_ID", "OPENCODE_SESSION_ID"] as const;

it.each(identities)(
  "keeps plain fixture commands when the controller sets %s (017-11.R2)",
  async (identity) => {
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    for (const name of identities) vi.stubEnv(name, undefined);
    vi.stubEnv(identity, "controller-session");
    const repo = suite.fixture();
    const stop = spawnCli(suite.cli, ["stop", repo.root], { cwd: "/", env: repo.env });
    expect(await stop.exited).toEqual({ code: 0, signal: null });
    expect(stop.stdout()).toBe(noDaemonLine(repo.root));
    // Node 22.19 emits this runtime warning when the CLI imports SQLite.
    // Permit only that complete warning, or no stderr; reject all other output.
    expect(
      stop
        .stderr()
        .replace(
          /^\(node:\d+\) ExperimentalWarning: SQLite is an experimental feature and might change at any time\n\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)\n/,
          "",
        ),
    ).toBe("");
    expect(repo.env[identity]).toBeUndefined();
    expect(process.env[identity]).toBe("controller-session");
  },
  SLOW.timeout,
);
