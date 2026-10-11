// A cleanup that reads a pid file in the instant between its creation and its write:
// Number("") is 0, and process.kill(0, ...) signals the caller's whole process group.
import { test } from "vitest";
test("cleanup reads an empty pid file", () => {
  try { process.kill(Number(""), "SIGKILL"); } catch { /* gone */ }
});
