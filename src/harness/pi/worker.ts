import { fileURLToPath } from "node:url";
import type { MessagePort } from "node:worker_threads";
import { shellWord } from "../../core/delivery/index.js";
import { findHarnessProcess } from "../shared/harness-process.js";
import type { HookDeps } from "../shared/hook.js";
import type { FromWorker, PiRequest, ToWorker } from "./protocol.js";
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

/** Runs one request on the shared code. */
export function handle(request: PiRequest, deps: HookDeps): Promise<string | null> {
  switch (request.kind) {
    case "start":
      return startSession(request, deps);
    case "shutdown":
      return shutdownSession(request, deps);
    case "boundary":
      return toolBoundary(request, deps);
    case "ping":
      return Promise.resolve(null);
  }
}

/** Answers every request posted on `port`, one answer each; a throw answers `ok: false`. */
export function serve(port: MessagePort, deps: HookDeps): void {
  port.on("message", ({ id, request }: ToWorker) => {
    const answer = (message: FromWorker) => port.postMessage(message);
    handle(request, deps).then(
      (text) => answer({ id, ok: true, text }),
      () => answer({ id, ok: false }),
    );
  });
}
