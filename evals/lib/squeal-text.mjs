// What one Squeal text says as evidence (spec 006 D4 as amended 2026-10-11, "Retained
// evidence"): its revision and counts, and each check it names with that check's own provenance,
// as `squeal status`, a registration and a delivery word them. `evidence.mjs` keeps the timeline
// and the rules that read it.
/** Squeal saying no daemon validates (the T4 knob's state). */
export const NO_DAEMON =
  /Not validated: no daemon|Returned without a daemon|^Daemon: no daemon|No daemon (?:is running|has validated)|no daemon is validating|A daemon is starting/m;

/**
 * Another program's reply in place of Squeal's, one per call it answered (row 006-62): the
 * terminal launcher finding no plugin (spec 005 D3), the shell finding no `squeal`, Node finding
 * no CLI file.
 */
const FOREIGN =
  /^(?:squeal: no squeal@hearsay plugin is installed|.*\bsqueal(?:\.mjs)?: (?:command )?not found|.*Cannot find module '[^']*squeal\.mjs')/gm;
/**
 * A line only Squeal prints: a header, a count, a reply to a request, an explanation, or its own
 * refusal (`squeal: no daemon running for …`, `squeal run: unknown argument …`).
 */
const SQUEALS =
  /^(?:Revision:? \d|Known failures: \d|Run requested|Checkpoint |Retry (?:queued|withdrawn|asked)|Not retried|No pending retry|No verdict: |No daemon running|No slow files|Not validated|Check: |SQUEAL ·|Slow tier|Returned |squeal(?: [a-z-]+)?: |\s*"knownFailures": )/m;

/**
 * How many of a call's `n` Squeal commands Squeal never answered, from the call's output and
 * exit (row 006-62): all of them for a non-zero exit with no Squeal text, else one per foreign
 * reply. Such a command is no pull, wait or slow run through Squeal.
 */
export function unanswered(out, exit, n) {
  const text = String(out ?? "");
  const own = text.replace(FOREIGN, "");
  const squeals = SQUEALS.test(own) || squealEvidence(own, "pull") !== null;
  if (Number.isInteger(exit) && exit !== 0 && !squeals) return n;
  return Math.min(n, text.match(FOREIGN)?.length ?? 0);
}

const count = (re, text) => {
  const m = re.exec(text);
  return m ? Number(m[1]) : 0;
};

/**
 * The evidence one Squeal text carries, as a `squeal` step, or `null` for a text with none (the
 * primer alone, an explanation). `failures` is what was known failing before it, a count or a
 * `failingAfter` state: a status or a registration lists every known failure, a delivery only
 * the checks that changed.
 */
export function squealEvidence(text, from, failures = 0) {
  const t = String(text ?? "");
  const rev = /\bRevision:? (\d+)/.exec(t) ?? /\bat revision (\d+)/.exec(t);
  const daemon = !NO_DAEMON.test(t);
  const counts = countsOf(t);
  if (!rev && counts === null && daemon) return null;
  const tier = /^Slow tier: (.*)$/m.exec(t)?.[1];
  const slow =
    tier === undefined
      ? null
      : !/no slow test files listed|sources changed since|pending|queued|running|not run/.test(
          tier,
        );
  const listed = /^Known failures: (\d+)/m.exec(t);
  const selected = selectedOf(t);
  const step = {
    k: "squeal",
    from,
    revision: rev ? Number(rev[1]) : null,
    pending: counts?.pending ?? null,
    stale: counts?.stale ?? null,
    unknown: counts?.unknown ?? null,
    slow,
    daemon,
    known: listed ? Number(listed[1]) : null,
    checks: checksOf(t),
    ...(selected.length > 0 ? { selected } : {}),
    ...(/^Pending retries: \d+/m.test(t) ? { pendingRetries: pendingRetriesOf(t) } : {}),
  };
  const before = typeof failures === "number" ? { named: [], unnamed: failures } : failures;
  return settled(step, failingAfter(before, step));
}

