# Wave 12: readable Squeal processes

Research row 005-86 is complete. Evidence: `../research/process-names.md`, seven cases on Node 22.19 and 24.21. No product row is dispatched until the human chooses the display scope.

## Proposed D3 amendment: short Linux process names

Give Squeal-owned Linux executable entries fixed short names: `squeal`, `squeal-daemon`, `squeal-hook`, `squeal-waiter`, `squeal-bridge` and `squeal-check`. Set only `/proc/self/comm`, best effort, at startup. Leave other platforms unchanged. Preserve argv, pinned CLI/runtime paths and existing hook declarations. Never rename embedded Pi/OpenCode hosts or test runners. Process discovery accepts only the relevant exact role names alongside legacy Node names, preserving its argument and identity checks.

This improves htop COMM/merged-name and btop process-name views. Full command views still show original arguments. Monitor behavior is source-verified; rendered UI remains to verify.

Implementation ownership: new `src/core/process-name.ts`; CLI executable entries; Claude/Codex executable hook dispatch; standalone OpenCode bridge entry; full-check inline child; `src/core/ps` name filters; focused tests. Bundles and versions belong to the coordinator. No launcher, PATH, trust declaration or runtime-selection changes.

Done when real child naming preserves argv and runtime paths on Node 22/24; daemon and waiter discovery accept named and legacy processes while rejecting unrelated ones; active older versions remain retained; non-Linux/missing proc is harmless; embedded hosts and test runners retain their names; affected checks, lint and typecheck pass, then coordinator build/e2e and candidate review pass.

## Alternative: short full command lines

If the human wants the full command text shortened, the above is insufficient. First extend the research to specify how discovery and active-version retention obtain reliable identity after process titles hide argv. Do not set process.title until those replacements and compatibility tests are specified. Keep version-pinned launches; bare PATH lookup may be absent or select another version.
