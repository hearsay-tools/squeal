// Spec 020 D13 (row 020-08a): `coverage.cjs`'s client of the records' worker,
// `coverage-map.mjs` in a plugin's `dist/cli/` (row 015-42), with
// `workerMapper`'s protocol (`src/core/code/coverage/mapper.ts`): the
// worker reads and maps a payload, and this side gives the sources it asks
// for. Both sides' time is Squeal's (`clock.cjs`, row 018-29): this side's
// answers on the clock, the worker's busy time added when it closes. That
// busy time holds the worker's own evidence time, so the worker's clock is
// counted outside (`COUNTED_OUTSIDE`) and reads 0.
// CommonJS with Node built-ins only.
"use strict";
const { Worker } = require("node:worker_threads");
const clock = require("./clock.cjs");

/**
 * The records' worker, `workerMapper`'s protocol: a job, the sources it
 * asks for, its record. One job at a time, since the worker holds one.
 * `failed` once when it fails; every job in hand and after rejects.
 */
function startMapper(settings, failed) {
  const { script, execArgv } = settings.worker;
  const worker = new Worker(script, {
    workerData: { format: settings.format, [clock.COUNTED_OUTSIDE]: true },
    ...(Array.isArray(execArgv) ? { execArgv } : {}),
  });
  worker.unref();
  const jobs = new Map();
  let made = 0;
  let broken = null;
  let queue = Promise.resolve();
  const fail = (error) => {
    if (broken !== null) return;
    broken = error;
    failed(error);
    for (const job of jobs.values()) job.reject(error);
    jobs.clear();
  };
  worker.on(
    "message",
    clock.timed((answer) => {
      const job = jobs.get(answer.id);
      if (job === undefined) return;
      try {
        if (answer.type === "need") {
          const given = [];
          const absent = [];
          for (const file of answer.paths) {
            const source = job.source(file);
            if (source === null) absent.push(file);
            else given.push([file, source]);
          }
          worker.postMessage({
            type: "sources",
            id: answer.id,
            sources: job.sources,
            given,
            absent,
          });
          return;
        }
        jobs.delete(answer.id);
        if (answer.type === "record") job.resolve(shared(answer.record));
        else job.reject(new Error(answer.message));
      } catch (error) {
        jobs.delete(answer.id);
        job.reject(error);
      }
    }),
  );
  worker.on("error", fail);
  worker.on("exit", (code) => fail(new Error(`the coverage worker exited with code ${code}`)));
  const run = (job) =>
    new Promise((resolve, reject) => {
      if (broken !== null) return reject(broken);
      const id = made++;
      jobs.set(id, { ...job, resolve, reject });
      const { testFile, payload, sources } = job;
      worker.postMessage({ type: "job", id, sources, testFile, payload });
    });
  return {
    map(job) {
      const mapped = queue.then(() => run(job));
      queue = mapped.catch(() => {});
      return mapped;
    },
    async close() {
      await queue;
      broken ??= new Error("closed");
      try {
        // The time its event loop was busy: the mapping and its own evidence time, which its clock leaves out.
        clock.add(worker.performance.eventLoopUtilization().active);
      } catch {}
      await worker.terminate();
    },
  };
}

/** A `SharedRecord` as JSON can hold it: each part's bytes in base64; the tail is rebuilt. */
function shared(record) {
  return {
    paths: record.paths,
    parts: record.parts.map((p) => ({ at: p.at, bytes: Buffer.from(p.bytes).toString("base64") })),
    unread: record.unread,
  };
}

module.exports = { startMapper };