/** `step` with what it says: its current files, its known failures and its verdict. */
export function settled(step, after) {
  const current = step.checks.filter((c) => currentCheck(step, c));
  const failures = after.named.length + after.unnamed;
  const verdict = !step.daemon
    ? "unknown"
    : failures > 0
      ? "fail"
      : clear(step)
        ? "pass"
        : "unknown";
  return {
    ...step,
    failures,
    ...(after.uncertain ? { uncertain: true } : {}),
    verdict,
    files: [...new Set([...current.map((c) => c.file), ...(step.selected ?? [])])],
    failing: [...new Set(current.filter((c) => c.to === "fail").map((c) => c.file))],
  };
}

/**
 * The known failures after squeal step `s`, from those before it (`{ named, unnamed,
 * uncertain }`, check names, a count of failures not named, and whether that count may be
 * wrong). A status or registration lists them all; in a delivery a failing check is added once
 * however often its failure changed, and a recovery or a retirement removes that same check once
 * (review wave 2.6, S2). An overflow's hidden FAIL count cannot say which hidden checks were
 * failing already, so once failures were known before it the count is uncertain until a status
 * or a registration lists them again (review wave 2.7, S2).
 */
export function failingAfter(before, s) {
  if (s.known !== null && s.known !== undefined) {
    const named = [...new Set(s.checks.filter((c) => c.to === "fail").map((c) => c.check))];
    return { named, unnamed: Math.max(0, s.known - named.length), uncertain: false };
  }
  const named = [...before.named];
  let unnamed = before.unnamed;
  let uncertain = before.uncertain === true;
  const remove = (check) => {
    const i = check === null ? -1 : named.indexOf(check);
    if (i >= 0) named.splice(i, 1);
    else if (unnamed > 0) unnamed--;
    else if (check === null) named.shift();
  };
  const knownBefore = named.length + unnamed > 0;
  for (const c of s.checks) {
    if (c.to === "fail" && c.check === undefined) {
      unnamed += c.count;
      if (knownBefore) uncertain = true;
    } else if (c.to === "fail") {
      if (!named.includes(c.check)) named.push(c.check);
    } else for (let n = 0; n < (c.count ?? 1); n++) remove(c.check ?? null);
  }
  return { named, unnamed, uncertain };
}

/**
 * Whether check `c` of squeal step `s` is current at the step's revision: its own line says no
 * older revision, no pending revision and no stale result (review wave 2.6, B2). A status lists
 * a known failure as current in words; a delivered check is current when its run was at the
 * delivery's revision.
 */
export function currentCheck(s, c) {
  if (c.check === undefined || c.validity !== "current") return false;
  if (s.from === "pull") return c.stated === true;
  return c.observed === null || c.observed === s.revision;
}

/** A named-files wait's verdict line, when each selected test file has a current result. */
const NAMED = /^Named test files at revision \d+: .*, each with a current result, after /m;

/**
 * The test files a `status --wait <ms> <path>...` answered (spec 005 D2, row 006-55): those its
 * `Selected:` line names, when its first line gives their verdict; none without a verdict. Files
 * past the line's "and N more" are not named, so not credited.
 */
function selectedOf(t) {
  if (!NAMED.test(t)) return [];
  const line = /^Selected: (.+)$/m.exec(t)?.[1] ?? "";
  return line
    .replace(/ and \d+ more$/, "")
    .split(", ")
    .filter((f) => f !== "");
}

/**
 * The test files a status lists under `Pending retries:` (spec 001 D7 as amended for 001-368;
 * row 006-53), as `  test/a.test.ts (environment): runs at once`.
 */
function pendingRetriesOf(t) {
  return [...t.matchAll(/^\s+(\S+) \((?:load|environment)\): /gm)].map((m) => m[1]);
}

