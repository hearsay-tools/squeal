# Issue 280 probe (throwaway)

This synthetic runner exercises the real remote lane, protocol proxy, in-process runner host, Git tree selection, tree writes, environment comparison and blob proof. It starts no Vitest workers, SSH connections or cloud machines. Its temporary Git repositories are removed in `finally`; it installs no packages. `node_modules` is not part of this fixture.

From the repository root:

```sh
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
env -u NODE_OPTIONS pnpm exec tsx docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-280/probe.ts > docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-280/results.jsonl
```

Skip when one-minute load exceeds CPU count. The recorded run used Squeal source 0.1.633 at `26e64f04aefbd869fe61e3dd2df1080df905c26a`, Node v26.13.0, load `0.91 0.56 0.24`, 16 CPUs. Exit 0; eight asserted cases. An initial identical unsanitized invocation also exited 0; `NODE_OPTIONS` was absent, so the explicit unset is precautionary reproducibility only. The wire uses `0.0.0-probe` on both sides to avoid testing version handshake behavior.

`remoteRuns` counts the synthetic runner's body, excluding pre-run refusals. `retries` counts “sending again” log lines, including the line after the second refused attempt; two means two failed attempts, not three runs. Setup cases include one successful baseline in `remoteRuns`.

The synthetic closure/observed/environment paths are controlled inputs. No claim is made that real Vitest discovered precisely these paths in the reporter's project. The `setup-drift` case deliberately overwrites the remote file after a successful sync; the `setup` control changes only the tracked local file and succeeds. This separates refusal behavior from the unknown cause of the reported setup mismatch.
