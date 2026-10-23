import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readPolicy } from "../../core/daemon/policy.js";
import { formatRegistration, MESSAGE_CAP_CHARS } from "../../core/delivery/index.js";
import { shellWord } from "../../core/text.js";
import { locate, usesSqueal } from "../shared/context.js";
import { coverageOf } from "../shared/coverage.js";
import { ensure, ensureToRegister } from "../shared/ensure.js";
import { findHarnessProcess } from "../shared/harness-process.js";
import { type HookDeps, isRegistered, withContext } from "../shared/hook.js";
import { primer } from "../shared/primer.js";
import { submitPrompt } from "../shared/prompt.js";
import { endSession } from "../shared/session.js";
import type { OcAnswer, OcAnswers, OcConsumer, OcHost, OcKind, OcRequest } from "./protocol.js";

/*
 * The bridge's side of spec 008 D4: one request per process, run on the
 * shared hook code (D6) unchanged. Each kind's entry loads its handler
 * alone, so a tool call's bridge loads no more than the Codex hook it
 * stands for (open question 3).
 */

/** One kind's handler. */
export type OcHandler<K extends OcKind> = (
  request: Extract<OcRequest, { kind: K }>,
  deps: HookDeps,
) => Promise<OcAnswers[K]>;

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
 * The deps of one request. Bundled, the bridge is one entry per kind,
 * `dist/hooks/<kind>.mjs`, and the CLI `dist/cli/squeal.mjs` (D1). The consumer's harness process is
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

export const consumerInput = (consumer: OcConsumer) => ({
  session_id: consumer.sessionId,
  ...(consumer.agentId === undefined ? {} : { agent_id: consumer.agentId }),
});

/**
 * `chat.message` on a consumer this instance has not registered (D3): ensure
 * the daemon (001 D10, spawned detached, D8), register, and answer the
 * registration header, the primer (D3: the system prompt's) and `stop.waitMs`
 * (D4: the deadline at idle). A repository
 * that does not use Squeal gets nothing, not even a daemon; without a usable
 * store the daemon is still ensured, and nothing is registered. No sweep of the session's other consumers: one left
 * by an earlier OpenCode process ends with that process (001 D10).
 */
export async function register(
  request: Extract<OcRequest, { kind: "register" }>,
  deps: HookDeps,
): Promise<OcAnswers["register"]> {
  const location = locate(request.worktree);
  const silent = { header: null, registered: false, primer: null };
  if (location === null || !usesSqueal(location)) return silent;
  let ensured = false;
  const answer = await withContext(
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
      return {
        header: formatRegistration(registration, MESSAGE_CAP_CHARS, deps.command),
        registered: true,
        primer: primer(deps.command, coverageOf(context)),
        stopWaitMs: readPolicy(location.root).stop.waitMs,
      };
    },
  );
  if (!ensured) await ensure(location, deps);
  return answer ?? silent;
}

/**
 * `chat.message` on a consumer this instance registered (D3): `startTurn`,
 * and the delta not yet delivered as the text to add, with `stop.waitMs`, so
 * a changed policy reaches idle's deadline (D4), and the primer, so a
 * coverage that changed since registration reaches the system prompt
 * (008-22); one the daemon expired meanwhile is registered again, as 001's
 * prompt registers.
 */
export async function prompt(
  request: Extract<OcRequest, { kind: "prompt" }>,
  deps: HookDeps,
): Promise<OcAnswers["prompt"]> {
  const location = locate(request.worktree);
  if (location === null) return { text: null };
  const input = consumerInput(request.consumer);
  const text = await submitPrompt(input, location, deps, { register: true });
  const current = await withContext(input, location, deps, async (context) =>
    isRegistered(context) ? primer(deps.command, coverageOf(context)) : null,
  );
  return { text, stopWaitMs: readPolicy(location.root).stop.waitMs, primer: current };
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

/** The bare round trip (D4). */
export const ping: OcHandler<"ping"> = async () => ({ pong: true });

/**
 * The bridge process (D4): `stdin` is one request of `kind`; `handler`'s
 * answer is printed as `{"answer": ...}`. A request that does not parse or is
 * of another kind, or a handler that throws, prints nothing and sets exit
 * code 1, which the plugin reads as silence. Never calls `process.exit`, so
 * piped output is flushed.
 */
export async function runBridge<K extends OcKind>(
  stdin: string,
  module: URL,
  kind: K,
  handler: OcHandler<K>,
): Promise<void> {
  try {
    const request = JSON.parse(stdin) as OcRequest;
    if (request.kind !== kind) throw new Error(`not a ${kind} request`);
    const answer: OcAnswer = await handler(
      request as Extract<OcRequest, { kind: K }>,
      bridgeDeps(module, request),
    );
    process.stdout.write(JSON.stringify({ answer }));
  } catch {
    process.exitCode = 1;
  }
}

/** A bridge entry's body: its stdin, then `runBridge`. */
export async function runEntry<K extends OcKind>(
  module: string,
  kind: K,
  handler: OcHandler<K>,
): Promise<void> {
  let stdin = "";
  try {
    stdin = readFileSync(0, "utf8");
  } catch {
    // No readable stdin: no request, so no answer.
  }
  await runBridge(stdin, new URL(module), kind, handler);
}