/** Pending, stale and unknown counts in a delivered header or a status, or `null` for none. */
function countsOf(t) {
  let pending;
  let stale;
  let unknown;
  const header = /(\d+) current, (\d+) pending, (\d+) stale, (\d+) unknown/.exec(t);
  const affected = /^Affected checks: (.*)$/m.exec(t)?.[1];
  if (header) [pending, stale, unknown] = [header[2], header[3], header[4]].map(Number);
  else if (affected !== undefined && !/^none counted/.test(affected)) {
    pending = count(/(\d+) running/, affected) + count(/(\d+) queued/, affected);
    stale = count(/(\d+) stale/, affected);
    unknown = count(/(\d+) unknown/, affected);
  } else return null;
  const files = /Test files without checks: (\d+) pending, (\d+) unknown/.exec(t);
  if (files) {
    pending += Number(files[1]);
    unknown += Number(files[2]);
  }
  // Counts that leave out test files not listed yet, a runner part still to come, or edits a
  // named wait's deadline came before the daemon stored (row 006-55).
  if (
    /has not listed this worktree's test files|test files it adds|has not listed the test files of revision|has not stored its pass|the daemon's pass is at revision/.test(
      t,
    )
  )
    pending++;
  if (/No dependencies are installed|until an install/.test(t)) unknown++;
  return { pending, stale, unknown };
}

/** A check as `formatCheck` names it, `[project] path > test` or `path (file-level)`: its file. */
const FILE = /^(?:\[[^\]]*\] )?(\S+?)(?: > | \(|$)/;
/** A collapsed list of recoveries or retirements: `PASS  6 checks recovered (FAIL -> PASS)`. */
const COLLAPSED = /^(\d+) checks? (?:recovered|no longer reported)/;

/**
 * Each check the text names, with its own provenance (`squeal status`, a registration or a
 * delivery, as `formatDelta` and `formatStatus` word them): `{ check, file, to, from, observed,
 * validity }`, `to` `fail`, `pass` or `resolved`, `from` the outcome it changed from (`null`
 * when first observed), `observed` the revision its result is from (`null` when unstated) and
 * `validity` `current`, `pending`, `stale` or `unknown`; `stated` when a status says `current`;
 * `retried`, the reason, on a pass a retry's run delivered. A collapsed list or an overflow is
 * `{ to, count }`.
 */
function checksOf(t) {
  const checks = [];
  for (const b of t.split(/\n(?=\s*(?:FAIL|PASS|RESOLVED|UNKNOWN) {2})/)) {
    const head = /^\s*(FAIL|PASS|RESOLVED) {2}(.+)$/m.exec(b);
    if (!head) continue;
    const to = head[1].toLowerCase();
    const name = head[2].trim();
    const collapsed = COLLAPSED.exec(name);
    if (collapsed && to !== "fail") {
      checks.push({ to, count: Number(collapsed[1]) });
      continue;
    }
    const body = b.slice(head.index + head[0].length);
    const change = /^\s*(?:first observed: FAIL|(\w+) -> (?:FAIL|PASS|no longer))/m.exec(body);
    const observed = /\bat revision (\d+)/.exec(body);
    const stated = /observed at revision \d+, (\w+)/.exec(body)?.[1];
    const validity =
      stated ??
      (/\brevision \d+ pending\b|^\s*pending, observed/m.test(body)
        ? "pending"
        : /^\s*stale\b|, stale\b/m.test(body)
          ? "stale"
          : /^\s*unknown, observed/m.test(body)
            ? "unknown"
            : "current");
    // A recovery a retry's own run stored (spec 001 D6, 001-398 S2; row 006-53).
    const retried = /^\s*Retry asked \((\w+)\) at these inputs: it passed$/m.exec(body)?.[1];
    checks.push({
      check: name,
      file: FILE.exec(name)?.[1] ?? name,
      to,
      from: change ? (change[1]?.toLowerCase() ?? null) : null,
      observed: observed ? Number(observed[1]) : null,
      validity,
      ...(stated === undefined ? {} : { stated: true }),
      ...(to === "pass" && retried !== undefined ? { retried } : {}),
    });
  }
  // A delivery too long for its cap counts the rest by outcome (`formatDelta`'s overflow).
  const hidden = /^Not shown: \d+ more changed checks \(([^)]*)\)/m.exec(t)?.[1] ?? "";
  for (const [, n, outcome] of hidden.matchAll(/(\d+) (FAIL|PASS|RESOLVED)\b/g))
    checks.push({ to: outcome.toLowerCase(), count: Number(n) });
  return checks;
}

/** Nothing pending, stale or unknown, the slow tier included, with a daemon validating. */
export const clear = (s) =>
  s.daemon !== false && s.pending === 0 && s.stale === 0 && s.unknown === 0 && s.slow !== false;
