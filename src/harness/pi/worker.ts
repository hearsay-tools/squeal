import { fileURLToPath } from "node:url";
import type { MessagePort } from "node:worker_threads";
import { shellWord } from "../../core/text.js";
import { findHarnessProcess } from "../shared/harness-process.js";
import type { HookDeps } from "../shared/hook.js";
import type { FromWorker, PiAnswer, PiRequest, ToWorker } from "./protocol.js";
import { endRun, idleWait, settle, startRun, toolCall } from "./run.js";
import { shutdownSession, startSession, toolBoundary } from "./session.js";

/**
 * How Pi texts name the Squeal CLI (spec 009 D7): installing a Pi package puts
 * nothing on the PATH, so the Node running Pi and the package's CLI, both by
 * absolute path and quoted for a shell. The flag keeps `node:sqlite`'s
 * warning off the agent's stderr on Node 22, as the Codex command does.
 */
export function piCommand(cli: string, node: string = process.execPath): string {
  return `${shellWord(node)} --disable-warning=ExperimentalWarning ${shellWord(cli)}`;
}

/**
 * The deps of the worker's handlers. Bundled, the worker is `dist/worker.mjs`
 * and the CLI `dist/cli/squeal.mjs` (D1). The consumer's harness process is
 * Pi's own, the process this worker thread runs in, not an ancestor (D2).
 */
export function workerDeps(module: URL): HookDeps {
  const cli = fileURLToPath(new URL("./cli/squeal.mjs", module));
  return {
    env: process.env,
    cli,
    command: piCommand(cli),
    harnessProcess: () => findHarnessProcess({ ppid: process.pid }),
  };
}

/**
 * Runs one request on the shared code; the answer is of the request's kind
 * (`PiAnswers`). `signal` cancels a `wait`.
 */
export function handle(
  request: PiRequest,
  deps: HookDeps,
  signal?: AbortSignal,
): Promise<PiAnswer> {
  switch (request.kind) {
    case "start":
      return startSession(request, deps);
    case "shutdown":
      return shutdownSession(request, deps);
    case "boundary":
      return toolBoundary(request, deps, request.edited);
    case "run":
      return startRun(request, deps);
    case "toolCall":
      return toolCall(request, deps);
    case "settle":
      return settle(request, deps);
    case "endTurn":
      return endRun(request, deps);
    case "wait":
      return idleWait(request, deps, signal);
    case "ping":
      return Promise.resolve(null);
  }
}

/**
 * Answers every request posted on `port`, one answer each; a throw answers
 * `ok: false`. A cancel aborts its `wait`, which then answers `null`.
 */
export function serve(port: MessagePort, deps: HookDeps): void {
  const waits = new Map<number, AbortController>();
  port.on("message", (message: ToWorker) => {
    if ("cancel" in message) {
      waits.get(message.cancel)?.abort();
      return;
    }
    const { id, request } = message;
    const cancel = request.kind === "wait" ? new AbortController() : null;
    if (cancel !== null) waits.set(id, cancel);
    const answer = (message: FromWorker) => port.postMessage(message);
    handle(request, deps, cancel?.signal)
      .then(
        (result) => answer({ id, ok: true, answer: result }),
        () => answer({ id, ok: false }),
      )
      .finally(() => waits.delete(id));
  });
}
