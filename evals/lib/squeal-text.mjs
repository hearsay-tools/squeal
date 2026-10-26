// What one Squeal text says as evidence (spec 006 D4 as amended 2026-10-11, "Retained
// evidence"): its revision and counts, and each check it names with that check's own provenance,
// as `squeal status`, a registration and a delivery word them. `evidence.mjs` keeps the timeline
// and the rules that read it.
/**
 * Squeal saying no daemon validates (the T4 knob's state); a named wait's or snapshot's verdict
 * line says it alone in its short text (row 011-28), and status's default text as its first
 * `Outstanding:` group (row 011-29). From row 011-34 a daemon that stops or hands over
 * validates nothing either: status, a wait, a header and a delivery's title say `the daemon is
 * stopping` or `handing over`, a wait past the handoff's bound `the handoff`, and `start` that
 * no daemon follows it. From row 011-250 a wait that went on while a daemon held the lock with
 * no record says that daemon `does not serve yet`; from row 011-251 one that a hook started and
 * that holds no lock yet says the same.
 */
export const NO_DAEMON =
  /Not validated: no daemon|Returned without a daemon|^Daemon: (?:no daemon|stopping|handing over)|No daemon (?:is running|has validated)|no daemon is validating|A daemon is starting|^Named test files have no verdict(?: at revision \d+)?: (?:no daemon|the handoff)|^ {2}no daemon has validated|[Tt]he daemon is (?:stopping|handing over)|so no daemon follows it|but no daemon of Squeal \S+ or later answered|(?:holds this worktree's lock but|a hook started a daemon that) does not serve yet/m;

/**
 * Another program's reply in place of Squeal's, one per call it answered (row 006-62): the
 * terminal launcher finding no plugin or no Node (spec 005 D3), the shell finding no `squeal`,
 * Node finding no CLI file.
 */
const FOREIGN =
  /^(?:squeal: (?:no squeal@hearsay plugin is installed|Node [\d.]+ or later is needed)|.*\bsqueal(?:\.mjs)?: (?:command )?not found|.*Cannot find module '[^']*squeal\.mjs')/gm;
/**
 * A line only Squeal prints: a header, a count, a reply to a request, an explanation, or its own
 * refusal (`squeal: no daemon running for …`, `squeal run: unknown argument …`, a usage line,
 * `why`'s no match or several, a store it cannot read; review 006-63 B3).
 */
const SQUEALS =
  /^(?:Revision:? \d|Known failures: \d|Run requested|Checkpoint |Retry (?:queued|withdrawn|asked)|Not retried|No pending retry|No verdict: |No daemon running|No slow files|Not validated|Check: |SQUEAL ·|Slow tier|Returned |squeal(?: [a-z-]+)?: |\s*"knownFailures": |usage: squeal |No check matches ".*" in this worktree\.|".*" matches \d+ checks in this worktree:|Status unavailable, |Squeal daemon |Stop requested)/m;

const base = (bin) => bin.replace(/^.*\//, "");

/**
 * The binaries of `bins` that could have printed foreign reply `reply`: the launcher's and the
 * shell's name the program run (`squeal`, a launcher's path, `squeal.mjs`), Node's the file.
 */
function printedBy(reply, bins) {
  const module = /Cannot find module '([^']*)'/.exec(reply)?.[1];
  if (module !== undefined)
    return bins.filter((b) => b === module || module.endsWith(`/${b.replace(/^\.\//, "")}`));
  const name =
    /no squeal@hearsay/.test(reply) || /\bsqueal: /.test(reply) ? "squeal" : "squeal.mjs";
  return bins.filter((b) => base(b) === name && !b.startsWith("npx "));
}

/**
 * Whether Squeal answered each of a call's executed Squeal commands, named by the CLI each ran
 * (`bins`, the actions' `bin`), from the call's output and exit: `true`, `false`, or `null` when
 * the output cannot say (review 006-63 B2). None was answered when the call exited non-zero with
 * no Squeal text. Otherwise each foreign reply is the command's whose CLI could print it: the
 * launcher's and the shell's a bare `squeal` or a launcher's path, Node's the `squeal.mjs` it
 * names. One CLI answers each of its commands in a call alike, so a CLI with as many foreign
 * replies as commands answered none, one with none answered all, and one with fewer, or a reply
 * more than one CLI could print, cannot say.
 */
