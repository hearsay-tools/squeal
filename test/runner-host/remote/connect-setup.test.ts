import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { squealVersion } from "../../../src/core/daemon/version.js";
import {
  type RemoteHostOptions,
  RemoteRefusal,
  startRemoteHost,
  treeDir,
} from "../../../src/core/runner-host/remote/connect.js";
import { SLOW } from "../../daemon/helpers.js";
import { buildBundle, fakeSsh, gitFixture, scratchDir } from "./helpers.js";

/*
 * Spec 026 D13.1 (row 026-35): `remote.setup` at connect, through a fake
 * `ssh` that runs each remote command in a directory of this machine. The
 * script runs once the tree has arrived and before the install; a second
 * connect finds its mark and does not run it; an edit runs it again; a
 * failure refuses the remote with its exit code and its last lines named.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-remote-connect-setup-"));
let cli = "";
beforeAll(async () => {
  cli = await buildBundle(join(scratch, "dist"));
}, SLOW.timeout);
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const places = { node: process.execPath, cache: ".cache" };
const SCRIPT = ".squeal/remote-setup.sh";

function remote(): { home: string; ssh: string } {
  const home = join(scratchDir, `remote-home-${randomUUID()}`);
  onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  return { home, ssh: fakeSsh(join(home, ".bin"), home) };
}

/** A fixture whose setup script appends its directory, whether the tree is there and whether it was installed, to `runs`. */
function fixture(runs: string, body = ""): { root: string; edit: (body: string) => void } {
  // A lockfile without dependencies: the connect installs (`installed.json`), offline and fast.
  const root = gitFixture("basic", {
    ".gitignore": ".squeal-logs/\nnode_modules/\n",
    "package-lock.json": `${JSON.stringify({ name: "squeal-fixture-vitest-basic", lockfileVersion: 3, requires: true, packages: { "": { name: "squeal-fixture-vitest-basic" } } })}\n`,
  });
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const edit = (more: string) => {
    mkdirSync(join(root, ".squeal"), { recursive: true });
    writeFileSync(
      join(root, SCRIPT),
      [
        "#!/bin/sh",
        `echo "$(pwd) $(test -e src/math.ts && echo tree) $(test -e ../installed.json && echo installed || echo before-install)" >> ${JSON.stringify(runs)}`,
        more,
        "",
      ].join("\n"),
    );
    chmodSync(join(root, SCRIPT), 0o755);
  };
  edit(body);
  return { root, edit };
}

async function connect(root: string, ssh: string, extra: Partial<RemoteHostOptions> = {}) {
  const lines: string[] = [];
  const host = await startRemoteHost({
    target: { destination: "build-box", ssh },
    places,
    launch: { execPath: process.execPath, execArgv: [], cli },
    version: squealVersion(),
    root,
    runner: "vitest",
    options: { childEnv: {} },
    policy: () => ({
      observe: false,
      exclude: [],
      excludeProjects: [],
      coverage: false,
      coverageChildren: false,
    }),
    log: (text) => lines.push(text),
    setup: SCRIPT,
    ...extra,
  });
  onTestFinished(() => host.adapter.close());
  return { host, lines };
}

const runsOf = (runs: string) =>
  existsSync(runs) ? readFileSync(runs, "utf8").trim().split("\n") : [];

describe("remote.setup at connect (row 026-35, D13.1)", SLOW, () => {
  it("runs once after the tree arrives, not again on reconnect, and again after an edit", async () => {
    const { home, ssh } = remote();
    const runs = join(home, "runs.txt");
    const { root, edit } = fixture(runs, "echo chrome installed");
    const first = await connect(root, ssh);
    const tree = join(home, treeDir(places, root));
    // In the tree's root, once the tree is there, before the install.
    expect(runsOf(runs)).toEqual([`${tree}/root tree before-install`]);
    expect(existsSync(join(tree, "installed.json"))).toBe(true);
    const ran = first.lines.indexOf(
      `build-box: remote.setup ${SCRIPT} ran (exit code 0):\nchrome installed`,
    );
    expect(ran).toBeGreaterThan(first.lines.findIndex((line) => line.includes(": tree of ")));
    expect(readdirSync(join(home, ".cache/squeal/setup"))).toHaveLength(1);
    await first.host.adapter.close();

    const again = await connect(root, ssh);
    expect(runsOf(runs)).toHaveLength(1);
    expect(again.lines.some((line) => line.includes("remote.setup"))).toBe(false);
    await again.host.adapter.close();

    edit("echo chrome 2 installed");
    const edited = await connect(root, ssh);
    expect(runsOf(runs)).toEqual([
      `${tree}/root tree before-install`,
      `${tree}/root tree installed`,
    ]);
    expect(edited.lines).toContain(
      `build-box: remote.setup ${SCRIPT} ran (exit code 0):\nchrome 2 installed`,
    );
    expect(readdirSync(join(home, ".cache/squeal/setup"))).toHaveLength(2);
  });

  it("refuses the remote on a failure, its exit code and last lines named, and tries again next connect", async () => {
    const { home, ssh } = remote();
    const runs = join(home, "runs.txt");
    const { root, edit } = fixture(
      runs,
      'echo "E: Unable to locate package google-chrome" >&2\nexit 100',
    );
    const refused = connect(root, ssh);
    await expect(refused).rejects.toThrow(RemoteRefusal);
    await expect(refused).rejects.toThrow(
      `remote.setup ${SCRIPT} failed on build-box (exit code 100): E: Unable to locate package google-chrome`,
    );
    // Refused before the install, whose lockfile is there.
    expect(existsSync(join(home, treeDir(places, root), "root/package-lock.json"))).toBe(true);
    expect(existsSync(join(home, treeDir(places, root), "installed.json"))).toBe(false);
    expect(runsOf(runs)).toHaveLength(1);
    edit("echo fixed");
    await connect(root, ssh);
    expect(runsOf(runs)).toHaveLength(2);
  });

  it("runs nothing without remote.setup", async () => {
    const { home, ssh } = remote();
    const runs = join(home, "runs.txt");
    const { root } = fixture(runs);
    const { lines } = await connect(root, ssh, { setup: null });
    expect(runsOf(runs)).toEqual([]);
    expect(lines.some((line) => line.includes("remote.setup"))).toBe(false);
    expect(existsSync(join(home, ".cache/squeal/setup"))).toBe(false);
  });
});
