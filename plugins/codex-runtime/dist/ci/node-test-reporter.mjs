// Squeal's node:test reporter for `squeal ci record` (spec 018 D23, row 018-47). The project names
// it as a second reporter of its recorded `node --test` command:
//   --test-reporter="$SQUEAL_NODE_TEST_REPORTER" --test-reporter-destination=stderr
// It yields nothing, so its destination prints nothing. With `ci record`'s settings
// (`SQUEAL_CI_RECORD`, `nodeTest.events`) it writes `<events>/<pid>.ndjson` for its `node --test`
// process: first the process's header (`execArgv`, `argv`, working directory, the Node probe's raw
// fields, the variables `nodeTest.variables` names), then every event, encoded by the daemon's own
// reporter (`runtime/reporter.mjs`: one encoding for both). Without the settings it does nothing.
// Runs inside the project's Node: imports only Node built-ins and the daemon's reporter.
import { closeSync, existsSync, openSync, writeSync } from "node:fs";
import { isAbsolute, join } from "node:path";

/** The daemon's reporter: beside in a bundle (`dist/ci/` to `dist/node-test/`), or in the sources. */
const DAEMON_REPORTER = ["../node-test/reporter.mjs", "../runtime/reporter.mjs"]
  .map((candidate) => new URL(candidate, import.meta.url))
  .find((url) => existsSync(url));

function settings() {
  try {
    const nodeTest = JSON.parse(process.env.SQUEAL_CI_RECORD ?? "")?.nodeTest;
    if (typeof nodeTest?.events !== "string" || !isAbsolute(nodeTest.events)) return null;
    const variables = Array.isArray(nodeTest.variables)
      ? nodeTest.variables.filter((v) => typeof v === "string")
      : [];
    return { events: nodeTest.events, variables };
  } catch {
    return null;
  }
}

function header(variables) {
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
      env: Object.fromEntries(variables.map((name) => [name, process.env[name] ?? null])),
    },
  };
}

// biome-ignore lint/correctness/useYield: Node runs a reporter as a generator; this one yields nothing (D23.3).
export default async function* squealCiReporter(events) {
  const found = settings();
  if (found === null || DAEMON_REPORTER === undefined) {
    for await (const _ of events);
    return;
  }
  const { default: encode } = await import(DAEMON_REPORTER.href);
  const fd = openSync(join(found.events, `${process.pid}.ndjson`), "a");
  try {
    writeSync(fd, `${JSON.stringify(header(found.variables))}\n`);
    for await (const line of encode(events)) writeSync(fd, line);
  } finally {
    closeSync(fd);
  }
}
