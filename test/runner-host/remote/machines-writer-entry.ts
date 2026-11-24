import { recordMachine } from "../../../src/core/runner-host/remote/machines-store.js";

/*
 * Review 0.1.616 S1: one writer of `remote-machines.json`, run as its own
 * process by `machines-lock.test.ts`. argv: state directory, writer name,
 * record count, the epoch ms at which every writer starts.
 */

const [state, name, count, startAt] = process.argv.slice(2);
const env = { XDG_STATE_HOME: state, HOME: state };
while (Date.now() < Number(startAt)) {
  // Every writer starts at once, so their writes overlap.
}
for (let i = 0; i < Number(count); i++) {
  recordMachine(
    {
      provider: "command",
      id: `cmd:${name}-${i}`,
      worktreeId: `${name}-${i}`,
      worktreeRoot: `/repo/${name}-${i}`,
      repositoryKey: "/repo",
      destination: "dev@host",
      sshArgs: [],
      places: { node: "node", cache: ".squeal-remote" },
      capabilities: { hasGitRepository: false, sleepOnIdle: true, ephemeralHostKey: false },
      status: "awake",
      createdAt: 1,
      lastUsedAt: 1,
    },
    env,
  );
}
