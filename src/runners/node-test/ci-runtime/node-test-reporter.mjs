// Squeal's node:test reporter for `squeal ci record` (spec 018 D23, row 018-47). The project names
// it as a second reporter of its recorded `node --test` command:
//   --test-reporter="$SQUEAL_NODE_TEST_REPORTER" --test-reporter-destination=stderr
// It yields nothing, so its destination prints nothing. With `ci record`'s settings
// (`SQUEAL_CI_RECORD`, `nodeTest.events`) it writes `<events>/<pid>.ndjson` for its `node --test`
// process: first the process's header (`execArgv`, `argv`, working directory, the Node probe's raw
// fields, the variables `nodeTest.variables` names), then every event, encoded by the daemon's own
// reporter (`runtime/reporter.mjs`: one encoding for both). Without the settings it does nothing.
// Runs inside the project's Node: imports only Node built-ins and the daemon's reporter.
//
// Review of 0.1.579 B3 (D20.2, D28): a failure of its own (the encoder's import, opening, writing
// or closing its file) never reaches Node's reporter stream, so the command's exit code stays the
// test run's. It stops recording, drains the rest of the events, prints one line to its
// destination, and leaves `<graph>/<pid>.reporter-failed`, so `ci record` writes no file of this
// process: an incomplete recording never becomes a pass.
import { closeSync, existsSync, openSync, writeFileSync, writeSync } from "node:fs";
import { isAbsolute, join } from "node:path";

/** The daemon's reporter: beside in a bundle (`dist/ci/` to `dist/node-test/`), or in the sources. */
const DAEMON_REPORTER = ["../node-test/reporter.mjs", "../runtime/reporter.mjs"]
  .map((candidate) => new URL(candidate, import.meta.url))
  .find((url) => existsSync(url));

/** The suffix of the mark a failed recording leaves in the graph directory (`ci-runs.ts`). */
const FAILED = ".reporter-failed";

const strings = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === "string") : []);

function settings() {
  try {
    const record = JSON.parse(process.env.SQUEAL_CI_RECORD ?? "");
    const nodeTest = record?.nodeTest;
    if (typeof nodeTest?.events !== "string" || !isAbsolute(nodeTest.events)) return null;
    const graph = typeof nodeTest.graph === "string" ? nodeTest.graph : null;
    return {
      events: nodeTest.events,
      graph,
      variables: strings(nodeTest.variables),
    };
  } catch {
    return null;
  }
}

function header(found) {
  return {
    header: {
      pid: process.pid,
      execArgv: process.execArgv,
      argv: process.argv,
      cwd: process.cwd(),
      version: process.version,
      build: {
        versions: process.versions,
        config: process.config,
        platform: process.platform,
        arch: process.arch,
      },
      env: Object.fromEntries(found.variables.map((name) => [name, process.env[name] ?? null])),
    },
  };
}

/** Writes all of `text` to `fd`; a short write throws. */
function writeAll(fd, text) {
  const bytes = Buffer.from(text);
  let at = 0;
  while (at < bytes.length) {
    const wrote = writeSync(fd, bytes, at, bytes.length - at);
    if (wrote <= 0) throw new Error(`wrote ${at} of ${bytes.length} bytes`);
    at += wrote;
  }
}

/** Node's own error from its event stream: the test run's, never Squeal's. */
class SourceError {
  constructor(error) {
    this.error = error;
  }
}

/**
 * The events of `source` for the encoder, which may stop early without ending `source` itself;
 * an error of `source` comes out as a `SourceError`.
 */
function view(source) {
  const next = () =>
    source.next().catch((error) => {
      throw new SourceError(error);
    });
  return {
    [Symbol.asyncIterator]: () => ({
      next,
      return: async () => ({ done: true, value: undefined }),
    }),
  };
}

/** Marks this process's recording as failed, where `ci record` reads it; never throws. */
function markFailed(found, why) {
  try {
    if (found.graph !== null) writeFileSync(join(found.graph, `${process.pid}${FAILED}`), why);
  } catch {}
}

export default async function* squealCiReporter(events) {
  const source = events[Symbol.asyncIterator]();
  const drain = async () => {
    for (let next = await source.next(); !next.done; next = await source.next());
  };
  const found = settings();
  if (found === null || DAEMON_REPORTER === undefined) return await drain();
  let failure = null;
  let fd = null;
  try {
    const { default: encode } = await import(DAEMON_REPORTER.href);
    fd = openSync(join(found.events, `${process.pid}.ndjson`), "a");
    writeAll(fd, `${JSON.stringify(header(found))}\n`);
    for await (const line of encode(view(source))) writeAll(fd, line);
  } catch (error) {
    failure = error;
  }
  if (fd !== null) {
    try {
      closeSync(fd);
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure instanceof SourceError) throw failure.error;
  if (failure === null) return;
  const why = failure instanceof Error ? failure.message : String(failure);
  markFailed(found, why);
  await drain();
  yield `squeal ci record: its node:test reporter could not record this process (${why}); no test file of it is recorded\n`;
}
