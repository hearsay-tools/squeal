import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "../../store/helpers.js";
import { IDLE_DEADLINE_MS, stopGone } from "./held-stop.js";

/*
 * Review 008-32 B2: the dispose test retries an attempt whose held Stop is
 * gone only on proof of its deadline, the plugin's kill of it at or after
 * idle plus the deadline. Logs as the barriers write them, ms after an idle
 * at 1,000; the Stop's pid is a process that has ended.
 */

const IDLE = 1_000;
const dead = spawnSync("true").pid;

/** A log of `lines`, each `[name, ms after idle, n?]`; `stop` carries `pid`. */
function log(lines: [string, number, number?][], pid = dead) {
  const path = join(tempDir("squeal-held-stop-"), "log");
  const rows: [string, number, number?][] = [["idle", 0], ["stop", 10, pid], ...lines];
  writeFileSync(
    path,
    rows
      .map(([name, at, n]) => [name, IDLE + at, ...(n === undefined ? [] : [n])].join(" "))
      .join("\n"),
  );
  return { log: path };
}

const now = IDLE + 2_100;

describe("stopGone, the held Stop's end (review 008-32 B2)", () => {
  it("is a miss when the plugin killed the Stop at its deadline", () => {
    const gone = stopGone(log([["kill", IDLE_DEADLINE_MS, dead]]), now);
    expect(gone).toMatchObject({ missed: true });
    expect(gone?.why).toContain(`killed the held Stop at +${IDLE_DEADLINE_MS}, at or after`);
  });

  it("fails a kill before the deadline: not the deadline's", () => {
    const gone = stopGone(log([["kill", IDLE_DEADLINE_MS - 1, dead]]), now);
    expect(gone).toMatchObject({ missed: false });
    expect(gone?.why).toContain(`at +${IDLE_DEADLINE_MS - 1}, before its idle deadline`);
  });

  it("fails an exit of the Stop's own, even past the deadline", () => {
    const gone = stopGone(
      log([
        ["exit", 2_050, 1],
        ["kill", 2_050, dead],
      ]),
      now,
    );
    expect(gone).toMatchObject({ missed: false });
    expect(gone?.why).toContain("exited on its own at +2050 (code 1)");
  });

  it("fails as unresolved with no kill of the Stop, even seen gone past the deadline", () => {
    const gone = stopGone(log([["kill", 2_050, dead + 1]]), now);
    expect(gone).toMatchObject({ missed: false });
    expect(gone?.why).toMatch(/^unresolved: .*seen gone \+2100 ms after idle.*no kill of it/);
  });

  it("fails as unresolved with no idle to time the kill", () => {
    const path = join(tempDir("squeal-held-stop-"), "log");
    writeFileSync(path, `stop 1010 ${dead}\nkill 3500 ${dead}\n`);
    const gone = stopGone({ log: path }, now);
    expect(gone).toMatchObject({ missed: false });
    expect(gone?.why).toMatch(/^unresolved: .*no idle to time its kill/);
  });

  it("is nothing while the Stop runs, or once it answered", () => {
    expect(stopGone(log([], process.pid), now)).toBeNull();
    expect(stopGone(log([["answered", 1_500]]), now)).toBeNull();
  });
});
