# Probes for 016-02 (plugin mechanisms): throwaway

Throwaway fixtures for `../../plugin-mechanisms.md`. Not product code, not tests, no timings. Each `run.sh` installs what it needs in a scratch directory under `$TMPDIR` (or `/tmp`), never in this repository. Run on 2026-10-24 with Node 24.21.0 and Python 3.12.3.

| Probe | Shows |
| --- | --- |
| `p1-node-containment/` | What a Node host can contain when a plugin throws, never settles, blocks the event loop, or changes a shared built-in: in the host's own thread, in a worker thread, and in a child process. |
| `p2-pluggy/` | pluggy 1.7.0: a hook implementation with fewer arguments, an unknown argument, an undeclared hook, an exception, and `firstresult`. |
| `p3-eslint/` | ESLint 10.13.0: what a crashing plugin rule reports and what of a plugin enters the serialized config. |
| `p4-rollup/` | Rollup 4.65.0: what a throwing and a never-settling plugin hook report. |
| `p5-catalogue-counts/` | How many trunk v1.11.0 and MegaLinter v10.1.0 linter definitions need code, and which output format each uses. |

Limits: p1's `hang` case in a worker or a child exits by itself (code 13) because nothing else keeps that event loop alive. A plugin waiting on a real socket or timer would stay alive until the host's timeout. p4's `hang` case is detected for the same reason (Rollup's "Unexpected early exit").

## Output as run

### p1

```text
== in-process ok
[host] plugin returned ok
[host] after call, [1].includes(2) = false
[host] heartbeat timer fired
(exit 0)
== worker ok
[host] plugin returned ok
[host] worker exit code 1; host [1].includes(2) = false
(exit 0)
== child ok
[host] plugin returned ok
[host] child exit code=0 signal=null stderr-first-line=""
(exit 0)
== in-process throw
[host] caught: plugin bug
[host] after call, [1].includes(2) = false
[host] heartbeat timer fired
(exit 0)
== worker throw
[host] worker error event: plugin bug
[host] worker exit code 1; host [1].includes(2) = false
(exit 0)
== child throw
[host] child exit code=1 signal=null stderr-first-line="  if (mode === 'throw') throw new Error('plugin bug');"
(exit 0)
== in-process hang
[host] heartbeat timer fired
[host] caught: timeout after 500 ms
[host] after call, [1].includes(2) = false
(exit 0)
== worker hang
Warning: Detected unsettled top-level await at file://<repo>/docs/specifications/016-extensions/research/probes/plugin-mechanisms/p1-node-containment/worker.mjs:12
  parentPort.postMessage(String(await check(workerData)));
                                ^
[host] worker exit code 13; host [1].includes(2) = false
[host] timeout: terminating worker
(exit 0)
== child hang
[host] child exit code=13 signal=null stderr-first-line=""
(exit 0)
== in-process spin
(exit 124)
== worker spin
[host] timeout: terminating worker
[host] worker exit code 1; host [1].includes(2) = false
(exit 0)
== child spin
[host] timeout: SIGKILL child
[host] child exit code=null signal=SIGKILL stderr-first-line=""
(exit 0)
== in-process pollute
[host] plugin returned ok
[host] after call, [1].includes(2) = true
[host] heartbeat timer fired
(exit 0)
== worker pollute
[host] plugin returned ok
[host] worker exit code 0; host [1].includes(2) = false
(exit 0)
== child pollute
[host] plugin returned ok
[host] child exit code=0 signal=null stderr-first-line=""
(exit 0)
```

### p2

```text
pluggy 1.7.0
impl takes a subset of spec args: ['ok a.py']
impl names an arg not in the spec: PluginValidationError: Plugin 'bad' for hook 'check' | plugin_name in message: True
impl of an undeclared hook, then check_pending: PluginValidationError: unknown hook 'chek' in plugin <__main__.TypoPlugin object at 0x740cd9078d40> | plugin_name in message: False
one impl raises among two: RuntimeError: plugin bug | plugin_name in message: False
firstresult skips None: ['b.py']
```

### p3

```text
eslint 10.13.0
serialized plugins: ["@","x:eslint-plugin-x@1.0.0","y"]
lintText threw; message:
  rule bug
  Occurred while linting <tmp>/pm16-eslint/a.js:2
  Rule: "x/boom"
a file without boom still lints: [ 'no-unused-vars' ]
```

### p4

```text
mode throw
caught: {"message":"plugin bug","plugin":"thrower","hook":"transform","code":"PLUGIN_ERROR"}
(exit 0)
mode hang
caught: {"message":"Unexpected early exit. This happens when Promises returned by plugins cannot resolve. Unfinished hook action(s) on exit:\n(hanger) transform \"entry\""}
(exit 0)
```

### p5

```text
commands: 198 linters: 129
  68  generic: rewrite
  33  generic: sarif
  29  built-in named parser (vendor code)
  27  script parser (code)
  20  generic: pass_fail
  19  generic: regex
   2  generic: sarif_uri
{'needs code for a command': 45, 'all commands generic': 79, 'no commands': 5}
linters 135 with python class 59
{'regex_count': 20, 'regex_number': 19, '(default: exit status)': 82, 'regex_sum': 8, 'total_lines': 5, 'sarif': 1}
{'list_of_files': 64, 'project': 31, 'file': 40}
```
