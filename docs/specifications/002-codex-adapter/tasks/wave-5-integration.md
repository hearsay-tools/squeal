# Wave 5 integration repairs

Use /worker. Read spec 002 D7–D9 (the fixed-plugin sections), wave-5-contract.md, and tasks/002-34/notes.md plus tasks/002-35/notes.md. Source only; no committed builds, root version raise, full suite or release. Use Squeal affected checks and lint/typecheck. Packaging 002-31 is still live; leave its files alone. New workers use codex gpt-6.1-sol xhigh by the human OpenAI override.

## 002-36 — finish: runtime identity at existing CLI and process seams

Make installed-version diagnostics and seed-started daemons use runtime identity and retained paths. Start src/core/daemon/version.ts and src/harness/shared/version-copies.ts: regress a fixed adapter 1.0.0 holding runtime 0.1.x; it must not be reported as runtime 1.0.0. Keep adapter discovery separate for setup/marketplace consumers. A CLI launched from seed must retain its complete runtime before starting a daemon, preserve session pins and expose a persistent concrete argv path. Inspect callers before changing codexNewest semantics.

Own those two files, src/core/ps/flags.ts, src/cli/start.ts, necessary src/cli/setup/harnesses.ts adjustments, small new identity helpers and focused version/ps/start/retention tests. No adapter/*, runtime-update/*, build, launcher source, or updater CLI changes. Do not touch peer process-label or daemon ensure/full-check files. Write tasks/002-36/notes.md. Done: fixed/legacy/other harness regressions, seed-start then cache removal, pinned retention and affected checks pass; report any unmet seam rather than widening.

## 002-37 — repair: updater lock exclusion and publication bound

Keep exactly one updater in its critical section through stale-lock recovery. Start runtime-update/lock.ts: A reads stale X; B replaces X with live B; A renames B aside; C acquires the empty path. Linking B back cannot repair simultaneous owners. Reproduce with controlled interleaving or real children, then implement a single exclusion mechanism whose ownership cannot be displaced by stale observation. Also enforce abort/deadline before live publication; current check calls left() before fetch/stage but not after staging or before retained publication. State claims must match the actual synchronous-work bound.

Own runtime-update/lock.ts and update.ts plus focused tests under test/harness/codex/runtime-update/ and notes tasks/002-37/notes.md. Leave schedule/state/CLI/store/artifact/build/launcher and identity files unchanged. No new dependency without asking parent. Done: stale-content race cannot create two owners; dead-owner recovery, bounded busy result, cancelled/expired staging never changing current/pins, and existing updater tests pass. Document any unavoidable filesystem-bound limit; no unsupported whole-operation guarantee.
