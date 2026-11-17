import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { owedRegistration } from "../../../src/core/delivery/registration-owed.js";
import { COMMIT_GRACE_MS, callBridge } from "../../../src/harness/opencode/bridge-client.js";
import { VERDICT_SIGNAL } from "../../../src/harness/opencode/bridge-verdict.js";
import type { OcAnswers, OcConsumer } from "../../../src/harness/opencode/protocol.js";
import { type ServedWrites, serveWrites } from "../daemon-writes-helpers.js";
import { SESSION, type SquealRepo, squealRepo } from "../helpers.js";

/*
 * Row 005-109 (review 0.1.546 S1): OpenCode's bridge is a new process per call, so the next
 * call's bridge reads the store as the daemon wrote it. The plugin's call resolves a held
 * answer at its commit verdict; the bridge then commits, and the clear of the owed header goes
 * to the daemon. A bridge the plugin starts next, for a `read` tool, read the header still owed
 * and said it again. The call now resolves once the bridge that got the verdict exited, after
 * the daemon wrote its commit, or failed to, within `COMMIT_GRACE_MS`.
 *
 * Two real bridge processes through the real `callBridge`, with the daemon's socket served in
 * this process (`serveWrites`): its writes are held from the verdict on.
 */

const HEADER = "registered at revision";
/** D4: a tool boundary's deadline, and `chat.message`'s. */
const DEADLINE_MS = 2_000;
const ROOT: OcConsumer = { sessionId: SESSION };

/** The real bridge of `kind`, with no daemon start: the test's socket serves the store. */
async function bridgeEntry(dir: string, kind: "register" | "after"): Promise<string> {
  const src = (path: string) => JSON.stringify(resolve("src/harness/opencode", path));
  const code = `
    import { readFileSync } from "node:fs";
    import { runBridge } from ${src("bridge.ts")};
    import { ${kind} as handler } from ${src(kind === "after" ? "bridge-turn.ts" : "bridge.ts")};
    const stdin = readFileSync(0, "utf8");
    await runBridge(stdin, new URL(import.meta.url), ${JSON.stringify(kind)}, (request, deps) =>
      handler(request, { ...deps, ensureDaemon: async () => "alive" }),
    );
  `;
  const outfile = join(dir, `${kind}.mjs`);
  await build({
    stdin: { contents: code, resolveDir: process.cwd(), loader: "ts" },
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    logLevel: "silent",
  });
  return outfile;
}

const entries: { dir?: string; register?: string; after?: string } = {};
beforeAll(async () => {
  entries.dir = mkdtempSync(join(tmpdir(), "squeal-oc-clear-"));
  entries.register = await bridgeEntry(entries.dir, "register");
  entries.after = await bridgeEntry(entries.dir, "after");
});
afterAll(() => {
  if (entries.dir !== undefined) rmSync(entries.dir, { recursive: true, force: true });
});

const served: ServedWrites[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const daemon of served.splice(0)) {
    daemon.thaw();
    daemon.release();
    await daemon.close();
  }
});

async function servedRepo(): Promise<{ r: SquealRepo; daemon: ServedWrites }> {
  const r = squealRepo();
  r.apply(r.fail());
  const daemon = await serveWrites(r, { freezable: true });
  served.push(daemon);
  return { r, daemon };
}

/** Runs `atVerdict` as the plugin sends its first commit verdict, before the signal. */
function onFirstVerdict(atVerdict: () => void): void {
  const kill = process.kill.bind(process);
  let first = true;
  vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
    if (signal === VERDICT_SIGNAL && first) {
      first = false;
      atVerdict();
    }
    return kill(pid, signal);
  });
}

const count = (text: string | null | undefined) => (text ?? "").split(HEADER).length - 1;

function call<K extends "register" | "after">(r: SquealRepo, kind: K, event: object) {
  const about = { consumer: ROOT, worktree: r.root, pid: process.pid };
  return callBridge<OcAnswers[K]>(
    { node: process.execPath, entry: entries[kind] ?? "" },
    { kind, ...about, ...event },
    r.root,
    DEADLINE_MS,
  );
}

describe("OpenCode: the next bridge reads the header's clear (row 005-109)", () => {
  it("a read tool's bridge right after the registration does not say the header again", async () => {
    const { r, daemon } = await servedRepo();
    // The clear's batch waits at the daemon for 100 ms, as one the daemon has not written yet.
    onFirstVerdict(() => {
      daemon.pause();
      setTimeout(() => daemon.release(), 100);
    });
    const registered = await call(r, "register", {});
    expect(count(registered?.header)).toBe(1);
    // OpenCode starts the model's turn, and its first tool, once `chat.message` returned.
    const read = await call(r, "after", { tool: "read" });
    expect(read).not.toBeNull();
    expect(count(read?.text)).toBe(0);
    expect(owedRegistration(r.store, r.consumer())).toBeNull();
  }, 60_000);

  it("a frozen daemon: the call ends within the grace, and the header is said again", async () => {
    const { r, daemon } = await servedRepo();
    // The daemon answers nothing from the verdict on: the clear is never confirmed.
    onFirstVerdict(() => daemon.freeze());
    const from = performance.now();
    const registered = await call(r, "register", {});
    expect(count(registered?.header)).toBe(1);
    expect(performance.now() - from).toBeLessThan(DEADLINE_MS + COMMIT_GRACE_MS);
    // Accepted (row 005-109): a clear never confirmed leaves the header owed; it is said again.
    const read = await call(r, "after", { tool: "read" });
    expect(count(read?.text)).toBe(1);
  }, 60_000);
});
