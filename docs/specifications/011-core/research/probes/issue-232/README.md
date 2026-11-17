# Issue 232 throwaway probes

Research only. `boundary.ts` starts no daemon or test runner. It creates and removes
six small stores. It seeds two or six passing files at revision 80, then calls the
real named wait with a pending sync, an unlisted revision 81, or a completed sync
and listing. Only sync, promotion, run requests and the clock boundary are injected.
The deadline is 80 ms, not the incident's 60 seconds. Text and JSON are rendered
from the same wait result; assertions check their return codes and reason fields.

Run from the repository root. The recorded run used the exact release source at
`squeal--v0.1.531` (`daf50f82e48e697545cfb7a378f4d46b03ce8a27`), with existing
workspace dependencies. The script checks one-minute load against online CPUs
and refuses the experiment above that limit. No `node_modules` is committed.

```sh
probe_source=$(mktemp -d)
git archive squeal--v0.1.531 src package.json | tar -x -C "$probe_source"
ln -s "$PWD/node_modules" "$probe_source/node_modules"
SQUEAL_RESEARCH_SOURCE="$probe_source" pnpm exec tsx docs/specifications/011-core/research/probes/issue-232/boundary.ts
```

The recorded extraction used Python `tempfile.mkdtemp`, `git archive`, and `tar`
with the same paths; it linked the existing `node_modules`. Exact probe invocation:

```sh
SQUEAL_RESEARCH_SOURCE="$(cat /tmp/squeal-issue232-source-path)" pnpm exec tsx docs/specifications/011-core/research/probes/issue-232/boundary.ts > docs/specifications/011-core/research/probes/issue-232/boundary-output.txt
```

`boundary-output.txt` is direct probe output. `live-summary.json` is an allow-listed
excerpt of the six-file installed-runtime call: local paths and unrelated global
inventory are excluded. It is not an agent transcript. The findings file records
both live commands, their exits and the evidence limits. Two setup attempts used
obsolete module import paths and failed before a case ran; the final run exited 0.
