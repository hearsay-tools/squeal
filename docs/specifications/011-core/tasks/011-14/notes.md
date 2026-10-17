# 011-14 worker notes: the fingerprint masks ports and temp paths

Worker 94176dab, 2026-10-17, on 0.1.210. The coordinator accepted the four defaults below the same day (request 73697f74).

## Rules (`src/core/state/fingerprint.ts`, `VOLATILE`)

- **Port**: `<host>:<1-5 digits>` reads `<host>:<port>` after an IPv4 address, `localhost`, a bracketed IPv6 address or a URL's host (after `://`). A bare `name.tld:port` is not masked, so a source line in `server.ts:1234` stays. A port followed by `:<digit>` (`path:line:col`) is never masked. `port <digits>` reads `port <port>` (any case).
- **Temp path**: the roots are `os.tmpdir()`, its realpath and `/tmp`. They are read at use and cached per `tmpdir()` value, because the daemon sets its scratch `TMPDIR` after the module loads. Below a root, every segment up to the **last random segment** reads `<tmp>`, and the tail is kept. The first segment always counts as random (spec 001 D6). The other random segments are a `mkdtemp` suffix (`-` and six `[A-Za-z0-9]` ending the segment, not all lower case, so `-module` is a name), a UUID, and a hex run of 16 or more characters with a letter. Squeal's `/tmp/squeal-<uid>/tmp/<key>/x-AbC123/a.js` and the same file below the daemon's own scratch root both read `<tmp>/a.js`.
- `renormalizeFingerprint` normalizes the message part of a stored fingerprint again and keeps the name and the location. The rules map their own output to themselves. A path rooted at `<tmp>` keeps its first segment and loses everything up to its last random segment (`<hex>`, `<uuid>` count). So the old rules' `<tmp>/tmp/<hex>/x-AbC123/a.js` reads `<tmp>/a.js`.

## Recompute

- `rewriteFingerprints(store, version, rewrite)` in the new `src/core/store/fingerprints.ts` is exported from `src/core/store/index.ts`. Once per rules version (meta key `fingerprint.rules` = `FINGERPRINT_RULES`, 2), it rewrites `results.fingerprint`, `known_states.fingerprint`, `transitions.from_fingerprint`/`to_fingerprint` and `consumer_views.fingerprint` with `UPDATE … WHERE col = old`, one distinct value at a time.
- Called once, in `Daemon.#register`'s transaction, before any state is derived. A store-wide gate: the first daemon of any worktree to start under the new rules rewrites the whole store. An older daemon still running writes old-rule fingerprints until it is replaced; each such failure can read as changed once.
- **Exception, baseline findings**: the `baselineFindings` meta entries (`check\0fingerprint`, `src/core/state/baseline.ts`) are not rewritten. A first-seen failure still untold at the upgrade, whose fingerprint the new rules change, loses its "baseline finding" label. It is delivered as an ordinary first-seen failure.
- A bump of `FINGERPRINT_RULES` whenever `VOLATILE` changes makes the next start rewrite again. The rewrite is idempotent, so a spurious bump costs only a scan.

## Two-worktree verdict (inherited half)

`test/integration/fingerprint-two-worktrees.test.ts`. In worktree A, `serve` fails with a fresh port and `mkdtemp` path and `heals` fails while a marker exists. The marker is removed, and B runs the same key: `serve` fails with another port and `heals` passes. `storeResults` heals A from B's rows (`sink.refresh`). Observed on this checkout:

- old rules: A's history for `serve` was `first-seen-fail, fail-changed`, and A's consumer got `serve fail-changed` + `heals fail-to-pass`. The issue's `FAIL -> FAIL, failure changed` with no edit, reproduced through the heal refresh.
- new rules: history `first-seen-fail` only, and the delta is `heals fail-to-pass` only.

The equal fingerprints are the fix, so `storeResults` is unchanged. The lookup-hit path (research Q3, second bullet) compares the same stored fingerprint and needs nothing more.

## Spec wording for the coordinator

C5's normalization list could read: "…times, durations, addresses, UUIDs, hex identifiers of 16 or more characters, a port after a host or the word `port`, and temp or cache directory paths up to their last random segment (the tail is kept)…". Add that stored fingerprints are rewritten once when the rules change.

## Repair 1 (review wave 1.12, 2026-10-17)

