# Issue 137 throwaway probes

These scripts are research fixtures, not product code or repository tests.
They are not maintained. No product, suite, policy or hold is changed.
`node_modules` stays outside Git. Run from the Squeal checkout root:

```sh
node research/probes/issue-137/probe.mjs > research/probes/issue-137/result.jsonl 2>&1
node research/probes/issue-137/normalization.mjs > research/probes/issue-137/normalization.jsonl
```

The first script checks one-minute load against CPU count and skips live work
above that count. It uses the committed CLI bundle, without a build. It creates
a temporary Git repository, private store and runtime directory, and links only
the installed Vitest package. It invokes no package manager and writes nothing
to that package. Two fast TypeScript tests import one TypeScript module; one
slow test reads a declared Markdown input. All files run at width one.
External release files hold the fast tests without CPU work or project edits.
The script changes the Markdown file alone, then alongside comment-only,
whitespace-only and behavior edits of the imported module. It reads keys from
only the fixture's SQLite store and records starts and ends outside that root.

Exit 0 means the key and ordering assertions pass. The final fixture status
must exit 1: the behavior control deliberately makes both fast tests fail.
The script asserts two known failures, zero pending checks and one current slow
file. Squeal retries the two new failures once. Its automatic initial baseline
covers just these three files; no repository suite or explicit full-suite
request runs. Cleanup stops only this daemon and removes the fixture/runtime.
The script's console output retains exact child commands and status evidence.

`result.jsonl` is the final successful run, 2026-11-02 16:51:47Z–16:51:57Z.
An earlier successful run before the explicit final-failure assertions took
16:50:22Z–16:50:32Z (not retained separately). `initial-attempt.txt` preserves
an earlier probe mistake: status reported `activity: null` while slow work was
pending, so reading `.activity.for` threw. Cleanup passed. The final probe
asserts stored pending keys and actual run order instead of that optional field.

`normalization.mjs` uses esbuild 0.28.2 and Node's VM in one process. It proves
literal/line-break changes affect values and a PURE comment changes tree shaking.
It is not a second daemon test and does not claim Vitest uses that tree shaking.
`source-evidence.txt` preserves relevant source excerpts and the empty diff of
three relevant files between incident tag 0.1.392 and examined HEAD.
`issue.json` is the fetched issue. Prior broad measurements and `toString` /
source-read fixtures remain in spec 011's `research/probes/type-only-edits/`;
they were read, not repeated.
