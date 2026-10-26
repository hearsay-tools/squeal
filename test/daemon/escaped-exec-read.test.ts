import { readFile } from "node:fs/promises";
import { getPriority } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it, onTestFinished } from "vitest";
import type { EscapedChildren, MarkSource } from "../../src/core/daemon/escaped.js";
import { lowerWhile, TEST_NICE } from "../../src/core/daemon/low-priority.js";
import { statOf, TICKS_PER_SECOND } from "../../src/core/daemon/terminate.js";
import { leaderGroup } from "./low-priority-helpers.js";

/*
 * Row 011-259: a read of `/proc/<pid>/environ` that spans the process's
 * exec reads 0 bytes (`tasks/011-257/notes.md`), so a member of the daemon's
 * group read so is kept unmarked. One read empty while younger than 100 ms
 * is read again at each look until it shows its mark or is 100 ms old. The
 * source's reader gives the empty read and its clock the member's age, so no
 * host timing decides either.
 */

/**
 * `/proc`, but the member's `read`th read comes back empty while
 * `empty(read)` holds, and every age is read on the member's clock: `age`
 * ticks after its start.
 */
function source(empty: (read: number) => boolean) {
  const member = { pid: -1, start: 0, age: 0, reads: 0 };
  const reader: MarkSource = {
    async environ(pid) {
      if (pid === member.pid && empty(++member.reads)) return "";
      return readFile(`/proc/${pid}/environ`, "latin1");
    },
    uptime: () => member.start + member.age,
  };
  return { member, reader };
}

/** A daemon's group whose `fast` sleeper is the member of `source(empty)`, `age` ticks old. */
async function group(empty: (read: number) => boolean, age: number) {
  const { member, reader } = source(empty);
  const { daemon, sleeper } = await leaderGroup(reader);
  const since = daemon.mark();
  member.pid = await sleeper("fast");
  member.start = statOf(member.pid)?.start ?? Number.NaN;
  member.age = age;
  const look = async () => (await daemon.carriers("fast", since)).map(({ pid }) => pid);
  return { member, daemon, since, sleeper, look };
}

/** `children`'s looks for `lowerWhile`: `started(n)` resolves as the `n`th starts, once what those before found is lowered. */
function counted(children: Pick<EscapedChildren, "carriers">) {
  let looks = 0;
  const found: number[] = [];
  const waiters = new Map<number, () => void>();
  return {
    found,
    async carriers(lane: string, since: number, lost?: boolean) {
      waiters.get(++looks)?.();
      const entries = await children.carriers(lane, since, lost);
      found.push(...entries.map(({ pid }) => pid));
      return entries;
    },
    started: (n: number) => new Promise<void>((resolve) => waiters.set(n, resolve)),
  };
}

describe.runIf(process.platform === "linux")(
  "a group member read during its exec (011-259)",
  () => {
    it("lowers a member at the look after its first read, while young, came back empty", async () => {
      const { member, daemon, since } = await group((read) => read === 1, 0);
      const looks = counted(daemon);
      const third = looks.started(3);
      const settled = new AbortController();
      const lowering = lowerWhile(looks, "fast", since, settled.signal);
      onTestFinished(async () => {
        settled.abort();
        await lowering;
      });
      // The first look scans the group and reads it empty; the second, with no reap since, reads it again.
      await third;
      expect({ reads: member.reads, found: looks.found, nice: getPriority(member.pid) }).toEqual({
        reads: 2,
        found: [member.pid],
        nice: TEST_NICE,
      });
    });

    it("reads a member with no mark once when it is 100 ms old at its first read, as before", async () => {
      const { member, sleeper, look } = await group(() => true, TICKS_PER_SECOND);
      expect(await look()).toEqual([]);
      expect(await look()).toEqual([]);
      // Another child of the daemon reaped, a scan's least interval later: the next look scans.
      await sleeper("slow:vitest");
      await sleep(1_100);
      expect(await look()).toEqual([]);
      expect(member.reads).toBe(1);
    });

    it("keeps a member unmarked once it is 100 ms old, its reads still empty", async () => {
      const { member, look } = await group(() => true, 0);
      expect(await look()).toEqual([]);
      expect(await look()).toEqual([]);
      member.age = TICKS_PER_SECOND / 10 + 1;
      expect(await look()).toEqual([]);
      expect(await look()).toEqual([]);
      expect(member.reads).toBe(3);
    });

    it("does not read a member again once it exited", async () => {
      const { member, look } = await group(() => true, 0);
      expect(await look()).toEqual([]);
      process.kill(member.pid, "SIGKILL");
      for (let waited = 0; waited < 3_000 && statOf(member.pid) !== null; waited += 20)
        await sleep(20);
      expect(await look()).toEqual([]);
      expect(member.reads).toBe(1);
    });
  },
);
