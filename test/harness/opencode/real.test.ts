import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { bridgeStart } from "../../../src/harness/opencode/bridge-client.js";
import { awaitBridges, bridgeCommand } from "./real.js";

/*
 * Review 011-336 B1 (and its re-review): `awaitBridges` waits for, and at its deadline kills,
 * only the plugin's bridges of this run: Node started with exactly the arguments `bridgeStart`
 * builds for a hook entry of the run's built `dist`, leading a detached group of its own, with
 * the run's private HOME. Every other process stays untouched, even one whose command line names
 * a hook file. Linux only: the identity is read from `/proc`.
 */

const base = mkdtempSync(join(tmpdir(), "squeal-oc-bridges-"));
const dist = join(base, "dist");
const entry = join(dist, "hooks", "end.mjs");
/** The run's private HOME, as `runOpenCode` gives it to OpenCode and so to every bridge. */
const home = join(base, "run", "home");
mkdirSync(join(dist, "hooks"), { recursive: true });
mkdirSync(home, { recursive: true });
// A bridge stand-in: it marks its start; starts a child in its group when `CHILD_MS` is set, which
// marks its own end after that time; and lives until `RELEASE` exists, for ever without it.
writeFileSync(
  entry,
  `import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
const { CHILD_MS, CHILD_DONE, RELEASE, STARTED } = process.env;
if (CHILD_MS !== undefined) {
  const code = \`setTimeout(() => require("fs").writeFileSync(\${JSON.stringify(CHILD_DONE)}, ""), \${CHILD_MS})\`;
  spawn(process.execPath, ["-e", code], { stdio: "ignore" }).unref();
}
writeFileSync(STARTED, "");
const timer = setInterval(() => {
  if (RELEASE !== undefined && existsSync(RELEASE)) clearInterval(timer);
}, 10);
`,
);

/** This process's environment without Node's proxy switch, so `bridgeStart`'s plain form is plain. */
const { NODE_USE_ENV_PROXY: _proxy, ...unproxied } = process.env;
/** `bridgeStart`'s two forms: without Node's proxy switch, and with it, carried by a preload. */
const FORMS = { plain: unproxied, proxy: { ...unproxied, NODE_USE_ENV_PROXY: "1" } } as const;
type Form = keyof typeof FORMS;

/** A bridge of `entry` as the plugin starts it, in `form`, with `env` added to its environment. */
function asPlugin(form: Form, env: Record<string, string>, hook = entry) {
  const start = bridgeStart(hook, FORMS[form]);
  return { args: start.args, env: { ...start.env, ...env } };
}

