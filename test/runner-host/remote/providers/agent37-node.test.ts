import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ensureNode } from "../../../../src/core/runner-host/remote/providers/agent37/bootstrap.js";
import type { SshTarget } from "../../../../src/core/runner-host/remote/ssh.js";
import { fakeSshAt } from "./agent37-api-mock.js";

/*
 * Row 026-22: Node 25 and later ship no corepack. The Agent37 bootstrap
 * links only the Node binaries that exist, so no dangling `corepack` link
 * is left on the login's `PATH` (an earlier bootstrap's is removed), and
 * runs `corepack enable` only when corepack is there. Over a fake `ssh`
 * whose "instance" is a directory here; the installed Node is a fake under
 * `~/.local/node-v<version>`, so nothing is downloaded.
 */

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-agent37-node-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const VERSION = "99.1.0";

function script(path: string, lines: readonly string[]): void {
  writeFileSync(path, ["#!/bin/sh", ...lines, ""].join("\n"));
  chmodSync(path, 0o755);
}

let n = 0;
/** A fake instance whose Node `VERSION` is installed already, with `corepack` or without. */
function setup(corepack: boolean) {
  const dir = join(scratch, `s${++n}`);
  const ssh = fakeSshAt(dir);
  const bin = join(ssh.home, `.local/node-v${VERSION}/bin`);
  mkdirSync(bin, { recursive: true });
  script(join(bin, "node"), [`echo v${VERSION}`]);
  script(join(bin, "npm"), ["exit 0"]);
  script(join(bin, "npx"), ["exit 0"]);
  const enabled = join(dir, "corepack-calls");
  if (corepack) script(join(bin, "corepack"), [`echo "$*" >> ${JSON.stringify(enabled)}`]);
  const old = join(dir, "old-node");
  script(old, ["echo v1.0.0"]);
  const target: SshTarget = {
    destination: "node@box",
    env: { ...process.env, PATH: `${ssh.bin}:${process.env.PATH}` },
  };
  const links = join(ssh.home, ".local/bin");
  return { ssh, bin, enabled, old, target, links };
}

describe("the Agent37 Node bootstrap without corepack (row 026-22)", { timeout: 30_000 }, () => {
  it("links only the binaries Node has and leaves no dangling corepack link", async () => {
    const s = setup(false);
    // An earlier bootstrap linked corepack unconditionally: that link dangles now.
    mkdirSync(s.links, { recursive: true });
    symlinkSync(join(s.bin, "corepack"), join(s.links, "corepack"));
    const node = await ensureNode(s.target, s.old, `v${VERSION}`, 20_000);
    expect(node).toBe(join(s.bin, "node"));
    for (const name of ["node", "npm", "npx"]) {
      expect(readlinkSync(join(s.links, name))).toBe(join(s.bin, name));
    }
    expect(() => lstatSync(join(s.links, "corepack"))).toThrow(/ENOENT/);
    expect(existsSync(s.enabled)).toBe(false);
    expect(readFileSync(join(s.ssh.home, ".profile"), "utf8")).toContain("squeal-agent37");
  });

  it("links corepack and enables it when Node has it", async () => {
    const s = setup(true);
    await ensureNode(s.target, s.old, `v${VERSION}`, 20_000);
    expect(readlinkSync(join(s.links, "corepack"))).toBe(join(s.bin, "corepack"));
    expect(readFileSync(s.enabled, "utf8").trim()).toBe(`enable --install-directory ${s.links}`);
  });
});

/*
 * Row 026-29: an image with no `xz` (such as `agent37-ubuntu`) gets the
 * `.tar.gz` build; one with `xz` the `.tar.xz`. A fake `curl` serves a
 * real archive of a fake Node and its `SHASUMS256.txt` from here, so the
 * real `sha256sum` checks it and the real `tar` unpacks it: nothing is
 * downloaded. The `PATH` holds only links to the tools the script needs,
 * with `xz` or without.
 */
