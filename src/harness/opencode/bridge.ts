import { fileURLToPath } from "node:url";
import { formatRegistration, MESSAGE_CAP_CHARS, shellWord } from "../../core/delivery/index.js";
import { locate, usesSqueal } from "../shared/context.js";
import { ensure, ensureToRegister } from "../shared/ensure.js";
import { findHarnessProcess } from "../shared/harness-process.js";
import { type HookDeps, withContext } from "../shared/hook.js";
import { endSession } from "../shared/session.js";
import type { OcAnswer, OcAnswers, OcConsumer, OcHost, OcRequest } from "./protocol.js";

/*
 * The bridge's side of spec 008 D4: one request per process, run on the
 * shared hook code (D6) unchanged.
 */

/**
 * How OpenCode texts name the Squeal CLI (D7): the Node the plugin found,
 * which runs this bridge, and the package's CLI, both by absolute path and
 * quoted for a shell. The flag keeps `node:sqlite`'s warning off the agent's
 * stderr on Node 22, as the Codex and Pi commands do.
 */
export function opencodeCommand(cli: string, node: string = process.execPath): string {
  return `${shellWord(node)} --disable-warning=ExperimentalWarning ${shellWord(cli)}`;
}

/**
 * The deps of one request. Bundled, the bridge is `dist/hooks/opencode.mjs`
 * and the CLI `dist/cli/squeal.mjs` (D1). The consumer's harness process is
 * OpenCode's, the pid the plugin sent (D2).
 */
export function bridgeDeps(module: URL, host: OcHost): HookDeps {
  const cli = fileURLToPath(new URL("../cli/squeal.mjs", module));
  return {
    env: process.env,
    cli,
    command: opencodeCommand(cli),
    harnessProcess: () => findHarnessProcess({ ppid: host.pid }),
  };
}

const consumerInput = (consumer: OcConsumer) => ({
  session_id: consumer.sessionId,
  ...(consumer.agentId === undefined ? {} : { agent_id: consumer.agentId }),
});

/**
 * `chat.message` on a consumer this instance has not registered (D3): ensure
 * the daemon (001 D10, spawned detached, D8), register, and answer the
 * registration header. A repository that does not use Squeal gets nothing,
 * not even a daemon; without a usable store the daemon is still ensured and
 * the header is `null`. No sweep of the session's other consumers: one left
 * by an earlier OpenCode process ends with that process (001 D10).
 */
export async function register(
  request: Extract<OcRequest, { kind: "register" }>,
  deps: HookDeps,
): Promise<OcAnswers["register"]> {
  const location = locate(request.worktree);
  if (location === null || !usesSqueal(location)) return { header: null, registered: false };
  let ensured = false;
  let registered = false;
  const header = await withContext(
    consumerInput(request.consumer),
    location,
    deps,
    async (context) => {
      ensured = true;
      const startingSince = await ensureToRegister(location, deps, context);
      const registration = await context.delivery.register(context.consumer, {
        atStart: true,
        ...(startingSince === undefined ? {} : { startingSince }),
      });
      registered = true;
      return formatRegistration(registration, MESSAGE_CAP_CHARS, deps.command);
    },
  );
  if (!ensured) await ensure(location, deps);
  return { header, registered };
}

/**
 * `session.deleted` and `dispose` (D3): each of `sessions` ends whole, its
 * main agent and every child, as 001's SessionEnd; each of `consumers` is
 * unregistered alone. Store writes only. Answers how many it ended.
 */
export async function end(
  request: Extract<OcRequest, { kind: "end" }>,
  deps: HookDeps,
): Promise<OcAnswers["end"]> {
  const location = locate(request.worktree);
  if (location === null) return { ended: 0 };
  for (const sessionId of request.sessions) {
    await endSession({ session_id: sessionId }, [location], deps);
  }
  for (const consumer of request.consumers) {
    await withContext(consumerInput(consumer), location, deps, async (context) => {
      await context.delivery.unregister(context.consumer);
      return null;
    });
  }
  return { ended: request.sessions.length + request.consumers.length };
}

/** Runs one request on the shared code; the answer is of the request's kind. */
export function handle(request: OcRequest, deps: HookDeps): Promise<OcAnswer> {
  switch (request.kind) {
    case "register":
      return register(request, deps);
    case "end":
      return end(request, deps);
    case "ping":
      return Promise.resolve({ pong: true });
  }
}

/**
 * The bridge process (D4): `stdin` is one request; the answer is printed as
 * `{"answer": ...}`. A request that does not parse, or a handler that throws,
 * prints nothing and sets exit code 1, which the plugin reads as silence.
 * Never calls `process.exit`, so piped output is flushed.
 */
export async function runBridge(stdin: string, module: URL): Promise<void> {
  try {
    const request = JSON.parse(stdin) as OcRequest;
    const answer = await handle(request, bridgeDeps(module, request));
    process.stdout.write(JSON.stringify({ answer }));
  } catch {
    process.exitCode = 1;
  }
}
