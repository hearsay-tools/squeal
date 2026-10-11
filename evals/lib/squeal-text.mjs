// What one Squeal text says as evidence (spec 006 D4 as amended 2026-10-11, "Retained
// evidence"): its revision and counts, and each check it names with that check's own provenance,
// as `squeal status`, a registration and a delivery word them. `evidence.mjs` keeps the timeline
// and the rules that read it.
/** Squeal saying no daemon validates (the T4 knob's state). */
export const NO_DAEMON =
  /Not validated: no daemon|Returned without a daemon|^Daemon: no daemon|No daemon (?:is running|has validated)|no daemon is validating|A daemon is starting/m;

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
    files: [...new Set(current.map((c) => c.file))],
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
  // Counts that leave out test files not listed yet, or a runner part still to come.
  if (/has not listed this worktree's test files|test files it adds/.test(t)) pending++;
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
 * `validity` `current`, `pending`, `stale` or `unknown`; `stated` when a status says `current`.
 * A collapsed list or an overflow is `{ to, count }`.
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
    checks.push({
      check: name,
      file: FILE.exec(name)?.[1] ?? name,
      to,
      from: change ? (change[1]?.toLowerCase() ?? null) : null,
      observed: observed ? Number(observed[1]) : null,
      validity,
      ...(stated === undefined ? {} : { stated: true }),
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
