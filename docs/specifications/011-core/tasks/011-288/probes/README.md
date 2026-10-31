# Row 011-288 probes

Throwaway. `lock-time.probe.ts` measures how much longer a normal (not stopped) delivery
holds the store's write lock now that it commits after the hand-off. `lock-patch.ts` wraps
`HoldingConnection.hold` to time each held report from the end of its delivery's
transaction body to its COMMIT. Run alone, from the repository root:

```sh
env -u PLUGIN_ROOT -u PLUGIN_DATA pnpm exec vitest run \
  --config docs/specifications/011-core/tasks/011-288/probes/vitest.config.ts --silent=false
```

Fixtures and bundles go to private `/tmp` directories. No real harness, no daemon, no
CPU load made on purpose. `results.txt` holds the run recorded in `../design.md`.

`deadline-reversed.real.ts` is `research/probes/ci-opencode-continued/deadline.probe.ts`
with its third case reversed: real OpenCode 1.18.35, the scripted provider, private HOME
and XDG dirs, bundles built from the branch into `/tmp`. About 75 s:

```sh
env -u PLUGIN_ROOT -u PLUGIN_DATA pnpm exec vitest run \
  --config docs/specifications/011-core/tasks/011-288/probes/deadline.vitest.config.ts --silent=false
```

`deadline-reversed-results.txt` holds its run. The `delivery-receipt` probe's entries call
the handlers and write or post the text themselves, so they bypass the wrappers this row
changed; its reversed cases are the row's tests through the real wrappers:
`test/harness/hand-off.test.ts` (Claude Code, Codex), `test/harness/pi/held.test.ts` (Pi)
and `test/harness/opencode/held-answer.test.ts` (OpenCode).

