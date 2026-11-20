# Issue 256 throwaway probe

Prepared but **not run** on 2026-11-20: final host load was 30.01/24 CPUs. The human required skipping the live reproduction above the CPU count.

This script writes only to a new `PROBE_ROOT`, creates two local commits and asks the shipped Squeal CLI about a guard in an imported helper. It uses node:test with no package dependencies. Run on an isolated machine only after checking host load and the machine's own load. Select a shipped 0.1.578 CLI and read its Squeal skill first.

```sh
PROBE_ROOT="$(mktemp -d)" SQUEAL_CLI="<shipped runtime>/dist/cli/squeal.mjs" bash probe.sh
```

No daemon is started. No package install runs in the product checkout. Proof may perform a frozen install in its own temporary checkout. JSON and stderr are written under `PROBE_ROOT`; remove that scratch directory after collecting the evidence. Never commit its `.git`, `node_modules`, or environment-specific output.

Expected comparison to investigate, not a verified result: positional helper and `--with` copy HEAD's corrected guard; `--source` should retain base's broken guard. The repeated `--source` call checks reuse after the `--with` call.
