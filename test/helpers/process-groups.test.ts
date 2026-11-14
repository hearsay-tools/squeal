import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { awaitGroups, groupsRunning, membersOf } from "./process-groups.js";

const started: number[] = [];
afterEach(() => {
  for (const group of started.splice(0)) {
    try {
      process.kill(-group, "SIGKILL");
    } catch {
      // Gone.
    }
  }
});

/**
 * A detached process, the leader of its own group as a plugin's bridge is, that starts a child
 * in that group; once the child runs, the leader lives `leaderMs`; the child lives `childMs`;
 * null is for ever.
 */
function group(leaderMs: number | null, childMs: number | null): { pgid: number; marker: string } {
  const marker = `squeal-group-${randomUUID()}`;
  const child =
    childMs === null ? "setInterval(() => {}, 1000)" : `setTimeout(() => {}, ${childMs})`;
  const leader =
    leaderMs === null
      ? "setInterval(() => {}, 1000)"
      : `setTimeout(() => process.exit(0), ${leaderMs})`;
  const spawned = spawn(
    process.execPath,
    [
      "-e",
      `require("child_process").spawn(process.execPath, ["-e", ${JSON.stringify(child)}, ${JSON.stringify(marker)}], { stdio: "ignore" }).on("spawn", () => { ${leader} });`,
      marker,
    ],
    { detached: true, stdio: "ignore" },
  );
  if (spawned.pid === undefined) throw new Error("no pid");
  started.push(spawned.pid);
  return { pgid: spawned.pid, marker };
}

/** Until the group's child runs. */
async function childRunning(pgid: number): Promise<void> {
  for (let waited = 0; !membersOf([pgid]).some(({ pid }) => pid !== pgid); waited += 20) {
    if (waited > 10_000) throw new Error(`group ${pgid} never started its child`);
    await new Promise((done) => setTimeout(done, 20));
  }
}

describe("process groups", () => {
  it("finds the group of a process by its command line", async () => {
    const { pgid, marker } = group(null, null);
    await childRunning(pgid);
    expect(groupsRunning((args) => args.includes(marker))).toEqual(new Set([pgid]));
    expect(groupsRunning((args) => args.includes(randomUUID())).size).toBe(0);
  });

  it("waits for a group whose child outlives its leader, and kills nothing", async () => {
    const { pgid } = group(0, 2_000);
    await childRunning(pgid);
    expect(membersOf([pgid]).some(({ pid }) => pid !== pgid)).toBe(true);
    expect(await awaitGroups([pgid], 30_000)).toEqual([]);
    expect(membersOf([pgid])).toEqual([]);
  });

  it("kills a group still there after the grace, and names its members", async () => {
    const { pgid, marker } = group(null, null);
    await childRunning(pgid);
    const killed = await awaitGroups([pgid], 200);
    expect(killed).toHaveLength(2);
    expect(killed.every((member) => member.pgid === pgid && member.args.includes(marker))).toBe(
      true,
    );
    expect(membersOf([pgid])).toEqual([]);
  });

  it("resolves at once for a group that is gone", async () => {
    const { pgid } = group(null, null);
    await childRunning(pgid);
    process.kill(-pgid, "SIGKILL");
    expect(await awaitGroups([pgid], 10_000)).toEqual([]);
  });
});