const TOOLS = [
  "sh",
  "uname",
  "mktemp",
  "cat",
  "grep",
  "sha256sum",
  "mkdir",
  "tar",
  "gzip",
  "rm",
  "ln",
  "touch",
  "mv",
  "dirname",
  "env",
];

function which(tool: string): string | null {
  try {
    return (
      execFileSync("sh", ["-c", `command -v ${tool}`])
        .toString()
        .trim() || null
    );
  } catch {
    return null;
  }
}

const XZ = which("xz");

/** A fake instance with no Node, whose `curl` serves archives built here, with `xz` on its PATH or not. */
function fetching(xz: boolean) {
  const dir = join(scratch, `f${++n}`);
  const ssh = fakeSshAt(dir);
  const arch = execFileSync("uname", ["-m"]).toString().trim();
  const a = arch === "x86_64" ? "x64" : arch === "aarch64" ? "arm64" : arch;
  const dist = join(dir, "dist");
  const base = `node-v${VERSION}-linux-${a}`;
  mkdirSync(join(dist, base, "bin"), { recursive: true });
  script(join(dist, base, "bin", "node"), [`echo v${VERSION}`]);
  const sums: string[] = [];
  const kinds: [string, string][] = [["gz", "-czf"]];
  if (XZ !== null) kinds.push(["xz", "-cJf"]);
  for (const [ext, flag] of kinds) {
    const file = `${base}.tar.${ext}`;
    execFileSync("tar", [flag, join(dist, file), "-C", dist, base]);
    sums.push(
      `${createHash("sha256")
        .update(readFileSync(join(dist, file)))
        .digest("hex")}  ${file}`,
    );
  }
  writeFileSync(join(dist, "SHASUMS256.txt"), `${sums.join("\n")}\n`);
  const fetched = join(dir, "fetched");
  // `curl -fsSLO <url>` saves the file here; `curl -fsSL <url>` prints it.
  script(join(ssh.bin, "curl"), [
    `for u in "$@"; do :; done; f=\${u##*/}; echo "$f" >> ${JSON.stringify(fetched)}`,
    `case "$1" in -fsSLO) cat ${JSON.stringify(dist)}/"$f" > "$f";; *) cat ${JSON.stringify(dist)}/"$f";; esac`,
  ]);
  const tools = join(dir, "tools");
  mkdirSync(tools);
  for (const tool of [...TOOLS, ...(xz ? ["xz"] : [])]) {
    const path = which(tool);
    if (path !== null) symlinkSync(path, join(tools, tool));
  }
  const target: SshTarget = {
    destination: "root@box",
    env: { ...process.env, PATH: `${ssh.bin}:${tools}` },
  };
  const old = join(dir, "old-node");
  script(old, ["echo v1.0.0"]);
  return {
    ssh,
    target,
    old,
    fetched,
    installed: join(ssh.home, `.local/node-v${VERSION}/bin/node`),
    base,
  };
}

describe("the Agent37 Node bootstrap's archive (row 026-29)", { timeout: 30_000 }, () => {
  it("fetches the .tar.gz when the image has no xz", async () => {
    const f = fetching(false);
    const node = await ensureNode(f.target, f.old, `v${VERSION}`, 20_000);
    expect(node).toBe(f.installed);
    expect(readFileSync(f.fetched, "utf8").trim().split("\n")).toEqual([
      `${f.base}.tar.gz`,
      "SHASUMS256.txt",
    ]);
    expect(execFileSync(f.installed).toString().trim()).toBe(`v${VERSION}`);
  });

  it.skipIf(XZ === null)("fetches the .tar.xz when the image has xz", async () => {
    const f = fetching(true);
    const node = await ensureNode(f.target, f.old, `v${VERSION}`, 20_000);
    expect(node).toBe(f.installed);
    expect(readFileSync(f.fetched, "utf8").trim().split("\n")).toEqual([
      `${f.base}.tar.xz`,
      "SHASUMS256.txt",
    ]);
    expect(execFileSync(f.installed).toString().trim()).toBe(`v${VERSION}`);
  });
});
