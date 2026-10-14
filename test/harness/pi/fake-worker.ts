import { Worker } from "node:worker_threads";
import type { PiAnswers, PiRequest } from "../../../src/harness/pi/protocol.js";

type Kind = PiRequest["kind"];

export interface FakeWorkerOptions {
  /** The answer to each kind; a kind not listed answers `null`. */
  readonly answers?: { readonly [K in Kind]?: PiAnswers[K] };
  /** Answers to each kind's calls in order; past the end, `answers`. */
  readonly sequences?: { readonly [K in Kind]?: readonly PiAnswers[K][] };
  /** Kinds the worker never answers, so their calls meet the deadline. */
  readonly stall?: readonly Kind[];
}

/**
 * A worker standing in for the delivery worker (spec 009 D4): answers each
 * request with the next of `sequences[kind]` or else `answers[kind]`, and
 * tells the test every request it got, as a message whose id no call has.
 * A cancel (D5) answers its stalled `wait` `null`, as the real one does, and
 * is told to the test by the id it cancels.
 */
export function fakeWorker(options: FakeWorkerOptions = {}) {
  const seen: PiRequest[] = [];
  const cancelled: number[] = [];
  let starts = 0;
  const start = () => {
    starts++;
    const worker = new Worker(
      `const { parentPort, workerData } = require("node:worker_threads");
       const { answers, sequences, stall } = workerData;
       parentPort.on("message", ({ id, request, cancel }) => {
         if (cancel !== undefined) {
           parentPort.postMessage({ id: 0, cancelled: cancel });
           parentPort.postMessage({ id: cancel, ok: true, answer: null });
           return;
         }
         parentPort.postMessage({ id: 0, seen: request });
         if (stall.includes(request.kind)) return;
         const next = sequences[request.kind]?.shift();
         parentPort.postMessage({ id, ok: true, answer: next !== undefined ? next : (answers[request.kind] ?? null) });
       });`,
      {
        eval: true,
        workerData: {
          answers: options.answers ?? {},
          sequences: options.sequences ?? {},
          stall: options.stall ?? [],
        },
      },
    );
    worker.on("message", (message: { id: number; seen?: PiRequest; cancelled?: number }) => {
      if (message.id === 0 && message.seen !== undefined) seen.push(message.seen);
      if (message.id === 0 && message.cancelled !== undefined) cancelled.push(message.cancelled);
    });
    return worker;
  };
  const count = (kind: Kind) => seen.filter((request) => request.kind === kind).length;
  return { start, seen, cancelled, count, starts: () => starts };
}

export type FakeWorker = ReturnType<typeof fakeWorker>;
