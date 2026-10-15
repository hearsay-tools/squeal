// The knobs of the retry scenarios (row 006-53, spec 001 D6's `squeal retry`): a rates service
// the a9 and a10 cells' fixture gains, the host load their processes read, and a11's failure
// recorded under load. Each reaches only a scenario whose knobs name it; every other fixture
// stays as `buildFixture` made it.
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ATOMIC } from "./atomic.mjs";

/** The service's files, copied into the fixture at the same relative paths. */
export const SERVICE_FILES = ["src/rates.ts", "test/rates.test.ts", "scripts/rates-service.mjs"];
const RETRY = join(ATOMIC, "retry");
/** The only test file `inherited` stages: the calendar test, slow while its cache is cold. */
const CALENDAR = "test/clock.test.ts";

/**
 * Sets `env` for knobs `knobs` of the cell at `cell`: `pinLoad` preloads `retry/loadavg.mjs`
 * through NODE_OPTIONS, reading the load per CPU from `<cell>/tmp/load/per-cpu`; `service` names
 * its port file `<cell>/tmp/rates.port`. Both go with the cell's scratch. Returns `setLoad(perCpu)`, which changes the load the cell's
 * processes read from their next call on, or `null` without `pinLoad`.
 */
export function retryEnv(knobs, cell, env) {
  if (knobs.service) env.LEDGERLINE_RATES_PORT_FILE = join(cell, "tmp", "rates.port");
  if (knobs.pinLoad === undefined) return null;
  const dir = join(cell, "tmp", "load");
  mkdirSync(dir, { recursive: true });
  cpSync(join(RETRY, "loadavg.mjs"), join(dir, "loadavg.mjs"));
  const file = join(dir, "per-cpu");
  const setLoad = (perCpu) => writeFileSync(file, `${perCpu}\n`);
  setLoad(knobs.pinLoad);
  env.EVAL_LOAD_PER_CPU_FILE = file;
  const preload = `--import=${pathToFileURL(join(dir, "loadavg.mjs")).href}`;
  env.NODE_OPTIONS = env.NODE_OPTIONS ? `${env.NODE_OPTIONS} ${preload}` : preload;
  return setLoad;
}

/**
 * The `service` knob, before the warm-up: the rates service's source, test and script committed
 * into the fixture at `work` (`git` runs git there), and for `"up"` the service started with
 * `node` (`sh`'s), so the warm-up's run of its test passes; `"down"` leaves it stopped, so that
 * run stores the test's FAIL.
 */
export function addService(knobs, { work, git, sh, log }) {
  if (!knobs.service) return;
  for (const f of SERVICE_FILES) {
    mkdirSync(join(work, f, ".."), { recursive: true });
    cpSync(join(RETRY, f), join(work, f));
  }
  git(["add", "--", ...SERVICE_FILES]);
  git(["commit", "-q", "-m", "Exchange rates from the rates service", "--", ...SERVICE_FILES]);
  if (knobs.service === "up") startService(sh);
  log(`service: rates, ${knobs.service}`);
}

/** Starts the rates service unless it answers already; returns what the script said. */
export function startService(sh) {
  const r = sh("node", ["scripts/rates-service.mjs"]);
  return r.stdout.trim();
}

/** Before ground truth: the service up, whatever the session left, so truth judges the code. */
export function serviceForTruth(knobs, { work, sh, log }) {
  if (!knobs.service || !existsSync(join(work, "scripts/rates-service.mjs"))) return;
  log(`service for ground truth: ${startService(sh)}`);
}

/**
 * The `inherited` knob (`{ file, load }`), as the warm-up: a fresh daemon runs the suite while
 * the cell's processes read `load` per CPU and the calendar's cache stays cold for two runs, so
 * the calendar test times out in the first run and in Squeal's re-run, and its FAIL is stored
 * with that load (`failed-run-loads`); once the fast tier is quiet the load drops to `pinLoad`
 * and `run --all --wait` runs the slow tier the high load held. The daemon is then restarted
 * without the cold cache: the session meets the FAIL its registration says was recorded under
 * load, and a retry passes. `squeal(args, opts)` is the cell's CLI, `stop(why)` stops its daemon,
 * `recordedLoads(file)` the loads per CPU of the stored FAILs of `file` (`storeLoads`).
 *
 * The staging checks itself (review 006-57 S1): after the warm-up, and again once the fresh
 * daemon settles, `file` is a known FAIL whose stored row ran at `load` per CPU; otherwise it
 * throws, so the cell fails setup and is never graded. Returns the warm-up's output.
 */
export async function stageInherited(knobs, { squeal, stop, setLoad, log, recordedLoads }) {
  const { file, load } = knobs.inherited;
  if (file !== CALENDAR) throw new Error(`inherited: only ${CALENDAR} can be staged, not ${file}`);
  if (setLoad === null) throw new Error("inherited needs pinLoad: the load the session reads");
  const cold = { env: { LEDGERLINE_CALENDAR_COLD_RUNS: "2" } };
  setLoad(load);
  squeal(["start"], cold);
  const fast = squeal(["status", "--wait", "300000"], cold);
  setLoad(knobs.pinLoad);
  const all = squeal(["run", "--all", "--wait"], cold);
  const out = `${fast.stdout}${fast.stderr}\n${all.stdout}${all.stderr}`;
  const stands = async (when) => {
    const why = await notStaged(squeal(["status", "--json"]), file, load, recordedLoads);
    if (why !== null) throw new Error(`inherited: not staged ${when}: ${why}\n${out}`);
  };
  await stands("by the warm-up");
  await stop("inherited knob");
  squeal(["start"]);
  squeal(["status", "--wait", "120000"]);
  await stands("after the fresh daemon started");
  log(`inherited: ${file} failed at load ${load} per CPU; load now ${knobs.pinLoad}`);
  return out;
}

/**
 * Why `squeal status --json`'s result `st` and the stored FAILs' loads (`recordedLoads(file)`,
 * read once `file` is known failing) do not show `file` failing at `load` per CPU, or `null`.
 */
export async function notStaged(st, file, load, recordedLoads) {
  let snapshot;
  try {
    snapshot = JSON.parse(st.stdout);
  } catch {
    return `squeal status --json exited ${st.status}: ${`${st.stdout}${st.stderr}`.trim().slice(0, 300)}`;
  }
  const failures = Array.isArray(snapshot?.knownFailures) ? snapshot.knownFailures : [];
  const known = failures.filter((f) => f.check?.testPath === file);
  if (!known.length) return `${file} is not a known failure`;
  const loads = await recordedLoads(file);
  if (!loads.some((l) => l.toFixed(2) === load.toFixed(2)))
    return `${file}'s stored FAIL ran at ${loads.map((l) => l.toFixed(2)).join(", ") || "no recorded load"} per CPU, not ${load.toFixed(2)}`;
  return null;
}

/**
 * `recordedLoads` for the store at `database`: the load per CPU kept (`failed-run-loads`) for
 * each run that stored a FAIL of a check in `file`, read only.
 */
export function storeLoads(database) {
  return async (file) => {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(database, { readOnly: true });
    try {
      const meta = db.prepare("SELECT value FROM meta WHERE key = 'failed-run-loads'").get();
      const loads = meta ? JSON.parse(String(meta.value)) : {};
      return db
        .prepare(
          "SELECT DISTINCT r.run_id AS run FROM results r JOIN checks c ON c.id = r.check_id WHERE c.test_path = ? AND r.outcome = 'fail'",
        )
        .all(file)
        .map((r) => loads[String(r.run)])
        .filter((l) => typeof l === "number");
    } finally {
      db.close();
    }
  };
}
