# Issue 33 probe (throwaway)

Throwaway evidence for `../../issue-33.md`; delete freely. Not product code, not a test.

`fixture/` is the final state of the probe repo; every file has a `.txt` suffix so this
repository's Vitest and tooling never pick it up, and `dist/` is `dist-ignored-in-probe/`
(this repository ignores `dist/`). Strip the suffixes and rename back to rebuild it in a
fresh `/tmp` git repo, symlink a `node_modules` holding Vitest 4.1.x, then:

    export HOME=<tmp>/home XDG_RUNTIME_DIR=<tmp>/home/.run   # copy only the squeal@hearsay entry
                                                            # of installed_plugins.json there
    squeal init && squeal start && squeal run --all --wait
    ./probe.sh A dist/lib.d.ts; ./runlog.sh 2

`probe.sh` and `runlog.sh` hard-code `/tmp/issue33.suGY`. Probes A to E and their results are
in the findings file. Never point `HOME` at the real one.
