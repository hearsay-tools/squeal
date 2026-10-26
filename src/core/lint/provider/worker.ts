import { parentPort, workerData } from "node:worker_threads";
import type { AbsolutePath } from "../../types/common.js";
import { Observer } from "./observe.js";
import { type FromWorker, firstLine, type ToWorker, type WorkerAnswer } from "./protocol.js";
import { EslintSession, Unobserved } from "./session.js";

/*
 * Spec 017 D3: the ESLint worker thread. It loads the project's ESLint, its
 * config and plugins, and nothing of them runs in the daemon's thread. The
 * observer, set before ESLint loads, records the config's closure (D4).
 */

const observer = Observer.install();
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

/** The call's answer; `off` when a config loaded what the worker could not see (B2). */
async function answerOf(message: ToWorker): Promise<WorkerAnswer> {
  try {
    return await answered(message);
  } catch (error) {
    if (error instanceof Unobserved) return { type: "off", reason: error.message };
    throw error;
  }
}

async function answered(message: ToWorker): Promise<WorkerAnswer> {
  const progress = () => send({ type: "progress", id: message.id });
  if (message.type === "open") {
    const opened = await EslintSession.open(root, observer);
    if ("off" in opened) return { type: "off", reason: opened.off };
    session = opened;
    return { type: "open", declaration: await opened.declaration() };
  }
  if (session === null) throw new Error("the ESLint worker was not opened");
  if (message.type === "refresh") {
    if (message.fresh) session.fresh();
    const env = await session.refreshed();
    return { type: "snapshot", declaration: await session.declaration(), env };
  }
  if (message.type === "inputs") {
    return { type: "inputs", inputs: await session.inputs(message.paths, progress) };
  }
  const results = await session.lint(message.files, progress);
  return { type: "linted", results, env: session.environment() };
}
