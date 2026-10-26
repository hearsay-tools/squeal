import { registerHooks } from "node:module";
import { parentPort, workerData } from "node:worker_threads";
import type { AbsolutePath } from "../../types/common.js";
import { type FromWorker, firstLine, type ToWorker, type WorkerAnswer } from "./protocol.js";
import { EslintSession } from "./session.js";

/*
 * Spec 017 D3: the ESLint worker thread. It loads the project's ESLint, its
 * config and plugins, and nothing of them runs in the daemon's thread. A
 * resolve hook, set before ESLint loads, records every module the thread
 * resolves: the config's closure (D4), as the observed-inputs recorder does.
 */

const loaded = new Set<string>();
registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    loaded.add(result.url);
    return result;
  },
});

const port = parentPort;
const { root } = workerData as { readonly root: AbsolutePath };
let session: EslintSession | null = null;
let queue = Promise.resolve();

const send = (message: FromWorker) => port?.postMessage(message);

port?.on("message", (message: ToWorker) => {
  queue = queue.then(() => handle(message));
});

async function handle(message: ToWorker): Promise<void> {
  try {
    const answer = await answerOf(message);
    // A plugin's timer due now fires before the answer, so a throw in it
    // fails this call rather than the next (goal 6).
    await new Promise((resolve) => setTimeout(resolve, 0));
    send({ type: "done", id: message.id, answer });
  } catch (error) {
    send({ type: "error", id: message.id, message: firstLine(error) });
  }
}

async function answerOf(message: ToWorker): Promise<WorkerAnswer> {
  const progress = () => send({ type: "progress", id: message.id });
  if (message.type === "open") {
    const opened = await EslintSession.open(root);
    if ("off" in opened) return { type: "off", reason: opened.off };
    session = opened;
    return { type: "open", declaration: await opened.declaration() };
  }
  if (session === null) throw new Error("the ESLint worker was not opened");
  if (message.type === "refresh") {
    if (message.fresh) session.fresh();
    const env = await session.refreshed(loaded);
    return { type: "snapshot", declaration: await session.declaration(), env };
  }
  if (message.type === "inputs") {
    return { type: "inputs", inputs: await session.inputs(message.paths, progress) };
  }
  const results = await session.lint(message.files, progress);
  return { type: "linted", results, env: session.environment(loaded) };
}
