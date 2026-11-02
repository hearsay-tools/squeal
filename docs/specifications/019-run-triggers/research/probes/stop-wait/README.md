# stop-wait probes (throwaway)

Throwaway scripts for `../../stop-wait.md`. Nothing here is product code or a test.

- `cc-timeout-setup.sh <case> <sleep-s> <timeout-s>`: as `squeal-e2e`, makes
  `/home/squeal-e2e/runs/sw19/<case>/repo` with one project Stop hook
  (`hook.sh`) of `timeout` <timeout-s>. The hook logs its input, sleeps
  <sleep-s> on the first Stop, then blocks once with "reply PINEAPPLE";
  with `stop_hook_active` true it exits 0 at once.
- `cc-timeout-run.sh <case>`: one `claude -p --model haiku` session in that
  repo; prints the result JSON and the hook log.
- `store-durations.mjs <store.sqlite copy>`: reads a COPY of a Squeal store
  read-only and prints slow-tier durations (per slow file run and per tier).

Run the two shell scripts through `sudo -n --preserve-env=ANTHROPIC_BASE_URL,ANTHROPIC_AUTH_TOKEN -u squeal-e2e -H sh -s -- <args> < script`
from cwd `/`. Remove `/home/squeal-e2e/runs/sw19` afterwards.
