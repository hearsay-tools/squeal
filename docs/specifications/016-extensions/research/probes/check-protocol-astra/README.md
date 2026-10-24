# Check protocol probe, independent researcher

Throwaway evidence for research 016-07. This is not product code or a general TAP parser.

Run from the repository root:

```sh
node docs/specifications/016-extensions/research/probes/check-protocol-astra/probe.mjs
```

The script runs only `fixture.mjs` with Node's built-in TAP reporter. It starts no daemon, installs no package, and reads no Squeal store or socket. Its child ends before the script returns. The fixture has three leaf tests: pass, deliberate failure, and skip. Node v24.21.0 emits **TAP 13**, so this probe does not establish TAP 14 interoperability.

`output.tap` is the actual output with the absolute fixture directory removed. `run-report.json` is the conversion to the required `RunReport` fields at Squeal commit `ef41742aae3e5600e61e3d9ac556c6f5ab88a112`. Durations are copied producer fields, not performance measurements. `incomplete-report.json` records the same conversion after removing the final plan and summary. A separate assertion rejects a signalled exit even with the complete stream. `verification.txt` records the probe verdict.

The converter handles only this fixture's flat output. It uses a complete plan, Node's final summary, and a normal child exit to establish completion. Exit 1 from a reported test failure is not a runner crash. It maps the failure declaration location, not a source-mapped assertion frame. It retains the error code and stack. Error name `Error` is a fixture fallback when TAP supplies no name. Passing and skipped checks have no location in this output. Unknown duration fields fall back to zero in this throwaway script; that is not a proposed public contract.

Missing data, **verified by experiment on Node v24.21.0**: project identity and the selected file come from the launch context; TAP does not carry them here. There is no pre-run enumeration, input closure, environment fingerprint, revision, observation of runtime reads, focus count, or indication that bytes changed during the run. No file-level load failure, nested test, duplicate name, empty suite, retry, timeout or output injection was exercised. `fileErrors: []` means this known fixture had none. It is not evidence that an arbitrary TAP stream has no file error. A complete stream does not establish Squeal's C4 input stability barrier.

`source-manifest.json` records fetched primary sources, retrieval date, URLs, hashes, and unavailable URLs. `source-notes.md` preserves the small excerpts that decide the recommendation. The full fetched sources stayed in scratch storage. No other researcher's findings were read or fetched.
