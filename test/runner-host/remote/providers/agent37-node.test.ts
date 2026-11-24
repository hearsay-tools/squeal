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
