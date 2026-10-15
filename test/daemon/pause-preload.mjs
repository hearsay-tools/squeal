// Test-only (task 001-355, review 001-423 N1): loaded into a daemon with `node --import`
// (`testPause`), it stops the process with SIGSTOP where the daemon publishes the pause point
// `SQUEAL_TEST_PAUSE` names. The shipped CLI only publishes; nothing there stops it.
import { subscribe } from "node:diagnostics_channel";

const point = process.env.SQUEAL_TEST_PAUSE;
if (point) {
  subscribe("squeal:test-pause", (name) => {
    if (name === point) process.kill(process.pid, "SIGSTOP");
  });
}
