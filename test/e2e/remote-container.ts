import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/*
 * Spec 021 Testing, Part 3 (rows 021-13, 021-14): a throwaway container
 * with `sshd`, reached as a remote. Its Node is this process's own install,
 * mounted read-only, so the environments are equal unless a case says
 * otherwise; the repository's `node_modules` is mounted read-only and linked
 * above the remote cache, so a tree there resolves Vitest without a download. The key,
 * `known_hosts`, the ssh config and the `HOME` ssh runs with live under a
 * temporary directory: no test reads or writes the real `~/.ssh`.
 */

const repoRoot = resolve(import.meta.dirname, "../..");
const IMAGE = "squeal-e2e-sshd:021";
/** Where the remote keeps Squeal's cache: below `/work/node_modules`, so its trees resolve Vitest. */
export const REMOTE_CACHE = "/work/.cache";

const DOCKERFILE = `FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssh-server libatomic1 \\
 && rm -rf /var/lib/apt/lists/* && mkdir -p /run/sshd /root/.ssh /work \\
 && chmod 700 /root/.ssh \\
 && sed -i 's/^#\\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config \\
 && ln -s /opt/node/bin/node /usr/local/bin/node && ln -s /opt/node/bin/npm /usr/local/bin/npm
EXPOSE 22
CMD ["/usr/sbin/sshd", "-D", "-e"]
`;

/** Whether this machine can run the container: Linux and a Docker daemon that answers. */
export function dockerUnavailable(): string | undefined {
  if (process.platform !== "linux") return "not Linux";
  const info = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    encoding: "utf8",
    timeout: 20_000,
  });
  return info.status === 0 ? undefined : `docker does not answer: ${info.stderr || info.error}`;
}

export interface Remote {
  /** The SSH destination, a `Host` of the temporary ssh config. */
  readonly destination: string;
  /** An `ssh` that reads only the temporary config. */
  readonly ssh: string;
  /** Runs `sh -c script` in the container; its stdout. */
  exec(script: string): string;
  pause(): void;
  unpause(): void;
  stop(): void;
}

/** Builds the image when missing, starts a container, and writes the ssh config that reaches it. */
export function startRemote(): Remote {
  const dir = mkdtempSync(join(tmpdir(), "squeal-e2e-sshd-"));
  const context = join(dir, "image");
  mkdirSync(context);
  writeFileSync(join(context, "Dockerfile"), DOCKERFILE);
  execFileSync("docker", ["build", "-q", "-t", IMAGE, context], {
    stdio: "ignore",
    timeout: 600_000,
  });
  const node = dirname(dirname(process.execPath));
  const name = `squeal-e2e-sshd-${process.pid}-${Date.now()}`;
  execFileSync("docker", [
    "run",
    "-d",
    "--rm",
    "--name",
    name,
    "-p",
    "127.0.0.1::22",
    "-v",
    `${node}:/opt/node:ro`,
    "-v",
    `${join(repoRoot, "node_modules")}:/opt/modules:ro`,
    IMAGE,
  ]);
  const exec = (script: string) =>
    execFileSync("docker", ["exec", name, "sh", "-c", script], { encoding: "utf8" });
  // Writable, its entries links into the read-only mount: Vite writes its bundled config in
  // the nearest `node_modules`, and nothing of the container's reaches the repository's.
  exec(
    'mkdir -p /work/node_modules && cd /opt/modules && for e in * .[!.]*; do case "$e" in .vite*|.cache) ;; *) ln -s "/opt/modules/$e" "/work/node_modules/$e" ;; esac; done',
  );
  const key = join(dir, "id");
  execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key]);
  execFileSync("docker", ["exec", "-i", name, "sh", "-c", "cat > /root/.ssh/authorized_keys"], {
    input: execFileSync("cat", [`${key}.pub`]),
  });
  const port = execFileSync("docker", ["port", name, "22/tcp"], { encoding: "utf8" })
    .split("\n")[0]
    ?.replace(/.*:/, "");
  const config = join(dir, "ssh_config");
  writeFileSync(
    config,
    [
      "Host squeal-e2e",
      "  HostName 127.0.0.1",
      `  Port ${port}`,
      "  User root",
      `  IdentityFile ${key}`,
      "  IdentitiesOnly yes",
      `  UserKnownHostsFile ${join(dir, "known_hosts")}`,
      "  StrictHostKeyChecking accept-new",
      "  ServerAliveInterval 0",
      "",
    ].join("\n"),
  );
  const home = join(dir, "home");
  mkdirSync(home);
  const ssh = join(dir, "ssh");
  writeFileSync(ssh, `#!/bin/sh\nHOME=${home} exec /usr/bin/ssh -F ${config} "$@"\n`);
  chmodSync(ssh, 0o755);
  waitForSshd(ssh);
  return {
    destination: "squeal-e2e",
    ssh,
    exec,
    pause: () => execFileSync("docker", ["pause", name]),
    unpause: () => execFileSync("docker", ["unpause", name]),
    stop: () => {
      spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** sshd takes a moment after the container starts. */
function waitForSshd(ssh: string): void {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const probe = spawnSync(ssh, ["-o", "BatchMode=yes", "squeal-e2e", "true"], {
      timeout: 10_000,
    });
    if (probe.status === 0) return;
    if (Date.now() > deadline) throw new Error(`sshd did not answer: ${probe.stderr}`);
    spawnSync("sleep", ["0.5"]);
  }
}
