import { readFileSync } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";
import type { ObjectFormat } from "../../hash/index.js";
import type { AbsolutePath } from "../../types/index.js";
import type { FromWorker, ToWorker } from "./mapper.js";
import { ownRecord } from "./own.js";
import { type BlobCache, buildRecord, encodeRecord, scriptPath } from "./record.js";
import type { ExecutedSource, V8Payload, V8Script } from "./types.js";

/*
 * Row 015-42: the records' writer's worker thread. It reads, parses and
 * maps each payload, so the daemon's main thread only answers which
 * sources a payload needs and stores the record. The sources of the
 * newest `KEEP` runs are kept; a source of an older run is asked for again.
 * The main thread deletes each payload once this worker answered for it, so
 * a job this worker did not finish is mapped there (review 0.1.305 B2).
 */

const KEEP = 2;

interface Run {
  readonly given: Map<AbsolutePath, ExecutedSource>;
  /** Asked for and not given: outside the run's sources, or Squeal's own provider. */
  readonly absent: Set<AbsolutePath>;
}

const port = parentPort;
const { format } = workerData as { readonly format: ObjectFormat };
const blobs: BlobCache = new Map();
const runs = new Map<number, Run>();
let held: {
  readonly job: Extract<ToWorker, { type: "job" }>;
  readonly scripts: V8Script[];
} | null = null;

const send = (message: FromWorker) => port?.postMessage(message);

port?.on("message", (message: ToWorker) => {
  try {
    if (message.type === "job") take(message);
    else given(message);
  } catch (error) {
    held = null;
    send({ type: "error", id: message.id, message: String(error) });
  }
});

function runOf(id: number): Run {
  const known = runs.get(id);
  if (known !== undefined) return known;
  const run: Run = { given: new Map(), absent: new Set() };
  runs.set(id, run);
  for (const old of runs.keys()) {
    if (runs.size <= KEEP) break;
    runs.delete(old);
  }
  return run;
}

function take(job: Extract<ToWorker, { type: "job" }>): void {
  const payload = JSON.parse(readFileSync(job.payload, "utf8")) as V8Payload;
  if (job.ownRoot !== undefined) {
    const record = ownRecord(job.ownRoot, payload, format);
    send({ type: "record", id: job.id, record: encodeRecord(record) });
    return;
  }
  const scripts = [...payload.result];
  const run = runOf(job.sources);
  const paths = new Set<AbsolutePath>();
  for (const script of scripts) {
    const path = scriptPath(script.url);
    if (path !== null && !run.given.has(path) && !run.absent.has(path)) paths.add(path);
  }
  held = { job, scripts };
  if (paths.size > 0) send({ type: "need", id: job.id, paths: [...paths] });
  else finish();
}

function given(answer: Extract<ToWorker, { type: "sources" }>): void {
  const run = runOf(answer.sources);
  for (const [path, source] of answer.given) run.given.set(path, source);
  for (const path of answer.absent) run.absent.add(path);
  finish();
}

function finish(): void {
  if (held === null) return;
  const { job, scripts } = held;
  held = null;
  const file = { testFile: job.testFile, payload: job.payload, sources: runOf(job.sources).given };
  send({
    type: "record",
    id: job.id,
    record: encodeRecord(buildRecord(file, scripts, format, blobs)),
  });
}
