import { ciCommand } from "../../../src/cli/ci.js";

/*
 * `squeal ci record` as its own process, for tests that read what the
 * recorded command prints: `node --import tsx ci-record-cli.ts record ...`.
 */
const code = await ciCommand(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  cwd: process.cwd(),
  env: process.env,
});
process.exit(code);