export function answered(out, exit, bins) {
  const text = String(out ?? "");
  const own = text.replace(FOREIGN, "");
  const squeals = SQUEALS.test(own) || squealEvidence(own, "pull") !== null;
  if (Number.isInteger(exit) && exit !== 0 && !squeals) return bins.map(() => false);
  const distinct = [...new Set(bins)];
  const foreign = new Map();
  const unsure = new Set();
  for (const [reply] of text.matchAll(FOREIGN)) {
    const by = printedBy(reply, distinct);
    if (by.length === 1) foreign.set(by[0], (foreign.get(by[0]) ?? 0) + 1);
    else for (const b of by.length === 0 ? distinct : by) unsure.add(b);
  }
  return bins.map((b) => {
    const f = foreign.get(b) ?? 0;
    const n = bins.filter((x) => x === b).length;
    return unsure.has(b) ? null : f === 0 ? true : f >= n ? false : null;
  });
}

const count = (re, text) => {
  const m = re.exec(text);
  return m ? Number(m[1]) : 0;
};

/** The top-level keys of a Claude Code hook's JSON reply; Squeal's own `--json` uses none. */
const HOOK_KEYS = [
  "hookSpecificOutput",
  "decision",
  "reason",
  "continue",
  "stopReason",
  "suppressOutput",
  "systemMessage",
];

/**
 * The Squeal text a Claude Code hook's JSON reply carries (`hookSpecificOutput`'s
 * `additionalContext` or a deny's `permissionDecisionReason`, a stop's block `reason`), which
 * Claude Code keeps as the hook's output; any other text as it is (row 006-77). Claude Code shows
 * the model a decision's reason only on a deny, an ask (a cell is a `-p` run, where an ask is
 * refused and its reason is the tool's result) or a block; an allow's or a defer's reason goes to
 * the debug log, so a reply carrying no other text reads as none (review 006-81 B1).
 */
export function hookText(t) {
  if (!t.trimStart().startsWith("{")) return t;
  let reply;
  try {
    reply = JSON.parse(t);
  } catch {
    return t;
  }
  if (!HOOK_KEYS.some((k) => Object.hasOwn(reply ?? {}, k))) return t;
  const own = reply.hookSpecificOutput;
  const texts = [
    own?.additionalContext,
    ["deny", "ask"].includes(own?.permissionDecision) ? own.permissionDecisionReason : undefined,
    reply.decision === "block" ? reply.reason : undefined,
  ];
  return texts.filter((x) => typeof x === "string").join("\n");
}

/**
 * The evidence one Squeal text carries, as a `squeal` step, or `null` for a text with none (the
 * primer alone, an explanation). `failures` is what was known failing before it, a count or a
 * `failingAfter` state: a status or a registration lists every known failure, a delivery only
 * the checks that changed. A status cut above its `Revision:` line (`| tail`) is at the revision
 * its checkpoint line says its counts are for (row 006-77).
 */
export function squealEvidence(text, from, failures = 0) {
  const t = hookText(String(text ?? ""));
  const rev =
    /\bRevision:? (\d+)/.exec(t) ??
    /\bthe counts are for revision (\d+)/.exec(t) ??
    /\bat revision (\d+)/.exec(t);
  const daemon = !NO_DAEMON.test(t);
  const counts = countsOf(t);
  if (!rev && counts === null && daemon) return null;
  const tier = /^Slow tier: (.*)$/m.exec(t)?.[1];
  const slow =
    tier === undefined
      ? null
      : // "sources changed since" before 0.1.218, "have not tested" in 0.1.218 and 0.1.219 (row
        // 004-76); from 0.1.220 a current part names neither (row 004-81).
        !/no slow test files listed|sources changed since|have not tested|pending|queued|running|not run/.test(
          tier,
        );
  // A named wait's short text (row 011-28) has no `Known failures:` line; its verdict line ends
  // with the worktree's.
  const listed = /^Known failures: (\d+)/m.exec(t) ?? /\bWorktree: known failures (\d+)/.exec(t);
  const selected = selectedOf(t);
  const step = {
    k: "squeal",
    from,
    revision: rev ? Number(rev[1]) : null,
    pending: counts?.pending ?? null,
    stale: counts?.stale ?? null,
    unknown: counts?.unknown ?? null,
    slow,
    ...(tier === undefined ? {} : { slowNotCurrent: slowNotCurrentOf(tier) }),
    ...(counts?.news ? { news: true } : {}),
    daemon,
    known: listed ? Number(listed[1]) : null,
    checks: checksOf(t),
    ...(selected.length > 0 ? { selected } : {}),
    ...(/^Pending retries: \d+|^ {2}\d+ test files? with a pending retry /m.test(t)
      ? { pendingRetries: pendingRetriesOf(t) }
      : {}),
  };
  const before = typeof failures === "number" ? { named: [], unnamed: failures } : failures;
  return settled(step, failingAfter(before, step));
}