const spawned: ChildProcess[] = [];
afterEach(() => {
  for (const child of spawned.splice(0)) {
    if (child.pid === undefined) continue;
    for (const target of [-child.pid, child.pid]) {
      try {
        process.kill(target, "SIGKILL");
      } catch {
        // Gone.
      }
    }
  }
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

let made = 0;
/** A fresh marker path under `base`. */
const marker = (name: string) => join(base, `${name}-${made++}`);

/** `command` as a disposable process of the test's; `started` is its own mark, if it makes one. */
async function start(
  command: string,
  args: string[],
  options: { detached: boolean; env?: NodeJS.ProcessEnv; started?: string },
): Promise<ChildProcess> {
  const child = spawn(command, args, {
    detached: options.detached,
    stdio: "ignore",
    env: options.env ?? process.env,
  });
  spawned.push(child);
  await once(child, "spawn");
  for (
    let waited = 0;
    options.started !== undefined && !existsSync(options.started);
    waited += 10
  ) {
    if (waited > 10_000) throw new Error(`${command} never marked its start`);
    await new Promise((done) => setTimeout(done, 10));
  }
  return child;
}

const running = (child: ChildProcess) => child.exitCode === null && child.signalCode === null;

/** `awaitBridges` with a grace that a wrong wait would use up; its time and outcome. */
async function timed(owned: { home: string }, graceMs: number) {
  const began = Date.now();
  const outcome = await awaitBridges(dist, owned, graceMs).then(
    () => "resolved",
    (error: Error) => error.message,
  );
  return { outcome, ms: Date.now() - began };
}

// Re-review 011-336-r2: the rule has one owner, the command `bridgeStart` builds.
describe("the bridge command", () => {
  const selects = bridgeCommand(dist);
  const node = process.execPath;
  const flag = bridgeStart(entry, FORMS.plain).args[0] ?? "";

  it("is exactly what bridgeStart builds for a hook entry of the dist, in both its forms", () => {
    const plain = bridgeStart(entry, FORMS.plain).args;
    const proxy = bridgeStart(entry, FORMS.proxy).args;
    // The proxy form is the other form: it carries the switch past Node's start with a preload.
    expect(plain).not.toContain("--import");
    expect(proxy).toContain("--import");
    expect(selects([node, ...plain])).toBe(true);
    expect(selects([node, ...proxy])).toBe(true);
    expect(selects(["node", ...plain])).toBe(true);
  });

  it("is nothing else that names a hook entry", () => {
    const preload = bridgeStart(entry, FORMS.proxy).args;
    const observer = join(base, "observer.mjs");
    for (const argv of [
      [node, observer, entry],
      [node, flag, observer, entry],
      [node, entry],
      [node, ...bridgeStart(entry, FORMS.plain).args, "--flag"],
      [node, flag, "--import", "data:text/javascript,0", entry],
      [node, ...preload.slice(0, -1), "--trace-warnings", entry],
      [node, ...bridgeStart(join(dist, "hooks", "sub", "end.mjs"), FORMS.plain).args],
      [node, ...bridgeStart(join(base, "other", "hooks", "end.mjs"), FORMS.plain).args],
      [node, ...bridgeStart(join(dist, "hooks", "end.cjs"), FORMS.plain).args],
      [node],
      [],
    ])
      expect(selects(argv), JSON.stringify(argv)).toBe(false);
  });
});

describe.skipIf(process.platform !== "linux")("awaitBridges", () => {
  it("leaves alone an unrelated process whose command line names a hook file", async () => {
    const observer = await start("tail", ["-f", entry], { detached: true });
    const { outcome, ms } = await timed({ home }, 20_000);
    expect(outcome).toBe("resolved");
    expect(ms).toBeLessThan(5_000);
    expect(running(observer)).toBe(true);
  });

  // Re-review 011-336-r2 B1: Node runs the observer; the hook path is only its data argument.
  it("leaves alone a Node process of this run that only names a hook entry", async () => {
    const started = marker("started");
    const observer = join(base, "observer.mjs");
    writeFileSync(
      observer,
      `import { writeFileSync } from "node:fs";\nwriteFileSync(process.env.STARTED, "");\nsetInterval(() => {}, 1000);\n`,
    );
    const child = await start(process.execPath, [observer, entry], {
      detached: true,
      env: { ...unproxied, HOME: home, STARTED: started },
      started,
    });
    const { outcome, ms } = await timed({ home }, 20_000);
    expect(outcome).toBe("resolved");
    expect(ms).toBeLessThan(5_000);
    expect(running(child)).toBe(true);
  });

  it("leaves alone a bridge of another run, with another HOME", async () => {
    const started = marker("started");
    const other = join(base, "other-run", "home");
    const { args, env } = asPlugin("plain", { HOME: other, STARTED: started });
    const bridge = await start(process.execPath, args, { detached: true, env, started });
    const { outcome, ms } = await timed({ home }, 20_000);
    expect(outcome).toBe("resolved");
    expect(ms).toBeLessThan(5_000);
    expect(running(bridge)).toBe(true);
  });

  it("leaves alone a bridge command run inside a group it does not lead", async () => {
    const started = marker("started");
    const { args, env } = asPlugin("plain", { HOME: home, STARTED: started });
    // A detached shell leads the group; its Node child runs the bridge command with the run's HOME.
    const leader = await start("sh", ["-c", `"$0" "$@"; exit 0`, process.execPath, ...args], {
      detached: true,
      env,
      started,
    });
    const { outcome, ms } = await timed({ home }, 20_000);
    expect(outcome).toBe("resolved");
    expect(ms).toBeLessThan(5_000);
    expect(running(leader)).toBe(true);
  });

  it.each(Object.keys(FORMS) as Form[])(
    "waits for this run's bridge in bridgeStart's %s form and for the child that outlives it, and kills nothing",
    async (form) => {
      const [started, release, childDone] = [marker("started"), marker("release"), marker("done")];
      const { args, env } = asPlugin(form, {
        HOME: home,
        STARTED: started,
        RELEASE: release,
        CHILD_MS: "1500",
        CHILD_DONE: childDone,
      });
      const bridge = await start(process.execPath, args, { detached: true, env, started });
      const exited = once(bridge, "exit");
      // `awaitBridges` takes the bridges at its call; the bridge then ends, its child lives on.
      const waiting = awaitBridges(dist, { home }, 20_000);
      writeFileSync(release, "");
      expect(await exited).toEqual([0, null]);
      expect(existsSync(childDone)).toBe(false);
      await waiting;
      expect(existsSync(childDone)).toBe(true);
    },
  );

  it("kills this run's bridge still there after the grace, and fails naming it", async () => {
    const started = marker("started");
    const { args, env } = asPlugin("plain", { HOME: home, STARTED: started });
    const bridge = await start(process.execPath, args, { detached: true, env, started });
    const exited = once(bridge, "exit");
    const { outcome } = await timed({ home }, 300);
    expect(outcome).toMatch(
      new RegExp(`still ran 300 ms after OpenCode ended; killed: ${bridge.pid} .*hooks/end\\.mjs`),
    );
    expect(await exited).toEqual([null, "SIGKILL"]);
  });
});
