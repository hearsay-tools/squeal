// Test-only (row 011-280, `research/ci-intermittent.md` section 2): loaded into a daemon with
// `node --import` (`startHold`), it holds the daemon's main thread once the daemon registered and
// before it removes its start mark, so its socket worker still answers. It writes
// `<SQUEAL_TEST_START_HOLD>.held` there and sleeps until the test writes `.release`, 60 s at most.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const at = process.env.SQUEAL_TEST_START_HOLD;
if (at) {
  const remove = fs.rmSync;
  let held = false;
  fs.rmSync = function rmSync(path, ...rest) {
    if (!held && String(path).endsWith(".starting") && fs.existsSync(path)) {
      held = true;
      fs.writeFileSync(`${at}.held`, String(process.pid));
      const sleep = new Int32Array(new SharedArrayBuffer(4));
      const until = Date.now() + 60_000;
      while (!fs.existsSync(`${at}.release`) && Date.now() < until) Atomics.wait(sleep, 0, 0, 20);
    }
    return remove.call(this, path, ...rest);
  };
  syncBuiltinESMExports();
}
