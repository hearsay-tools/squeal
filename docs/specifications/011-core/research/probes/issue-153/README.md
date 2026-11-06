# Issue 153 throwaway probes

These are research fixtures, not product tests. Run from the repository root:

```sh
pnpm exec tsx docs/specifications/011-core/research/probes/issue-153/stop.ts > docs/specifications/011-core/research/probes/issue-153/stop-output.jsonl
node docs/specifications/011-core/research/probes/issue-153/live.mjs > docs/specifications/011-core/research/probes/issue-153/live-output.jsonl
```

`stop.ts` calls production decision functions with deliberately partial synthetic stores. It does not run a Stop hook, daemon, waiting timer or real stop command. It tests registration provenance separately from the current revision, then the group's moment predicate.

`live.mjs` creates two isolated temporary Git repositories. It uses the checkout's committed CLI bundle and links installed dependencies; it installs nothing. One tiny slow Vitest file and a `globalSetup` with a cooperative teardown stand in for a project environment. There is no browser, server, network listener or Cezar environment. The first case uses lookup-only; the second explicitly runs missing baseline results. It writes no tracked files after the fixture commit. It stops each fixture daemon and removes the fixture in `finally`; a fallback terminates only the child PID the fixture recorded. No node_modules is committed.

Both scripts skip live work if one-minute load exceeds CPU count. The CLI calls have a 25-second outer bound; this probe does not investigate the product's 60-second stop timeout. The post-stop elapsed sample includes a 300 ms observation pause. Child liveness excludes zombies. Output files preserve the actual 0.1.407 run on Node 24.22.1 / Vitest 5.0.3. See the [findings](../../issue-153.md) for limits and interpretation.