Supersedes "Rules: Temp path", the `renormalizeFingerprint` bullet and all of "Recompute" above.

- **Temp path, one rule.** A root is `os.tmpdir()`, its realpath, `/tmp`, or Squeal's scratch layout `<one of those>/squeal-<digits>/tmp/<one segment>` below one (any worktree's key). The deepest root holding the path wins, and the **one segment directly below it** reads `<tmp>` whatever its spelling. Deeper segments are kept; a UUID or a 16+ hex run in them still reads `<uuid>`/`<hex>` by the global rules. The `mkdtemp`-suffix guess and the cut at the last random segment are gone (B1, B2). A path exactly at Squeal's root (`/tmp/squeal-501/tmp/k1`, nothing below) falls back to `/tmp` as its root: `<tmp>/tmp/k1`.
- **Old forms.** The rules before 011-14 masked a root and its first segment, so they stored `<tmp>/tmp/<hex>/<allocation>/<rest>` for Squeal's layout. `<tmp>/tmp/<hex>/` is read as Squeal's scratch root, and that stored form reads `<tmp>/<rest>`, the fresh form. Any other path starting `<tmp>/` is already masked and kept. Cost: a fresh `/tmp/<not squeal-N>/tmp/<16 hex>/<x>/...` loses `<x>` when compared, which no known layout produces.
- **Compare, do not rewrite (B3).** `rewriteFingerprints`, `src/core/store/fingerprints.ts`, the `Daemon.#register` call, `FINGERPRINT_RULES` and the `fingerprint.rules` meta key are removed; stored rows stay as their writer made them. `sameFingerprint(a, b)` in `fingerprint.ts` is `a === b` or both renormalized equal, used at `derive.ts` (`stateFromResult`'s `unchanged`, `sameState`), `shown-result.ts`, `producers.ts` (`producerResult`, found by the brief's grep), `transitions.ts` (`transitionKind`'s `fail -> fail`, found by the grep: the sink's transitions and the delta's view-vs-state both go through it) and `delivery/delta.ts` (`beforeFailing`). The baseline-findings lookup renormalizes both its stored entries and the probe (N1): an old-form entry still labels the fresh failure.
- **S1.** `renormalizeFingerprint` normalizes everything before the last `" @ "`, name and message together, location kept. An error name holding `": "` (`Error: port 12345`) reads the same whichever split an older rule used.
- **Residual, not fixed here.** An older daemon still running compares its own fresh fingerprint with `===` against a row current code wrote (a masked port, a masked allocation) and can report `fail-changed` once for that check, until it is replaced. Current code never does so against any row an older daemon wrote, before or after the upgrade.
- **Tests.** `test/state/fingerprint-volatile.test.ts` (B1, B2, Squeal root under any temp root, S1, `sameFingerprint`); `test/state/fingerprint-upgrade.test.ts` replaces `refingerprint.test.ts` (identical raw failure and fresh port against an old-form state, no row rewritten, the reviewer's old-writer-after-upgrade-then-replacement sequence, a consumer told the current form, the S1 renormalized row, the old-form baseline entry). `test/daemon/refingerprint-start.test.ts` is deleted with the rewrite. All twelve new cases fail on 09956c8f with behavioural assertions (`fail-changed`, kept/lost segments, the baseline label), `sameFingerprint` cases on its absence.
- `KEY_FORMAT_VERSION` 11 re-pinned in place to `10b85de5…`.

## Repair 2 (re-review of wave 1.12, the human's narrow third round, 2026-10-17; coordinator)

- **R1.** The old-forms rule reads `<tmp>/tmp/<key>` with the key `<hex>` or 16 decimal digits: a scratch key is the first 16 hex characters of a hash, and the old rules kept an all-digit one verbatim. `renormalizeFingerprint` normalizes until the text no longer changes, so a kept tail beginning `tmp/<hex>/` ends at the same form from the old and the fresh side; each further pass only shortens the text. The claim above that every rule maps its own output to itself was false for that tail. Cost: a fresh tail `tmp/<16 hex or digits>/<x>/...` below an allocation loses `<x>` when compared, as the simple collision named under Repair 1 does.
- **R2.** `untold` in `src/harness/shared/stop-slow.ts` compares the told view with `sameFingerprint`; the regression runs for Claude Code and Codex, the told view in the older rules' form, this turn and the next without re-registering.
- All four new cases fail on 7b96b921.
