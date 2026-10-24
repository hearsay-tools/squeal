# Probe: issue 93 (throwaway)

Throwaway. A synthetic reproduction of gh-93 for `../../issue-93.md`. It is not part of the suite: the repository's `vitest.config.ts` includes only `test/**` and `src/**`, and the probe file ends in `.probe.ts`.

It runs the Codex Stop handler (`runCodexHook("stop", ...)`) in process against a fixture store from `test/harness/helpers.ts` and recorded `codex exec` input from `test/harness/codex/`. No Codex, no daemon process, no real HOME.

Run from this directory:

```sh
npx vitest run --config vitest.config.ts --reporter=verbose
```

Cases, every Stop gate off (`blockOnKnownFailures`, `requireFullSuite`, `requireSlowSuite` false, `waitMs` 0), all checks passing:

1. Control: nothing changed since the last tool boundary. Stop is silent.
2. Handover begun (exit note, exit marker, handoff claim to 0.1.296), the old daemon's heartbeat still fresh. Stop is silent.
3. The same, with the old daemon's heartbeat stopped, as `#shutdown` leaves it. Stop answers `{"decision":"block","reason":"SQUEAL · the daemon is handing over at revision 1 ..."}`. The next Stop, with `stop_hook_active`, is silent.

`run-2026-10-24.txt` is the recorded output.
