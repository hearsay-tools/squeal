import { describe, expect, it } from "vitest";
import { STATIC_CAPABILITIES } from "../../../src/core/runner-host/remote/provider.js";
import { sshProvider } from "../../../src/core/runner-host/remote/providers/ssh.js";
import { sshArgs } from "../../../src/core/runner-host/remote/ssh.js";

/*
 * Spec 026 D6.1, D7.1 (row 026-10): the `ssh` provider is 021's static
 * target behind the machine seam, and `SshTarget.args` go before the
 * destination.
 */

const REQUEST = {
  repositoryKey: "/repo",
  worktreeId: "w",
  worktreeRoot: "/repo",
  commonDir: "/repo/.git",
  remoteUrls: [],
  nodeVersion: "v26.13.0",
  log: () => {},
};

describe("sshArgs (row 026-10)", () => {
  it("is 021's arguments for a target with no args", () => {
    expect(sshArgs({ destination: "box" }, "true")).toEqual([
      "-T",
      "-o",
      "BatchMode=yes",
      "box",
      "true",
    ]);
  });

  it("puts the target's args after BatchMode and before the destination", () => {
    expect(sshArgs({ destination: "me@host", args: ["-p", "2222"] }, "true")).toEqual([
      "-T",
      "-o",
      "BatchMode=yes",
      "-p",
      "2222",
      "me@host",
      "true",
    ]);
  });
});

describe("the ssh provider (row 026-10)", () => {
  it("makes the target a static machine: its id, no args, no capability", async () => {
    const machine = await sshProvider.acquire(REQUEST, {
      target: "build-box",
      node: "node",
      cache: ".squeal-remote",
    });
    expect(machine).toMatchObject({
      id: "build-box",
      provider: "ssh",
      ssh: { destination: "build-box" },
      places: { node: "node", cache: ".squeal-remote" },
      capabilities: STATIC_CAPABILITIES,
    });
    // 021's target had no other field: ssh runs with the daemon's env and no extra flags.
    expect(machine.ssh).toEqual({ destination: "build-box" });
    await expect(machine.wake()).resolves.toBeUndefined();
    await expect(machine.sleep()).resolves.toBeUndefined();
    await expect(machine.release("worktree-removed")).resolves.toBeUndefined();
  });

  it("passes its args to ssh", async () => {
    const machine = await sshProvider.acquire(REQUEST, {
      target: "me@host",
      args: ["-i", "/k"],
      node: "node",
      cache: "c",
    });
    expect(machine.ssh).toEqual({ destination: "me@host", args: ["-i", "/k"] });
  });

  it("validates the target as 021 did", () => {
    const base = { node: "node", cache: "c" };
    expect(sshProvider.validate({ ...base, target: "box" })).toBeNull();
    expect(sshProvider.validate({ ...base, target: "-oProxyCommand=x" })).toMatch(/"target"/);
    expect(sshProvider.validate({ ...base })).toMatch(/"target"/);
    expect(sshProvider.validate({ ...base, target: "box", args: [1] })).toMatch(/"args"/);
    expect(sshProvider.validate({ ...base, target: "box", acquire: ["x"] })).toMatch(
      /unknown key "acquire"/,
    );
  });
});
