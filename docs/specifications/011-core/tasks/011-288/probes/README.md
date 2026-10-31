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
