# Issue 252 throwaway probe

Throwaway research fixture; not a product test. Run from the repository root:

```sh
python3 docs/specifications/011-core/research/probes/issue-252/probe.py
```

Requires the checkout's installed dependencies and committed CLI bundle. The script creates a nested Git fixture under ignored `fixture/`, links the checkout's node_modules, and uses the bundled CLI without building it. It checks load before each command, starts a one-test daemon, tests the reported name, a rename, a warm addition and an explicit-exclusion control, then stops the daemon in `finally`. It saves normalized CLI output in `output.json`.

Only rerun after the previous daemon stopped: the script replaces its own fixture directory. If interrupted, run the checkout's bundled `squeal stop --until-start` from `fixture/` first. Fixture state, node_modules and its nested Git store are ignored. No full suite runs.
