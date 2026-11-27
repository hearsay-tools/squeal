# Issue 298 read-only probe

Throwaway research probe. Run from the repository root with:

```sh
python3 docs/specifications/011-core/research/probes/issue-298/read.py
```

Reads existing results using the installed Codex launcher. Does not start tests,
alter configuration, or open the private store. JSON output contains selected
fields only; home-directory prefixes are replaced with `~`. The saved output is
a snapshot, not an assertion about future store contents.
