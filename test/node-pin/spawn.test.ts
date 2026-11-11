import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureDaemonProcess } from "../../src/core/daemon/ensure.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { fakeRepo } from "../status/helpers.js";
import { tempDir } from "../store/helpers.js";
import { fakeNode, nvmNode, setProcessEnv } from "./helpers.js";

/*
 * Spec 018 D18 (row 018-30) at the daemon's real spawn: with an exact pin
 * installed, the daemon starts on that Node with its directory first in
 * `PATH`; with no pin, a range, a version not installed or below Squeal's
 * minimum, or `node: "session"`, on the Node of its caller with `PATH` as it
 * was. The pinned
 * Node is a fake under a temporary HOME that records its start instead of
 * running the CLI; the caller's Node runs a stand-in CLI that records its own.
 */

const PINNED = "99.1.2";
let restore: () => void;
let home: string;
let record: string;
let cli: string;

beforeEach(() => {
  home = tempDir("squeal-node-pin-home-");
  const path = [dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter);
  restore = setProcessEnv({ HOME: home, N_PREFIX: join(home, "n"), PATH: path });
  const dir = tempDir("squeal-node-pin-cli-");
  record = join(dir, "started");
  cli = join(dir, "cli.mjs");
  writeFileSync(
    cli,
    `import { renameSync, writeFileSync } from "node:fs";
const lines = [process.execPath, process.env.PATH, ...process.argv.slice(1)];
writeFileSync(${JSON.stringify(`${record}.tmp`)}, lines.join("\\n") + "\\n");
renameSync(${JSON.stringify(`${record}.tmp`)}, ${JSON.stringify(record)});
`,
  );
});

afterEach(() => restore());

/** The daemon of a fresh worktree with `files`: the Node it started on, its PATH and arguments. */
async function start(files: Readonly<Record<string, string>>) {
  const root = fakeRepo().main as AbsolutePath;
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
  const daemon = await ensureDaemonProcess(root, {
    cli: cli as AbsolutePath,
    env: {},
    awaitLockMs: 1,
  });
  expect(daemon.result).toBe("spawned");
  for (let i = 0; i < 250 && !existsSync(record); i++) await sleep(20);
  const [node, path, ...args] = readFileSync(record, "utf8").trimEnd().split("\n");
  expect(args).toEqual([cli, "daemon", root, "--await-lock", "1"]);
  return { node, path };
}

describe("the daemon's Node (018 D18)", () => {
  it("is the installed pinned Node, its directory first in PATH", async () => {
    const binary = fakeNode(nvmNode(home, PINNED), PINNED, { record });
    expect(await start({ ".node-version": `v${PINNED}\n` })).toEqual({
      node: binary,
      path: `${dirname(binary)}${delimiter}${process.env.PATH}`,
    });
  });

  it.each([
    ["no pin", {}],
    ["a range", { ".nvmrc": "lts/*\n" }],
    ["a version not installed", { ".node-version": "v99.1.3\n" }],
    ["a version below Squeal's minimum", { ".node-version": "v20.11.0\n" }],
    [
      '`node: "session"`',
      { ".node-version": PINNED, "squeal.config.json": JSON.stringify({ node: "session" }) },
    ],
  ])("is the caller's Node with PATH unchanged for %s", async (_, files) => {
    fakeNode(nvmNode(home, PINNED), PINNED, { record });
    fakeNode(nvmNode(home, "20.11.0"), "20.11.0", { record });
    expect(await start(files)).toEqual({ node: process.execPath, path: process.env.PATH });
  });
});
