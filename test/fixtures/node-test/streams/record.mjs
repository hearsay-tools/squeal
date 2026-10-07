// Records the event streams of spec 003 D5's reporter under the Node running this script, for
// test/runners/node-test/run-streams.test.ts. Usage: `node record.mjs`, once per Node version.
// Writes `node<major>/<case>.ndjson` with this fixtures directory replaced by `<fixtures>`.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const fixtures = realpathSync(join(import.meta.dirname, ".."));
const reporter = realpathSync(
  join(import.meta.dirname, "../../../../src/runners/node-test/runtime/reporter.mjs"),
);
const out = join(import.meta.dirname, `node${process.versions.node.split(".")[0]}`);
mkdirSync(out, { recursive: true });

// One file per process, as Squeal runs them; `ordering` runs two files in one process to keep
// the evidence for that choice (README.md).
const CASES = [
  { name: "outcomes", cwd: "streams", files: ["outcomes.test.ts"] },
  ...["pass", "fail", "syntax", "missing-import", "duplicate"].map((name) => ({
    name,
    cwd: "edge",
    files: [`test/${name}.test.ts`],
  })),
  { name: "busy-loop", cwd: "edge", files: ["test/busy-loop.test.ts"], killAfterMs: 3_000 },
  {
    name: "ordering",
    cwd: "edge",
    files: ["test/busy-loop.test.ts", "test/pass.test.ts"],
    killWhen: '"name":"test/pass.test.ts"',
  },
];

for (const c of CASES) {
  const destination = join(out, `${c.name}.raw`);
  rmSync(destination, { force: true });
  const args = [
    "--enable-source-maps",
    "--import",
    "tsx",
    "--test",
    `--test-reporter=${reporter}`,
    `--test-reporter-destination=${destination}`,
    ...(c.files.length > 1 ? [`--test-concurrency=${c.files.length}`] : []),
    ...c.files,
  ];
  const child = spawn(process.execPath, args, {
    cwd: join(fixtures, c.cwd),
    detached: true,
    stdio: "ignore",
  });
  const kill = () => process.kill(-child.pid, "SIGKILL");
  const timer = c.killAfterMs ? setTimeout(kill, c.killAfterMs) : undefined;
  const poll = setInterval(() => {
    let text = "";
    try {
      text = readFileSync(destination, "utf8");
    } catch {}
    const lines = text.split("\n");
    if (c.killWhen && lines.some((l) => l.includes('"test:complete"') && l.includes(c.killWhen)))
      kill();
  }, 50);
  await new Promise((done) => child.on("exit", done));
  clearTimeout(timer);
  clearInterval(poll);
  const text = readFileSync(destination, "utf8").replaceAll(fixtures, "<fixtures>");
  writeFileSync(join(out, `${c.name}.ndjson`), text);
  rmSync(destination);
}
