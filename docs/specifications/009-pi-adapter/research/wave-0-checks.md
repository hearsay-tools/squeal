# 009 wave-0 checks

## Open question 5: does Pi write outside `PI_CODING_AGENT_DIR`? (row 009-11, 2026-10-14)

Answer: with only `PI_CODING_AGENT_DIR` set, Pi 1.0.4 writes nothing under `HOME`, but it does write two caches under `os.tmpdir()` and it reads the user's `~/.agents/skills`. With `HOME`, `TMPDIR` and `PI_CODING_AGENT_DIR` all inside the run's temp directory, as `test/helpers/pi.ts` sets them, it writes nothing and reads nothing of the user's outside that directory. So the helper runs locally as the agent user, not only in CI; it skips locally only when the installed Pi is not the checked 1.0.4 (`piUnavailable()`).

### Method (verified by experiment, Pi 1.0.4, Node 24.21.0)

`test/fixtures/pi/isolation-check.sh`, run from the agent user, copies itself and the fixture into `/home/squeal-e2e/pi-isolation` and runs there as `squeal-e2e` only (Pi from that user's `~/.npm-global`, the same 1.0.4 as the devDependency). In a fresh `/tmp/pi-iso.*` directory it runs the fake provider's plan (a `write` of `out.txt`, then the text `done`) in `-p`, `--mode json` and `--mode rpc` (one prompt, stdin closed at the first `agent_settled`), each under two environments:

- `agent`: `env -i HOME PATH PI_CODING_AGENT_DIR=<temp>/agent PI_OFFLINE=1`, the spec's question.
- `helper`: the same plus `HOME=<temp>/home TMPDIR=<temp>/tmp`.

Each run is traced with `strace -f -e trace=%file,%desc`; the script lists every file-changing syscall (write-mode `open`/`openat`, `mkdir`, `rename`, `unlink`, `rmdir`, links, `chmod`, `chown`, `utimensat`, `truncate`) on a path outside the temp directory, and every path under the real `HOME` Pi touched at all. The trace saw the `write` tool's `openat(".../proj/out.txt", O_WRONLY|O_CREAT|O_TRUNC)`, so file writes are not hidden in io_uring. A second check snapshots `HOME` and this user's files in `/tmp`, `/var/tmp` and `/dev/shm` (path, size, mtime) before and after. `~/runs` is excluded: the eval harness runs cells as `squeal-e2e` concurrently and Pi never touched it in the trace.

### Result (the script's output, 2026-10-14 17:41, abridged)

```
== print.agent: 2 model requests;
  mkdir /tmp/jiti = -1 EEXIST
  mkdir /tmp/node-compile-cache/v24.21.0-x64-964aae3f-1002 = -1 EACCES
  looked at: "/home/squeal-e2e/.agents/skills"
  looked at: "/home/squeal-e2e/.config/gcloud/application_default_credentials.json"
  looked at: "/home/squeal-e2e/.npm-global"
== json.agent: (the same)
== rpc.agent: 2 model requests; exit 0 null  (the same)
== print.helper: 2 model requests;
  looked at: "/home/squeal-e2e/.npm-global"
== json.helper: (the same)
== rpc.helper: 2 model requests; exit 0 null  (the same)
== changes under HOME (~/runs excluded) and to this user's files in /tmp, /var/tmp, /dev/shm:
  (only /tmp/squeal-1002/tmp/<hash>/..., the concurrent eval cell's Vitest cache; no Pi syscall touched it)
```

Every write inside the temp directory went to `agent/` (`auth.json`, `models-store.json`, their `.lock` directories, `sessions/--<cwd>--/<id>.jsonl`), the project and, under `helper`, `tmp/jiti/` and `tmp/node-compile-cache/`.

### What each outside path is

- `/tmp/jiti`: jiti's transpile cache for a `.ts` extension (`-e fake-provider.ts`); under `helper` it held `jiti/fixture-fake-provider.<hash>.mjs`. Under `agent` the `mkdir` failed only because `/tmp/jiti` already exists and belongs to the agent user, so as `squeal-e2e` the write was skipped; as the agent user Pi would write there.
- `/tmp/node-compile-cache/`: Node's module compile cache, which Pi enables; the same ownership story.
- `~/.agents/skills`: Pi looks for skills in `.agents/skills` up the cwd's ancestors and in `HOME`. The agent user has `~/.agents/skills`, so a test with the real `HOME` would load the human's skills into the session. A read, not a write, but it is why the helper moves `HOME` too.
- `~/.config/gcloud/application_default_credentials.json`: an existence check (`access F_OK`) by a provider's auth detection at startup; never opened.

### For later rows

A test that starts Pi uses `runPi` from `test/helpers/pi.ts` and gets the isolated environment for free. A test that spawns Pi another way (the end-to-end `pi install`) must set `HOME`, `TMPDIR` and `PI_CODING_AGENT_DIR` into its temp directory, and keep its cwd outside the repository: Pi loads `AGENTS.md` and `CLAUDE.md` from the cwd and every parent (read in official docs, `docs/configuration.md` Context files), and this repository has both. `runPi` keeps the project under `os.tmpdir()`. A Pi upgrade re-runs `isolation-check.sh` and raises `CHECKED_VERSION` in the helper.
