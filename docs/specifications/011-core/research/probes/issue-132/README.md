# Issue 132 probes (throwaway)

Research fixtures only. Do not ship or add to the product test suite. No dependency installation is needed; use the repository's installed `tsx`. Never commit `node_modules`.

Source: Squeal 0.1.389, commit `6e573c80bbad0c295e35b7a50d912ff151ffa3d1`; Node v24.22.1, pnpm 12.15.0. Run from the repository root.

## Isolated probe

```sh
pnpm exec tsx docs/specifications/011-core/research/probes/issue-132/boundary.ts > docs/specifications/011-core/research/probes/issue-132/boundary-output.txt 2>&1
```

Actual exit 0. It seeds one inherited current/pass in a temporary store, leaves the revision table empty, injects three sync states, and calls the real named status command. It deletes its temporary directory in `finally`. No daemon or test runner starts. `settleMs: 0` tests the final-read boundary, not the production timer. Timing in the output is incidental.

## Live capture, before edits

```sh
uptime
getconf _NPROCESSORS_ONLN
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status test/cli/selection-result.test.ts --json > /tmp/squeal-issue132-live.json 2> /tmp/squeal-issue132-live.stderr
```

Initial output: `11:45:02 ... load average: 15.67, 15.66, 16.83`; CPU count `24`. Named status exited **3**; `waitedMs: 1292`. `live.json` retains these top-level fields from the original capture: `schemaVersion`, `revision`, `fullSuite`, `notes`, `daemon`, `inheritedCount`, `inheritedFileLevelCount`, `selection`. Global test inventory is omitted. `live.stderr.txt` preserves stderr verbatim. The original JSON was read without altering the store.

The following exact direct-sync command ran next. It prints only protocol replies, never environment values or credentials:

```sh
pnpm exec tsx --eval 'import {daemonSocket,askDaemon} from "./src/cli/daemon-access.ts"; (async()=>{const socket=await daemonSocket(process.cwd()); const first=await askDaemon(socket,{type:"sync"}); console.log(JSON.stringify({atMs:0,response:first})); if(first?.type!=="sync") return; const start=performance.now(); for(const ms of [250,1000,3000]) {await new Promise(r=>setTimeout(r,ms)); console.log(JSON.stringify({atMs:Math.round(performance.now()-start),response:await askDaemon(socket,{type:"sync-status",requestId:first.requestId})}));}})();' > /tmp/squeal-issue132-sync.jsonl
```

Exit 0. `live-sync.jsonl` preserves stdout. `atMs` starts after the first reply; later values are sampled elapsed times, not exact completion timestamps. This is a new sync request, not the named snapshot's request. It reached revision 0 by 1,253 ms. The trailing `uptime` gave `11:46:39 ... load average: 24.07, 17.53, 17.32`; further live reproduction stopped at that point under the load rule.

No live wait, daemon restart, build, full suite, or test rerun was requested. The isolated probe then ran without a live daemon. The probe's inherited row is synthetic; the live capture supplies the real inherited-state evidence.
