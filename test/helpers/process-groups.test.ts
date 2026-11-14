import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { awaitGroups, detachedLeaders, membersOf } from "./process-groups.js";

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
  it.skipIf(process.platform !== "linux")(
    "takes only a process that leads its own group and session, as its selector and owner say",
    async () => {
      const { pgid, marker } = group(null, null);
      await childRunning(pgid);
      const mine = (argv: readonly string[]) => argv.at(-1) === marker;
      const leaders = detachedLeaders(mine, () => true);
      // The child carries the marker too, but leads no group.
      expect(leaders.map(({ pid }) => pid)).toEqual([pgid]);
      const [leader] = leaders;
      expect(leader).toMatchObject({
        pid: pgid,
        pgid,
        sid: pgid,
        exe: realpathSync(process.execPath),
      });
      expect(leader?.env.get("PATH")).toBe(process.env.PATH);
      expect(detachedLeaders(mine, () => false)).toEqual([]);
      expect(
        detachedLeaders(
          (argv) => argv.at(-1) === randomUUID(),
          () => true,
        ),
      ).toEqual([]);
    },
  );

  it("waits for a group whose child outlives its leader, and kills nothing", async () => {
    const { pgid } = group(0, 2_000);
    await childRunning(pgid);
    expect(membersOf([pgid]).some(({ pid }) => pid !== pgid)).toBe(true);
    expect(await awaitGroups([pgid], { graceMs: 30_000 })).toEqual({ killed: [], alive: [] });
    expect(membersOf([pgid])).toEqual([]);
  });

  it("kills a group still there after the grace, and names its members", async () => {
    const { pgid, marker } = group(null, null);
    await childRunning(pgid);
    const { killed, alive } = await awaitGroups([pgid], { graceMs: 200 });
    expect(killed).toHaveLength(2);
    expect(killed.every((member) => member.pgid === pgid && member.args.includes(marker))).toBe(
      true,
    );
    expect(alive).toEqual([]);
    expect(membersOf([pgid])).toEqual([]);
  });

  // Review 011-336 S1: a wait that ends with members alive says so; it never reads as their exit.
  it("reports the members still alive when its kill did not end them", async () => {
    const { pgid } = group(null, null);
    await childRunning(pgid);
    const sent: string[] = [];
    const { killed, alive } = await awaitGroups([pgid], {
      graceMs: 100,
      killedMs: 200,
      signal: (group, name) => sent.push(`${group} ${name}`),
    });
    expect(sent).toEqual([`${pgid} SIGKILL`]);
    expect(killed).toHaveLength(2);
    expect(alive.map(({ pid }) => pid).sort()).toEqual(killed.map(({ pid }) => pid).sort());
  });

  it("resolves at once for a group that is gone", async () => {
    const { pgid } = group(null, null);
    await childRunning(pgid);
    process.kill(-pgid, "SIGKILL");
    expect(await awaitGroups([pgid], { graceMs: 10_000 })).toEqual({ killed: [], alive: [] });
  });
});
