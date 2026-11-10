// Throwaway probe (survey-020-15): does replacing process.stdout.write route
// in-process console.log (as cezar's e2e globalSetup prints) to stderr, and
// what does a child with inherited stdio still write to fd 1?
import { spawnSync } from "node:child_process";

const original = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...rest) => process.stderr.write(chunk, ...rest);
console.log("IN_PROCESS console.log line");
spawnSync(process.execPath, ["-e", "console.log('CHILD inherit line')"], { stdio: "inherit" });
const piped = spawnSync(process.execPath, ["-e", "console.log('CHILD piped line')"]);
console.log(`IN_PROCESS relays piped: ${piped.stdout.toString().trim()}`);
process.stdout.write = original;
console.log('{"report":"only this on stdout?"}');
