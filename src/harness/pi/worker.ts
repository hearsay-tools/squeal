import { fileURLToPath } from "node:url";
import type { MessagePort } from "node:worker_threads";
import { shellWord } from "../../core/text.js";
import { HAND_OFF_BOUND_MS, HandOff } from "../shared/hand-off.js";
import { findHarnessProcess } from "../shared/harness-process.js";
import type { HookDeps } from "../shared/hook.js";
import { HandedRegistrations, type PiDeps } from "./handed.js";
import { awaitVerdict } from "./host.js";
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
    // Row 005-117: the primer is in each run's system prompt (D3 `before_agent_start`); a tool
    // boundary of a run with none says it (`toolBoundary`, review 0.1.556).
    registrationPrimer: false,
    harnessProcess: () => findHarnessProcess({ ppid: process.pid }),
  };
}

/**
 * Runs one request on the shared code; the answer is of the request's kind
 * (`PiAnswers`). `signal` cancels a `wait`.
 */
export function handle(request: PiRequest, deps: PiDeps, signal?: AbortSignal): Promise<PiAnswer> {
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

/** The host's verdict slot in `workerData` (row 011-288); `undefined` from a host without one. */
export function verdictsOf(data: unknown): SharedArrayBuffer | undefined {
  const verdicts = (data as { verdicts?: unknown } | null)?.verdicts;
  return verdicts instanceof SharedArrayBuffer ? verdicts : undefined;
}

/**
 * Answers every request posted on `port`, one answer each; a throw answers
 * `ok: false`. A cancel aborts its `wait`, which then answers `null`. With
 * the host's `verdicts` (row 011-288), an answer that carries a prepared
 * report is posted `held`, and the report commits only on the host's
 * verdict, which this thread waits for; a host without the slot gets each
 * report committed before its answer, as before. A registration whose text
 * the host has is not said again by this worker (`HandedRegistrations`).
 */
export function serve(port: MessagePort, deps: HookDeps, verdicts?: SharedArrayBuffer): void {
  const waits = new Map<number, AbortController>();
  const slot = verdicts === undefined ? null : new Int32Array(verdicts);
  const writes = new HandedWrites();
  const handed = new HandedRegistrations();
  port.on("message", (message: ToWorker) => {
    if ("cancel" in message) {
      waits.get(message.cancel)?.abort();
      return;
    }
    const { id, request } = message;
    const cancel = request.kind === "wait" ? new AbortController() : null;
    if (cancel !== null) waits.set(id, cancel);
    const answer = (message: FromWorker) => port.postMessage(message);
    const handOff = slot === null ? null : new HandOff();
    const handing = handed.request();
    const requestDeps = { ...deps, handing, ...(handOff === null ? {} : { handOff }) };
    writes
      .after(() => handle(request, requestDeps, cancel?.signal))
      .then(
        (result) => {
          if (slot === null || handOff === null || !handOff.pending) {
            answer({ id, ok: true, answer: result });
            return handing.keep();
          }
          const post = () => answer({ id, ok: true, answer: result, held: true });
          const commit = awaitVerdict(slot, id, HAND_OFF_BOUND_MS, post) === "commit";
          if (commit) handing.keep();
          handOff.settle(commit);
          writes.add(handOff.sent());
        },
        () => {
          handOff?.abandon();
          answer({ id, ok: false });
        },
      )
      .finally(() => waits.delete(id));
  });
}

/**
 * Row 005-107: the writes a verdict sent to the daemon serving the store
 * (spec 021 D15), which the host does not wait for: it has its answer
 * before them. A request that comes next starts once they are written, so
 * it reads what the request before it committed; a failure a tool
 * boundary delivered, for one, is not delivered again by the run Pi starts next.
 * The Claude Code and Codex wrappers wait for the same writes before their
 * process ends (`writeThenCommit`). With none pending, a request starts at
 * once, as before. A write that failed or got no answer within its bound
 * also opens the gate; a registration it left owed is not said again
 * either (review 0.1.546 B1, `HandedRegistrations`).
 */
class HandedWrites {
  #pending: Promise<void> | null = null;

  /** Adds `written`, which never rejects (`HandOff.sent`). */
  add(written: Promise<void>): void {
    const all = this.#pending === null ? written : Promise.all([this.#pending, written]);
    const pending = all.then(() => {
      if (this.#pending === pending) this.#pending = null;
    });
    this.#pending = pending;
  }

  /** Runs `start` once every write added so far is written; at once when none is pending. */
  after<T>(start: () => Promise<T>): Promise<T> {
    return this.#pending === null ? start() : this.#pending.then(start);
  }
}
