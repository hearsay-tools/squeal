# Unchanged wrapper plugin probe

Throwaway research for row 002-27 R2. Not product code or an installer.
Derived from `../stable-hook-approval/run.mjs` (002-25).

Run from this checkout:

```sh
node docs/specifications/002-codex-adapter/research/probes/stable-wrapper-plugin/run.mjs > docs/specifications/002-codex-adapter/research/probes/stable-wrapper-plugin/results.json
```

Requires Node, bash and Codex 0.164.0. `PROBE_CODEX` can name another binary;
the recorded result names the binary's version. Each CLI call has a 20-second
bound, RPC request 15 seconds, shell replay 5 seconds. No model turn starts.

The probe creates two independent temporary homes, workspaces and local
marketplaces, with spaces in their paths. Children get an allowlisted environment;
no credentials or real Codex configuration are read or copied. Only scratch
`config/batchWrite` supplies initial approval, once per scenario. It checks the
config file stays byte-identical thereafter. Scratch files are removed on success.
Results replace scratch paths and file URLs with placeholders.

The fixture copies Squeal's ten event declarations, including both Stop handlers,
but replaces each command with a harmless shell wrapper. The wrapper reads a
version selector from `PLUGIN_DATA/runtime/current.txt` and executes a versioned
fixture there. An external installer stand-in writes that fixture and replaces
the selector by rename. No symlink or fingerprint exclusion is used. The wrapper
returns 0 without output if the runtime is absent; that is fixture behavior.

Assertions cover:

- No runtime execution at an unapproved real SessionEnd boundary.
- Explicit initial approval of all ten hooks and real SessionEnd execution of A.
- External A to B update first, with identical plugin file hashes, identical
  composite approval hashes, no new trust write and real SessionEnd execution of B.
- A thread opened under B and archived after C is selected executes C in the same
  app-server process. This establishes that this wrapper does not pin its runtime
  to the thread. No model prompt or full session lifecycle is exercised.
- Replay of all ten listed commands under bash with the documented plugin
  environment, separately labelled from real Codex hook execution.
- In one home, an unchanged wrapper plus a manifest-only 1.0.0 to 1.0.1 plugin
  update loses approval. In the other, a comment added to the wrapper loses
  approval. Both changes block the real SessionEnd fixture.
- Missing runtime leaves approval unchanged and produces no execution or output.

`results.json` retains `hooks/list` records, plugin file hashes, fixture execution
records with the runtime version and incoming event/session, and negative-boundary
records. Real boundaries use `thread/start` then `thread/archive`; the latter
fires SessionEnd. All other event executions are shell replay only.
