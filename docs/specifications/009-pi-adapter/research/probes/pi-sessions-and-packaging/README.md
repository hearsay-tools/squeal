# Throwaway Pi 1.0.4 sessions and packaging probes

Research fixtures, not product code or a supported test suite. The scripts use only a scripted fake provider and a disposable sentinel. They never open a Squeal store. The fake provider logs its full request contexts inside the scratch directory; committed results retain only the relevant excerpts, event counts and identity comparisons.

## Isolation and repeat

Run Pi **only as `squeal-e2e`**, with no model credentials. Never read an authentication file. Stop if sudo is refused. The scripts assert this host's throwaway UID (1002). The agent user only reads installed source and copies the probes; it does not execute Pi.

On this host Pi 1.0.4 was already installed in `/home/squeal-e2e/.npm-global`. If absent, install it under the throwaway account:

```sh
sudo -n -u squeal-e2e -H env -i HOME=/home/squeal-e2e \
  PATH=/opt/squeal-e2e/node24/bin:/usr/bin:/bin sh -c \
  'cd /; npm install -g --prefix /home/squeal-e2e/.npm-global @earendil-works/pi-coding-agent@1.0.4'
```

From this probe directory, copy only the intended files:

```sh
sudo -n -u squeal-e2e -H mkdir -p /home/squeal-e2e/pi-sessions-packaging-probe/package
tar -cf - package.json probe.mjs sentinel.mjs run.py packaging.py resume.py cezar.mjs |
  sudo -n -u squeal-e2e -H tar -C /home/squeal-e2e/pi-sessions-packaging-probe/package -xf -
```

Each controller sets `PI_CODING_AGENT_DIR` to its private scratch directory and turns off Pi background network/telemetry. Run these in order:

```sh
sudo -n -u squeal-e2e -H env -i HOME=/home/squeal-e2e \
  PATH=/home/squeal-e2e/.npm-global/bin:/opt/squeal-e2e/node24/bin:/usr/bin:/bin \
  sh -c 'cd /; python3 /home/squeal-e2e/pi-sessions-packaging-probe/package/run.py'
sudo -n -u squeal-e2e -H env -i HOME=/home/squeal-e2e \
  PATH=/home/squeal-e2e/.npm-global/bin:/opt/squeal-e2e/node24/bin:/usr/bin:/bin \
  sh -c 'cd /; python3 /home/squeal-e2e/pi-sessions-packaging-probe/package/packaging.py'
sudo -n -u squeal-e2e -H env -i HOME=/home/squeal-e2e \
  PATH=/home/squeal-e2e/.npm-global/bin:/opt/squeal-e2e/node24/bin:/usr/bin:/bin \
  sh -c 'cd /; python3 /home/squeal-e2e/pi-sessions-packaging-probe/package/resume.py'
```

`run.py` exercises six idle-delivery forms in RPC and real PTY TUI sessions, print termination, detached-child survival, built-in bash metadata and session lifecycle. `packaging.py` checks global/local install, project trust, and implicit `.mjs` versus `.js` discovery. `resume.py` chooses the sole copied session in a terminal picker. Each writes a `*-results.json` or `results.json` in scratch. Timing allowances are fixture waits, not measured latency guarantees.

`cezar.mjs` imports the real installed PiRunner, not a reimplementation. The test account cannot read the agent's installation, so copy **only package code**, never configuration or credentials:

```sh
sudo -n -u squeal-e2e -H mkdir -p /home/squeal-e2e/pi-sessions-packaging-probe/cezar-source/node_modules
tar -C /home/agent/.nvm/versions/node/v24.21.0/lib/node_modules/cezarion/node_modules/@wjarka/cezarion \
  -cf - dist scripts package.json |
  sudo -n -u squeal-e2e -H tar -C /home/squeal-e2e/pi-sessions-packaging-probe/cezar-source -xf -
tar -C /home/agent/.nvm/versions/node/v24.21.0/lib/node_modules/cezarion/node_modules -cf - zod |
  sudo -n -u squeal-e2e -H tar -C /home/squeal-e2e/pi-sessions-packaging-probe/cezar-source/node_modules -xf -
sudo -n -u squeal-e2e -H env -i HOME=/home/squeal-e2e \
  PATH=/home/squeal-e2e/.npm-global/bin:/opt/squeal-e2e/node24/bin:/usr/bin:/bin \
  sh -c 'cd /; node /home/squeal-e2e/pi-sessions-packaging-probe/package/cezar.mjs'
```

This does not launch a Cezar worker or modify its task database. It calls the runner as a library with a fake provider; model usage is fabricated and cost is zero. The source version and hashes are in the findings document. `cezar-results.json` records persistent mode, auto-end with a 200 ms wake, and auto-end with a 600 ms wake.

## Results and limits

All final probe controllers exited 0 on 2026-10-14. See `results.json`, `packaging-results.json`, `resume-results.json` and `cezar-results.json`. Each Pi process was reaped. Each sentinel was terminated after a changing-heartbeat check; its 20-second self-exit is a fallback. Keep the final process check scoped to this scratch path, because another researcher shares the throwaway account.

Early probe corrections, not hidden product results:

- An uncancelled timer after print shutdown threw Pi's stale-context error. `session_shutdown` now clears it.
- Manual compaction of two tiny messages returned “Nothing to compact”; the fixture now supplies a longer message and a one-token recent-history threshold.
- `--fork` takes the source itself; it cannot be combined with `--session`.
- Package flags must follow the subcommand; local removal from an untrusted project requires `--approve`.
- The terminal picker needed a longer readiness wait on this host; two seconds before and after Enter completed selection.

Npm/git install, full cockpit task transitions, third-party subagent packages and model behavior are not tested. The sentinel proves process mechanics, not Squeal daemon integration. This is a research snapshot, not a replacement for adapter end-to-end tests.
