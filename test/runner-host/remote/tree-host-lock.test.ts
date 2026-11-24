import { execFile } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { createTreeHost } from "../../../src/core/runner-host/remote/tree-host.js";
import { treeBlob } from "../../../src/core/runner-host/remote/tree-wire.js";

/*
 * Review 0.1.617 B2: hosts that share one remote tree (spec 026 D8.1)
 * install one at a time under `install.lock`. A host takes over the lock
 * of a host that died only while it still holds that dead owner, so it
 * never removes a live host's lock, and removes only its own lock after
 * its install.
 */

const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const TREE_HOST = pathToFileURL(
  resolve(import.meta.dirname, "../../../src/core/runner-host/remote/tree-host.ts"),
).href;
const run = promisify(execFile);

const scratch = mkdtempSync(join(tmpdir(), "squeal-tree-host-lock-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** No process has this id: the owner of a lock left by a host that died. */
const DEAD = "999999999";

/*
 * One host's install in its own process, `role` `a` or `b`. Host `a` wraps
 * Node's file reads (no return value changes): when a read of the lock
 * first returns the dead owner, it signals `a-paused` and waits for `go-a`;
 * when a later read returns another owner, it signals `a-saw-other`. Host
 * `nolink` has no hard links. The script prints the install's answer.
 */
const HOST = `
import fs from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
const [root, role, signals] = process.argv.slice(2);
const signal = (name) => fs.writeFileSync(join(signals, name), "");
if (role === "a") {
  const { readFileSync } = fs;
  const { readFile } = fsp;
  const isLock = (path) => /install\\.lock(\\/pid)?$/.test(String(path));
  let paused = false;
  const seen = (path, value) => {
    if (!isLock(path)) return false;
    const dead = String(value).startsWith(${JSON.stringify(DEAD)});
    if (!dead && paused) signal("a-saw-other");
    if (!dead || paused) return false;
    paused = true;
    signal("a-paused");
    return true;
  };
  fs.readFileSync = (path, ...rest) => {
    const value = readFileSync(path, ...rest);
    if (seen(path, value)) {
      const cell = new Int32Array(new SharedArrayBuffer(4));
      while (!fs.existsSync(join(signals, "go-a"))) Atomics.wait(cell, 0, 0, 5);
    }
    return value;
  };
  fsp.readFile = async (path, ...rest) => {
    const value = await readFile(path, ...rest);
    if (seen(path, value)) {
      while (!fs.existsSync(join(signals, "go-a"))) await new Promise((r) => setTimeout(r, 5));
    }
    return value;
  };
  syncBuiltinESMExports();
}
if (role === "nolink") {
  fs.linkSync = () => {
    throw Object.assign(new Error("EPERM: operation not permitted, link"), { code: "EPERM" });
  };
  syncBuiltinESMExports();
}
const { createTreeHost } = await import(${JSON.stringify(TREE_HOST)});
const env = { ...process.env, ROLE: role, SIGNALS: signals };
const answer = await createTreeHost(root, (text) => process.stderr.write(text), env).install();
process.stdout.write(JSON.stringify(answer));
`;

/**
 * A fake `npm`: it logs its start and end in `../installs`, and signals
 * `<role>-installing`; `b`'s waits for the signal `go-install` before it ends.
 */
const NPM = `#!/bin/sh
echo "start $ROLE" >> ../installs
: > "$SIGNALS/$ROLE-installing"
if [ "$ROLE" = b ]; then
  while [ ! -f "$SIGNALS/go-install" ]; do sleep 0.02; done
fi
mkdir -p node_modules
echo "end $ROLE" >> ../installs
`;

let n = 0;
/** A remote tree with a lockfile and a host's record of it, and a fake `npm` on `env`'s PATH. */
function sharedTree() {
  const dir = join(scratch, `t${++n}`);
  const root = join(dir, "root");
  const signals = join(dir, "signals");
  const bin = join(dir, "bin");
  for (const at of [root, signals, bin]) mkdirSync(at, { recursive: true });
  const held: Record<string, { blob: string }> = {};
  for (const name of ["package.json", "package-lock.json"]) {
    writeFileSync(join(root, name), "{}");
    held[name] = { blob: treeBlob(Buffer.from("{}")) };
  }
  writeFileSync(join(dir, "files.json"), JSON.stringify(held));
  writeFileSync(join(bin, "npm"), NPM);
  chmodSync(join(bin, "npm"), 0o755);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, SIGNALS: signals };
  return {
    root,
    signals,
    bin,
    env,
    lock: join(dir, "install.lock"),
    installs: () =>
      existsSync(join(dir, "installs")) ? readFileSync(join(dir, "installs"), "utf8") : "",
  };
}

async function until(names: readonly string[], dir: string): Promise<string> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const found = names.find((name) => existsSync(join(dir, name)));
    if (found !== undefined) return found;
    if (Date.now() > deadline) throw new Error(`no ${names.join(" or ")} in 30 s`);
    await new Promise((done) => setTimeout(done, 5));
  }
}

