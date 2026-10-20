import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { type E2E, e2eSuite, MATH, OTHER_SESSION, PLUGINS, until } from "./harness.js";

/*
 * Task 011-08 (gh-22, spec 011 C8 and C9), end to end for each hook plugin:
 * after `squeal stop`, the boundary of the Bash call that ran it, the turn's
 * Stop and a new session's start each start no daemon and say why; the next
 * edit's boundary starts one; `squeal start` clears the stop.
 */

const fixture = e2eSuite();
/** Longer than a spawned daemon takes to answer on a calm host (about 300 ms). */
const NO_DAEMON_MS = 3_000;
/** Codex names the CLI by its path, so the command is left out. */
const STOPPED = "The daemon is stopped by request (`";

async function registered(e: E2E): Promise<number> {
  await e.hook("session-start", e.main);
  const ping = await e.daemonReady(e.main);
  await e.settle(e.main, "a passing baseline", (s) => s.counts.current > 0);
  await e.hook("post-tool-batch", e.main);
  return ping.pid;
}

async function stop(e: E2E): Promise<void> {
  const stopped = await e.cli(e.main, ["stop"]);
  expect(stopped).toMatchObject({ code: 0, stdout: `Squeal daemon stopped for ${e.main}\n` });
  expect(await e.ping(e.main)).toBeNull();
}

describe.each(PLUGINS)("an explicit squeal stop, $name", (plugin) => {
  it("holds at every boundary until the next edit", async (ctx) => {
    const e = fixture(ctx, plugin);
    const first = await registered(e);
    await stop(e);

    const batch = await e.hook("post-tool-batch", e.main);
    expect(batch).toMatchObject({ code: 0, stderr: "" });
    expect(batch.text).toMatch(/^SQUEAL · the daemon is stopped by request at revision \d+\n/);
    expect(batch.text).toContain(STOPPED);
    expect(batch.text).not.toContain("Not validated");
    expect((await e.hook("stop", e.main)).code).toBe(0);
    const start = await e.hook("session-start", e.main, { session_id: OTHER_SESSION });
    expect(start.text).toContain(STOPPED);
    await sleep(NO_DAEMON_MS);
    expect(await e.ping(e.main)).toBeNull();
    // Row 011-29: the default text's `Outstanding:` line says so, `--full`'s `Daemon:` line too.
    const status = await e.cli(e.main, ["status"]);
    expect(status.stdout).toMatch(/^ {2}no daemon has validated[^\n]*; stopped by request \(`/m);

    e.write(e.main, "math", MATH("+"));
    await e.hook("post-tool-batch", e.main);
    const second = await e.daemonReady(e.main, first);
    expect(second.pid).not.toBe(first);
  }, 240_000);

  it("is cleared by squeal start", async (ctx) => {
    const e = fixture(ctx, plugin);
    await registered(e);
    await stop(e);

    expect((await e.cli(e.main, ["start"])).code).toBe(0);
    const started = await e.daemonReady(e.main);
    // With the mark gone, a daemon that dies unasked is replaced at the next session's start.
    process.kill(started.pid, "SIGKILL");
    await until("the killed daemon to stop answering", 10_000, async () =>
      (await e.ping(e.main)) === null ? true : null,
    );
    const start = await e.hook("session-start", e.main, { session_id: OTHER_SESSION });
    expect(start.text).not.toContain(STOPPED);
    await e.daemonReady(e.main, started.pid);
  }, 240_000);
});
