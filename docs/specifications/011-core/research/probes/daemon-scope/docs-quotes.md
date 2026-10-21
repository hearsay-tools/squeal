# Quotes from official docs fetched with curl on 2026-10-21 (research 011-52)
## https://bazel.build/run/client-server
The client finds the server based on the output base , which by default is determined by the path of the base workspace directory and your userid, so if you build in multiple workspaces, you’ll have multiple output bases and thus multiple Bazel server processes.
Managing memory pressure across multiple workspaces Because each distinct workspace uses its own output base, working across multiple repositories starts a dedicated Bazel server for each workspace. Even when idle, each server process retains in-memory caches (such as the Skyframe dependency graph and package representations) to keep subsequent incremental builds fast. If your machine experiences memory pressure due to multiple idle servers, you can configure global protection in your user-level ~/.bazelrc : Shut down automatically on low RAM: Add startup --shutdown_on_low_sys_mem to instruct servers idle for more than 5 minutes to exit when host RAM becomes critically low (supported on Linux and macOS). Reduce idle timeout: Lower startup --max_idle_secs=1800 (e.g. 30 minutes instead of the 3-hour default) so unused servers terminate earlier. Explicit shutdown: Run bazel shutdown in workspaces you are done
The server process will stop after a period of inactivity (3 hours, by default, which can be modified using the startup option --max_idle_secs ).
## https://docs.gradle.org/current/userguide/gradle_daemon.html (9.8.2)
 As a result, your machine only loads Gradle into memory once for multiple builds instead of once per build.
Gradle starts a new Daemon if no idle or compatible Daemons exist.
Daemons automatically stop given any of the following conditions: Available system memory is low Daemon has been idle for 3 hours
 This can lead to multiple daemons being started, increasing memory usage unnecessarily.
## https://nx.dev/docs/concepts/nx-daemon
Each workspace starts its own daemon process, so multiple workspaces can use different Nx versions without sharing daemon state.
## https://turborepo.dev/docs/reference/run
turbo run dev --no-cache --daemon and --no-daemon Deprecated : The daemon is no longer used for turbo run . The daemon is still used by turbo watch and the Turborepo LSP.
## https://facebook.github.io/watchman/docs/cli-options and /docs/cmd/watch-project
Locating the service ​ -U, --sockname=PATH Specify alternate sockname The default location for sockname will be <STATEDIR>/<USER> .
The watchman executable will attempt to start the service if there is no response on the socket specified above.
With a proliferation of tools that wish to take advantage of filesystem watching at different locations in a filesystem tree, it is possible and likely for those tools to establish multiple overlapping watches. Most systems have a finite limit on the number of directories that can be watched effectively; when that limit is exceeded the performance and relia
## https://github.com/microsoft/TypeScript/wiki/Standalone-Server-(tsserver)
`tsserver` listens on `stdin` and writes messages back to `stdout`. 
There are three kinds of projects:
Configured projects are defined by a configuration file, which can be either `tsconfig.json` file or a `jsconfig.json` file. 
## https://rust-analyzer.github.io/book/configuration.html
If there are multiple linked projects/workspaces, this command is invoked for each of them, with the working directory being the workspace root (i.e.
linkedProjects Default: [] Disable project auto-discovery in favor of explicitly specified set of projects.