/** Starts a host of `root` in its own process, as `HOST`'s `role`. */
function hostProcess(root: string, signals: string, env: NodeJS.ProcessEnv) {
  const script = join(signals, "..", "host.mjs");
  writeFileSync(script, HOST);
  return (role: string) =>
    run(process.execPath, ["--import", TSX, script, root, role, signals], {
      env,
      timeout: 50_000,
    });
}

/** Sets the change time of `path` `ms` back. */
function age(path: string, ms: number): void {
  const then = new Date(Date.now() - ms);
  utimesSync(path, then, then);
}

describe("one install at a time on a shared remote tree (review 0.1.617 B2)", () => {
  it("never removes a live host's lock it read as a dead host's, nor installs beside it", {
    timeout: 60_000,
  }, async () => {
    const { root, signals, env, lock, installs } = sharedTree();
    writeFileSync(lock, `${DEAD} gone\n`);
    const host = hostProcess(root, signals, env);
    // `a` reads the dead owner and pauses before it acts on it.
    const a = host("a");
    await until(["a-paused"], signals);
    // `b` takes the dead host's lock over and installs, held.
    const b = host("b");
    await until(["b-installing"], signals);
    const held = readFileSync(lock, "utf8");
    // `a` resumes with the dead owner it read: before the repair it removed `b`'s lock and installed.
    writeFileSync(join(signals, "go-a"), "");
    const reached = await until(["a-saw-other", "a-installing"], signals);
    const during = { reached, lock: readFileSync(lock, "utf8"), installs: installs() };
    writeFileSync(join(signals, "go-install"), "");
    const answers = { a: JSON.parse((await a).stdout), b: JSON.parse((await b).stdout) };
    expect({ during, answers, installs: installs(), lockLeft: existsSync(lock) }).toEqual({
      during: { reached: "a-saw-other", lock: held, installs: "start b\n" },
      // `a` decides inside the lock, after `b` installed: nothing left to install.
      answers: { a: { ran: false, command: null }, b: { ran: true, command: "npm ci" } },
      installs: "start b\nend b\n",
      lockLeft: false,
    });
  });

  it("takes over at once the lock of a host that died", { timeout: 20_000 }, async () => {
    const { root, env, lock, installs } = sharedTree();
    writeFileSync(lock, `${DEAD} gone\n`);
    const started = Date.now();
    const answer = await createTreeHost(root, () => {}, { ...env, ROLE: "a" }).install();
    expect({ answer, fast: Date.now() - started < 5_000, installs: installs() }).toEqual({
      answer: { ran: true, command: "npm ci" },
      fast: true,
      installs: "start a\nend a\n",
    });
    expect(existsSync(lock)).toBe(false);
  });

  it("takes and removes its lock where the file system has no hard links", {
    timeout: 60_000,
  }, async () => {
    const { root, signals, env, lock, installs } = sharedTree();
    const { stdout } = await hostProcess(root, signals, env)("nolink");
    expect({
      answer: JSON.parse(stdout),
      installs: installs(),
      lockLeft: existsSync(lock),
    }).toEqual({
      answer: { ran: true, command: "npm ci" },
      installs: "start nolink\nend nolink\n",
      lockLeft: false,
    });
  });

  it("waits on a lock without an owner, then takes it over as a host's that died before it wrote one", {
    timeout: 20_000,
  }, async () => {
    const { root, env, lock, installs } = sharedTree();
    writeFileSync(lock, "");
    const install = createTreeHost(root, () => {}, { ...env, ROLE: "a" }).install();
    // A host publishing its owner takes no time; this one has had one second.
    await new Promise((done) => setTimeout(done, 1_000));
    expect({ installs: installs(), lock: readFileSync(lock, "utf8") }).toEqual({
      installs: "",
      lock: "",
    });
    age(lock, 60_000);
    expect(await install).toEqual({ ran: true, command: "npm ci" });
    expect(installs()).toBe("start a\nend a\n");
    expect(existsSync(lock)).toBe(false);
  });

  it("leaves the lock of a host that took it over while it installed", {
    timeout: 20_000,
  }, async () => {
    const { root, bin, env, lock, installs } = sharedTree();
    // An npm that sees its lock replaced, as by a host that judged this one dead.
    writeFileSync(
      join(bin, "npm"),
      `#!/bin/sh\nprintf '1 successor\\n' > ../install.lock\nmkdir -p node_modules\necho done >> ../installs\n`,
    );
    expect(await createTreeHost(root, () => {}, env).install()).toEqual({
      ran: true,
      command: "npm ci",
    });
    expect({ installs: installs(), lock: readFileSync(lock, "utf8") }).toEqual({
      installs: "done\n",
      lock: "1 successor\n",
    });
  });
});
