# Throwaway issue 148 probe

This is a research fixture, not a product test. `probe.py` creates and removes an isolated temporary Git repository. It runs the checkout's committed Squeal bundle against two generated Vitest tests. It installs nothing. `node_modules` is a temporary symlink to this checkout's installed dependencies and is never committed.

Requirements: Linux `flock`, Python 3, Git, Node and this repository's installed dependencies. Run from the Squeal repository root:

```sh
python3 docs/specifications/011-core/research/probes/issue-148/probe.py . > docs/specifications/011-core/research/probes/issue-148/output.jsonl
python3 docs/specifications/011-core/research/probes/issue-148/probe.py . --slow > docs/specifications/011-core/research/probes/issue-148/output-slow.jsonl
```

The driver refuses a live run when one-minute host load exceeds CPU count. It holds a real lock outside the fixture's watched files, times out globalSetup, releases the lock, tries setup and test-file environment retries, then tries a named wait. A comment edit to setup is the positive recovery control. Each fixture stops its own daemon in `finally`; it never stops the repository's daemon. Both preserved runs exited 0 and reached two current passing files only after the edit control. No full-suite request or direct Vitest suite is run.

Transcripts contain exact commands and output. Their temporary paths no longer exist. They are synthetic evidence on Squeal 0.1.402 / Vitest 5.0.3, not a replay of cezarion's browser setup, coverage collector or original lease implementation. See [findings](../../issue-148.md).
