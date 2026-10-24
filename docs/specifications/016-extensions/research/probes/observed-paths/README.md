# Probe: observed paths (016-13), throwaway

Not product code. Delete freely. It supports `../../observed-paths.md`.

`probe.ts` builds a scratch git repository under `$SCRATCH`, runs the real node:test adapter once with a stub `ObservedStore`, feeds the same observations to the core's `observedGrowth` with a stub context, checks `linkTargets` and reads a node:test-shaped meta value through `ObservedSets`. It opens no daemon and no store.

    SCRATCH=$(mktemp -d /tmp/obs-probe.XXXX)
    HOME=$SCRATCH TMPDIR=$SCRATCH XDG_RUNTIME_DIR=$SCRATCH XDG_CONFIG_HOME=$SCRATCH SCRATCH=$SCRATCH npx tsx probe.ts

`output.txt` is the run of 2026-10-25 (Node 24.21.0) at `793dfc3d4`.