/**
 * How many slow files the `Slow tier:` line `tier` (the text after the label) states are not
 * current: its files less those current, a current part whose sources changed since counting as
 * not current (spec 004 D8's wording, in either version); 0 for a tier with no slow files listed (006-91).
 */
export function slowNotCurrentOf(tier) {
  const files = Number(/^(\d+) test files?;/.exec(tier)?.[1] ?? 0);
  const part = tier.split("; ").find((p) => /^\d+ current\b/.test(p));
  // In 0.1.218 and 0.1.219 the clause follows its own "; ": "...; the source changes since are
  // not in it, so these files have not tested them" (row 004-76); before, ", sources changed
  // since"; from 0.1.220, neither (row 004-81).
  const stale = /sources changed since/.test(part ?? "") || /have not tested/.test(tier);
  const current = part === undefined || stale ? 0 : parseInt(part, 10);
  return Math.max(0, files - current);
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
    const named = [
      ...new Set(
        s.checks.filter((c) => c.to === "fail" && c.check !== undefined).map((c) => c.check),
      ),
    ];
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
 * delivery's revision. A group's count of one test file (row 011-109) is current as its checks
 * are; a count with no file, an overflow's or a collapsed list's, never is.
 */
export function currentCheck(s, c) {
  if (c.file === undefined || c.validity !== "current") return false;
  if (s.from === "pull") return c.stated === true;
  return c.observed === null || c.observed === s.revision;
}

/**
 * A named-files wait's verdict line, when each selected test file has a current result; a
 * snapshot's (`status <path>...`, row 011-28) names no time after it.
 */
const NAMED =
  /^Named test files at revision \d+: .*, each with a current result(?:, after |[.;] |$)/m;

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
 * row 006-53), as `  test/a.test.ts (environment): runs at once`; from row 011-29 its
 * `Outstanding:` groups, `  2 test files with a pending retry (load): a, b; runs at ...`, whose
 * files past "and N more" are not named, each by its path without its project.
 */
function pendingRetriesOf(t) {
  const listed = [...t.matchAll(/^\s+(\S+) \((?:load|environment)\): /gm)].map((m) => m[1]);
  const grouped = [...t.matchAll(/^ {2}\d+ test files? with a pending retry \([^)]*\): (.+?); /gm)]
    .flatMap((m) => m[1].replace(/ and \d+ more$/, "").split(", "))
    // A group leads a named project's path with the project (`unit: test/a.test.ts`).
    .map((f) => f.slice(f.lastIndexOf(": ") + 1).trimStart());
  return [...listed, ...grouped];
}

/** A header's counts, each of which may name its parts: `30 current (23 tests, 7 test files loaded)`. */
const HEADER = new RegExp(
  ["current", "pending", "stale", "unknown"].map((v) => `(\\d+) ${v}(?: \\([^)]*\\))?`).join(", "),
);

/**
 * A change delivery's header from 001-407 on: only the non-zero counts of what needs attention,
 * `Revision 12: 3 pending (2 tests, 1 test file loaded), 1 stale (1 test).`, or `Revision 12: no
 * check pending, stale or unknown.`; the revision may name its commit (`Revision 12 · 0a1b2c3d +
 * 2, dirty: …`). From row 011-205, with no such check but test files without checks, those alone:
 * `Revision 12: test files without checks: 97 unknown.`, which counts no check.
 */
const NEWS =
  /^Revision \d+(?: · [^:]*)?: (?:(no check pending, stale or unknown|\d+ (?:pending|stale|unknown)\b[^.]*)\.|(?=test files without checks: ))/m;

