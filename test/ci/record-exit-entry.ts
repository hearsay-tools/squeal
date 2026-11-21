import { resolve } from "node:path";
import { ciCommand } from "../../src/cli/ci.js";

/*
 * Row 018-67: `squeal ci record` as its own process, ended as
 * `src/cli/index.ts` ends it: `process.exitCode`, no `process.exit`, so a
 * request left in flight holds the process open. It differs in one point:
 * the endpoint hashing's floor is `SQUEAL_TEST_HASHING_FLOOR_MS`, so a test
 * waits for it in seconds, and the child that hashes is
 * `endpoints-child-entry.ts`, which starts faster than the whole CLI.
 */

const CHILD = resolve(import.meta.dirname, "endpoints-child-entry.ts");
const floorMs = Number(process.env.SQUEAL_TEST_HASHING_FLOOR_MS);

process.exitCode = await ciCommand(
  process.argv.slice(2),
  {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    cwd: process.cwd(),
    relaunch: [process.execPath, ...process.execArgv, CHILD],
  },
  { endpoints: { limit: { floorMs, multiple: 4 } } },
);
