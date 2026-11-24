import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  closeMaster,
  controlSocket,
  multiplexed,
  sshArgs,
} from "../../../src/core/runner-host/remote/ssh.js";

/*
 * Spec 026 D8.1 (row 026-11): the channels of one machine share one
 * connection when the user's own `ssh` runs them; a fake `ssh` never
 * multiplexes. The connection ends at the machine's sleep, only when its
 * socket is there.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-ssh-multiplex-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("one connection per awake machine (row 026-11)", () => {
  it("names a short socket for the user's ssh, and none for another ssh program", () => {
    const socket = controlSocket({ destination: "box" }, "agent37:eu:vm:abc", "/home/me/app");
    expect(socket).toMatch(/^\/tmp\/squeal-ssh-[0-9a-f]{16}$/);
    expect(controlSocket({ destination: "box" }, "agent37:eu:vm:abc", "/home/me/other")).not.toBe(
      socket,
    );
    expect(controlSocket({ destination: "box", ssh: "/fake/ssh" }, "m", "/r")).toBeNull();
  });

  it("adds the master's flags after the target's own, whose choices win", () => {
    const target = multiplexed({ destination: "box", args: ["-p", "2222"] }, "/tmp/s", 600);
    expect(sshArgs(target, "true")).toEqual([
      "-T",
      "-o",
      "BatchMode=yes",
      "-p",
      "2222",
      "-o",
      "ControlMaster=auto",
      "-o",
      "ControlPath=/tmp/s",
      "-o",
      "ControlPersist=600",
      "box",
      "true",
    ]);
    expect(multiplexed({ destination: "box" }, "/tmp/s", 0.5).args?.at(-1)).toBe(
      "ControlPersist=1",
    );
  });

  it("ends the master through its socket, and runs nothing when no socket is there", async () => {
    const calls = join(scratch, "calls");
    const ssh = join(scratch, "ssh");
    writeFileSync(ssh, `#!/bin/sh\necho "$*" >> ${JSON.stringify(calls)}\n`);
    chmodSync(ssh, 0o755);
    const target = { destination: "box", ssh };
    await closeMaster(target, join(scratch, "no-socket"));
    expect(() => readFileSync(calls, "utf8")).toThrow();
    const socket = join(scratch, "socket");
    writeFileSync(socket, "");
    await closeMaster(target, socket);
    expect(readFileSync(calls, "utf8")).toBe(`-o ControlPath=${socket} -O exit box\n`);
  });
});
