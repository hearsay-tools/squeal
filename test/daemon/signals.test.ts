import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cgroupUnit, signalNote } from "../../src/core/daemon/signals.js";

/*
 * Row 011-250 (gh-1, `research/issue-1.md` sections 3 and 5): a daemon a
 * signal stops names the signal and the systemd unit whose control group it
 * ran in, read from `/proc/self/cgroup`; here from a file in its place.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A `/proc/self/cgroup` stand-in with `text`. */
function cgroupFile(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), "sq-011-250-"));
  dirs.push(dir);
  const path = join(dir, "cgroup");
  writeFileSync(path, text);
  return path;
}

describe("the unit a signal stop names (row 011-250)", () => {
  it("names the deepest service of the unified hierarchy: the cockpit's, not the user manager", () => {
    const path = cgroupFile(
      "0::/user.slice/user-1001.slice/user@1001.service/app.slice/cezar.service\n",
    );
    expect(cgroupUnit(path)).toBe("cezar.service");
  });

  it("names a login session's scope", () => {
    expect(cgroupUnit(cgroupFile("0::/user.slice/user-1000.slice/session-4.scope\n"))).toBe(
      "session-4.scope",
    );
  });

  it("under cgroup v1, reads the name=systemd hierarchy and no controller's", () => {
    const path = cgroupFile(
      [
        "12:cpu,cpuacct:/docker.service",
        "1:name=systemd:/system.slice/actions.runner.service",
        "",
      ].join("\n"),
    );
    expect(cgroupUnit(path)).toBe("actions.runner.service");
  });

  it("names nothing at a cgroup root, as in a container, nor in a slice alone", () => {
    expect(cgroupUnit(cgroupFile("0::/\n"))).toBeNull();
    expect(cgroupUnit(cgroupFile("0::/user.slice/user-1000.slice\n"))).toBeNull();
  });

  it("names nothing, and throws nothing, when the file cannot be read or parsed", () => {
    const dir = mkdtempSync(join(tmpdir(), "sq-011-250-"));
    dirs.push(dir);
    // Off Linux there is no file; a directory fails the read another way.
    expect(cgroupUnit(join(dir, "none"))).toBeNull();
    expect(cgroupUnit(dir)).toBeNull();
    expect(cgroupUnit(cgroupFile(""))).toBeNull();
    expect(cgroupUnit(cgroupFile("not a cgroup line\n\u0000\u00ff::\n0:\n"))).toBeNull();
  });

  it("names nothing from a row with a bad header or a relative path (review 0.1.350, N1)", () => {
    // A unified row's hierarchy is 0; a v1 row's is a number; a path is absolute.
    expect(cgroupUnit(cgroupFile("0::cezar.service\n"))).toBeNull();
    expect(cgroupUnit(cgroupFile("garbage:name=systemd:/wrong.service\n"))).toBeNull();
    expect(
      cgroupUnit(cgroupFile("1::/wrong.service\n0:name=systemd:x/wrong.service\n")),
    ).toBeNull();
    // A bad row before a valid one: the valid one names its unit.
    const path = cgroupFile("0::cezar.service\n1:name=systemd:/system.slice/a.service\n");
    expect(cgroupUnit(path)).toBe("a.service");
  });

  it("reads a valid path with colons in it", () => {
    expect(cgroupUnit(cgroupFile("0::/app.slice/a:b.service\n"))).toBe("a:b.service");
    expect(cgroupUnit(cgroupFile("3:name=systemd:/x:y/c.scope\n"))).toBe("c.scope");
  });

  it("the note names the signal, the unit when there is one, and what starts the next daemon", () => {
    expect(signalNote("SIGTERM", "cezar.service")).toBe(
      "daemon stopped: SIGTERM while it ran in systemd unit cezar.service; the next Squeal hook starts a new daemon, or `squeal start` starts one now",
    );
    expect(signalNote("SIGHUP", null)).toBe(
      "daemon stopped: SIGHUP; the next Squeal hook starts a new daemon, or `squeal start` starts one now",
    );
  });
});