/**
 * The clause after a `Known failures:` count, or after a wait verdict line's `known failures`,
 * from row 011-26 (011 C6 as amended 2026-10-20): `not current: 8 of 10 test files (2 queued, 6
 * stale), 80 tests (20 queued, 60 stale)`, its test files' parts, then its tests'. A count may
 * hold its own `; ` (Stop's `and 2 more; \`squeal status\` lists every one`), so the clause is
 * the last on its line.
 */
const NOT_CURRENT =
  /known failures:? .*; not current: \d+ of \d+ test files? \(([^)]*)\)(?:, \d+ tests? \(([^)]*)\))?/im;
/** The same clause when nothing is counted as not current: all current, or no test files listed. */
const NONE_NOT_CURRENT =
  /known failures:? .*; (?:all \d+ test files? current|\d+ test files? current|the daemon (?:listed no test files|has not listed this worktree's test files))/im;

/**
 * Status's default text from row 011-29 (011 C6 as amended 2026-10-20): its `More:` line names
 * what `--full` adds, the test files without checks among it.
 */
const MORE = /^More: `[^`]*status --full` adds /m;

/**
 * Pending, stale and unknown counts in a delivered header, a status or, without either, the
 * not-current clause of a wait's verdict line (row 011-26), or `null` for none. The clause counts
 * test files and tests apart, so a file and its tests both count. Status's default text (row
 * 011-29) has no `Test files without checks:` line, so its counts are its clause's.
 */
function countsOf(t) {
  let pending;
  let stale;
  let unknown;
  const header = HEADER.exec(t);
  const newsMatch = NEWS.exec(t);
  const news = newsMatch === null ? undefined : (newsMatch[1] ?? "");
  const affected = /^Affected checks: (.*)$/m.exec(t)?.[1];
  const short = MORE.test(t) && !/^Test files without checks: /m.test(t) && NOT_CURRENT.test(t);
  if (header) [pending, stale, unknown] = [header[2], header[3], header[4]].map(Number);
  else if (news !== undefined) {
    [pending, stale, unknown] = ["pending", "stale", "unknown"].map((v) =>
      count(new RegExp(`(\\d+) ${v}\\b`), news),
    );
  } else if (affected !== undefined && !/^none counted/.test(affected) && !short) {
    pending = count(/(\d+) running/, affected) + count(/(\d+) queued/, affected);
    stale = count(/(\d+) stale/, affected);
    unknown = count(/(\d+) unknown/, affected);
  } else if (NOT_CURRENT.test(t)) {
    const [, files, tests = ""] = NOT_CURRENT.exec(t);
    const both = (re) => count(re, files) + count(re, tests);
    pending = both(/(\d+) running/) + both(/(\d+) queued/);
    stale = both(/(\d+) stale/);
    unknown = both(/(\d+) unknown/);
  } else if (NONE_NOT_CURRENT.test(t)) [pending, stale, unknown] = [0, 0, 0];
  else return null;
  // Both classes in a full header and a status; a news header names only the non-zero ones. A
  // header ends the sentence with a period, a status with its line (review 001-423, B2). A news
  // header with no check to count starts with it in lower case (row 011-205).
  const files = /Test files without checks: ([^.\n]*)/i.exec(t)?.[1];
  if (files !== undefined) {
    pending += count(/(\d+) pending/, files);
    unknown += count(/(\d+) unknown/, files);
  }
  // Counts that leave out test files not listed yet, a runner part still to come, or edits a
  // named wait's deadline came before the daemon stored (row 006-55), or that a snapshot's
  // daemon did not answer for (row 011-243).
  if (
    /has not listed this worktree's test files|test files it adds|has not listed the test files of revision|has not stored its pass|the daemon's pass is at revision|did not answer its sync/.test(
      t,
    )
  )
    pending++;
  if (/No dependencies are installed|until an install/.test(t)) unknown++;
  return { pending, stale, unknown, ...(!header && news !== undefined ? { news: true } : {}) };
}

/** A check as `formatCheck` names it, `[project] path > test` or `path (file-level)`: its file. */
const FILE = /^(?:\[[^\]]*\] )?(\S+?)(?: > | \(|$)/;
/** A collapsed list of recoveries or retirements: `PASS  6 checks recovered (FAIL -> PASS)`. */
const COLLAPSED = /^(\d+) checks? (?:recovered|no longer reported)/;
/** Failures with one error and location in one block (row 011-109): `FAIL  91 checks with one …`. */
const GROUPED = /^(\d+) checks? with one error and location\b/;
/**
 * A group's facts after its change and its error: location, closure, load, flaky note, the line
 * after a notice's first flaky note on files Squeal does not track (row 011-244), retry.
 */
const GROUP_FACT =
  /^(?:at |its closure reads |none of the files changed here |load average |Flaky: |A file a test reads that Squeal does not track |Retry asked )/;
/** A count of checks, as a group names a test file's (`collapse`'s `nameLines`): `40 tests`. */
const PARTS = /^\d+ (?:tests?|test files? (?:loaded|that did not load)|global setups?)$/;

/** The checks a list of parts counts: `2 tests, 1 test file that did not load` is 3. */
const partsCount = (text) => text.split(", ").reduce((n, p) => n + parseInt(p, 10), 0);

/**
 * The provenance a failure's change line states (`formatDelta`'s words): the outcome it changed
 * from (`null` when first observed), the revision its run was at, and its validity.
 */
function provenanceOf(body) {
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
  return {
    from: change ? (change[1]?.toLowerCase() ?? null) : null,
    observed: observed ? Number(observed[1]) : null,
    validity,
    ...(stated === undefined ? {} : { stated: true }),
  };
}

/**
 * The checks of a group of `count` failures (row 011-109) whose block holds `body`: its change
 * line, its error, its facts, then the checks by name, or by test file with their counts and the
 * files past ten counted, then its `Full list:` command. Each has the change line's provenance; a
 * count the lines leave out is one more count with no file.
 */
function groupChecks(count, body) {
  const lines = body.split("\n").map((l) => l.trim());
  const [seen = ""] = lines.splice(0, 2);
  while (GROUP_FACT.test(lines[0] ?? "")) lines.shift();
  const end = lines.findIndex((l) => l.startsWith("Full list: "));
  const prov = provenanceOf(seen);
  const checks = [];
  for (const line of lines.slice(0, end < 0 ? lines.length : end)) {
    const more = /^and \d+ more test files? \((.+)\)$/.exec(line);
    const at = line.indexOf(" in ");
    if (more) checks.push({ to: "fail", count: partsCount(more[1]), ...prov });
    else if (
      at > 0 &&
      line
        .slice(0, at)
        .split(", ")
        .every((p) => PARTS.test(p))
    ) {
      const file = line.slice(at + 4);
      checks.push({
        to: "fail",
        count: partsCount(line.slice(0, at)),
        file: FILE.exec(file)?.[1] ?? file,
        ...prov,
      });
    } else if (line !== "")
      checks.push({ check: line, file: FILE.exec(line)?.[1] ?? line, to: "fail", ...prov });
  }
  const told = checks.reduce((n, c) => n + (c.count ?? 1), 0);
  if (told < count) checks.push({ to: "fail", count: count - told, ...prov });
  return checks;
}

/**
 * Each check the text names, with its own provenance (`squeal status`, a registration or a
 * delivery, as `formatDelta` and `formatStatus` word them): `{ check, file, to, from, observed,
 * validity }`, `to` `fail`, `pass` or `resolved`, `from` the outcome it changed from (`null`
 * when first observed), `observed` the revision its result is from (`null` when unstated) and
 * `validity` `current`, `pending`, `stale` or `unknown`; `stated` when a status says `current`;
 * `retried`, the reason, on a pass a retry's run delivered. A collapsed list or an overflow is
 * `{ to, count }`; a group of failures with one error and location (row 011-109) is its named
 * checks, or `{ to, count, file }` for each test file it counts, with the group's provenance.
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
    const grouped = GROUPED.exec(name);
    if (grouped && to === "fail") {
      checks.push(...groupChecks(Number(grouped[1]), body.replace(/^\n/, "")));
      continue;
    }
    // A recovery a retry's own run stored (spec 001 D6, 001-398 S2; row 006-53).
    const retried = /^\s*Retry asked \((\w+)\) at these inputs: it passed$/m.exec(body)?.[1];
    const { from, observed, validity, stated } = provenanceOf(body);
    checks.push({
      check: name,
      file: FILE.exec(name)?.[1] ?? name,
      to,
      from,
      observed,
      validity,
      ...(stated === undefined ? {} : { stated }),
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
