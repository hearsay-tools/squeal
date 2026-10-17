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
