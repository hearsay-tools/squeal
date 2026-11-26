import type { TestFileRef } from "../../types/keys.js";
import type { ContainerTarget } from "../../types/policy-containers.js";
import type {
  InvalidatedPath,
  InvalidateResult,
  RunnerAdapter,
  RunnerEnvironment,
  RunOptions,
  RunReport,
} from "../../types/runner.js";
import type { RunnerTraits } from "../../types/runner-traits.js";
import type { HostChannel } from "../channel.js";
import type { HostAdapterOptions, HostPolicy, HostRunner } from "../protocol.js";
import { type HostDeadlines, runnerHostGone, startHostProxy } from "../proxy.js";
import { type ContainerConsent, resolveContainerNetwork } from "./consent.js";
import { type DockerCli, dockerCli } from "./docker.js";
import {
  applyContainerEnvironment,
  type ContainerKeyDescriptor,
  containerCore,
  containerKeyDescriptor,
  hashInputs,
  inspectServices,
  probeContainer,
} from "./key.js";
import {
  type ContainerPaths,
  ensureContainer,
  type ManagedContainer,
  type ManagerOptions,
  openRunnerHostChannel,
  rootStatTap,
} from "./manager.js";
import { type ContainerRefusal, type ContainerState, checkImage, proveMount } from "./preflight.js";

/*
 * Spec 027 D5 to D7 (row 027-06): a consented container project's adapter.
 * It reads consent before any Docker command, starts or reuses the managed
 * container, starts `squeal runner-host` in it over `docker exec -i`, and
 * admits nothing before the host's `rootStat` proves the live bind mount.
 * Before each batch and each run it checks the image: a rebuilt one closes
 * the host, removes the container, starts a new one and re-keys. A refusal
 * leaves the project's files unknown with one note and runs nothing on the
 * host. Its environments are keyed in the container's space (`key.ts`).
 */

/** A container target's state, as `squeal status` shows it. */
export type ContainerTargetState = "ready" | "unconsented" | ContainerState;

export interface ContainerRunnerOptions {
  readonly runner: Extract<HostRunner, "node-test" | "pytest" | "jest">;
  readonly adapterVersion: string;
  readonly traits: RunnerTraits;
  readonly worktreeId: string;
  readonly project: string;
  readonly targetName: string;
  readonly target: ContainerTarget;
  /** This machine's consent, read before each start; `null`: none, and no Docker command runs. */
  readonly consent: () => ContainerConsent | null;
  readonly paths: ContainerPaths;
  /** Squeal's CLI script, inside `paths.squealBundleDir`. */
  readonly squealCliPath: string;
  /** This Squeal's version: the host's must equal it, and the container core carries it. */
  readonly version: string;
  /** The host adapter's options and policy, as a local host's. */
  readonly start: { readonly options: HostAdapterOptions; readonly policy: () => HostPolicy };
  readonly note: (text: string, topic?: string) => void;
  /** Told each state change, for `squeal status`. */
  readonly status?: (state: ContainerTargetState) => void;
  readonly manager?: ManagerOptions;
  readonly deadlines?: Partial<HostDeadlines>;
  /** The host's channel in the container; default `openRunnerHostChannel`. */
  readonly openChannel?: (container: ManagedContainer) => HostChannel;
}

interface Live {
  readonly proxy: RunnerAdapter;
  readonly container: ManagedContainer;
  readonly descriptor: ContainerKeyDescriptor;
  readonly core: ReturnType<typeof containerCore>;
}

type Opened = { readonly ok: true; readonly live: Live } | (ContainerRefusal | Unconsented);
interface Unconsented {
  readonly ok: false;
  readonly state: "unconsented";
  readonly note: string;
}

/** The managed target's name: one container per target, runner and project. */
export function managedName(targetName: string, runner: string, project: string): string {
  return `${targetName}.${runner}.${project}`;
}

/** The note topic of a container project's state. */
export function containerTopic(runner: string, project: string): string {
  return `container:${runner}:${project}`;
}

/** Opens a container adapter; a refusal is a state of it, never a rejection. */
export async function createContainerRunner(
  options: ContainerRunnerOptions,
): Promise<ContainerAdapter> {
  const adapter = new ContainerAdapter(options);
  await adapter.open();
  return adapter;
}

/** Whether `adapter`'s runner host can answer no more (`RecoveringRunnerOptions.gone`). */
export function containerHostGone(adapter: RunnerAdapter): boolean {
  return adapter instanceof ContainerAdapter && adapter.gone();
}

export class ContainerAdapter implements RunnerAdapter {
  readonly name: string;
  readonly adapterVersion: string;
  readonly traits: RunnerTraits;
  readonly #options: ContainerRunnerOptions;
  readonly #cli: DockerCli;
  #opened: Opened = { ok: false, state: "start-failed", note: "not started" };
  #noted = "";
  /** A rebuild replaced the container inside a run: the next batch re-keys. */
  #owed = false;

  constructor(options: ContainerRunnerOptions) {
    this.#options = options;
    this.#cli = options.manager?.cli ?? dockerCli();
    this.name = options.runner;
    this.adapterVersion = options.adapterVersion;
    this.traits = options.traits;
  }

  gone(): boolean {
    return this.#opened.ok && runnerHostGone(this.#opened.live.proxy);
  }

  async open(): Promise<void> {
    this.#opened = await this.#start();
    const o = this.#options;
    o.status?.(this.#opened.ok ? "ready" : this.#opened.state);
    const text = this.#opened.ok ? "" : `${this.#opened.note} (in container ${o.targetName})`;
    if (text !== this.#noted && (text !== "" || this.#noted !== "")) {
      o.note(
        text === "" ? `container ${o.targetName}: ready` : text,
        containerTopic(o.runner, o.project),
      );
    }
    this.#noted = text;
  }

  async #start(): Promise<Opened> {
    const o = this.#options;
    const consent = o.consent();
    if (consent === null) {
      return {
        ok: false,
        state: "unconsented",
        note: `container ${o.targetName}: not allowed on this machine`,
      };
    }
    const network = resolveContainerNetwork(o.target, consent);
    if ("problem" in network) {
      return {
        ok: false,
        state: "unconsented",
        note: `container ${o.targetName}: ${network.problem}`,
      };
    }
    const managed = {
      name: managedName(o.targetName, o.runner, o.project),
      image: o.target.image,
      ...network,
      ...(o.target.workdir === undefined ? {} : { workdir: o.target.workdir }),
      env: o.target.env,
    };
    const ensured = await ensureContainer(o.worktreeId, managed, o.paths, {
      ...o.manager,
      cli: this.#cli,
    });
    if (!ensured.ok) return ensured;
    const { container } = ensured;
    const fail = async (state: ContainerState, note: string): Promise<ContainerRefusal> => {
      await container.close().catch(() => {});
      return { ok: false, state, note: `container ${o.targetName}: ${note}` };
    };
    let descriptor: ContainerKeyDescriptor;
    let core: Live["core"];
    try {
      const image = await this.#cli.imageInspect(container.imageId);
      if (image === null) return await fail("image-missing", `image ${container.imageId} is gone`);
      const probe = await probeContainer(this.#cli, container.id);
      const services = await inspectServices(
        this.#cli,
        o.target.dependencyServices,
        consent.composeProject,
      );
      descriptor = containerKeyDescriptor({
        keyMode: o.target.keyMode,
        image,
        probe,
        dockerfileInputs: hashInputs(o.paths.worktreeRoot, o.target.dockerfileInputs),
        targetEnv: o.target.env,
        services,
      });
      core = containerCore(probe, o.version);
    } catch (error) {
      return await fail(
        "docker-unreachable",
        `could not read the container: ${(error as Error).message}`,
      );
    }
    const channel = (o.openChannel ?? this.#defaultChannel)(container);
    const tap = rootStatTap(channel);
    let proxy: RunnerAdapter;
    try {
      proxy = await startHostProxy({
        channel: tap.channel,
        runner: o.runner,
        version: o.version,
        options: o.start.options,
        policy: o.start.policy,
        note: o.note,
        ...(o.deadlines === undefined ? {} : { deadlines: o.deadlines }),
      });
    } catch (error) {
      return await fail(
        "start-failed",
        `its runner host did not start: ${(error as Error).message}`,
      );
    }
    const proof = proveMount(o.paths.worktreeRoot, tap.rootStat(), o.targetName);
    if (!proof.ok) {
      await proxy.close().catch(() => {});
      await container.close().catch(() => {});
      return proof;
    }
    return { ok: true, live: { proxy, container, descriptor, core } };
  }

  readonly #defaultChannel = (container: ManagedContainer): HostChannel =>
    openRunnerHostChannel(container, {
      squealCliPath: this.#options.squealCliPath,
      worktreeRoot: this.#options.paths.worktreeRoot,
      runner: this.#options.runner,
      cli: this.#cli,
    });

  /** D6.2: a rebuilt or removed image ends the host and the container; rebuilt starts again. */
  async #rebuilt(): Promise<boolean> {
    if (!this.#opened.ok) return false;
    const { live } = this.#opened;
    const check = await checkImage(
      this.#cli,
      this.#options.target.image,
      live.container.imageId,
    ).catch(() => null);
    if (check === null || ("changed" in check && !check.changed)) return false;
    // A removed image: the new start refuses it as missing.
    await this.#teardown(live);
    await this.open();
    return true;
  }

  async #teardown(live: Live): Promise<void> {
    await live.proxy.close().catch(() => {});
    await live.container.close().catch(() => {});
  }

  #recreated(): InvalidateResult {
    this.#owed = false;
    return { recreatedProjects: [this.#options.project] };
  }

  async invalidate(paths: readonly InvalidatedPath[]): Promise<InvalidateResult> {
    if (!this.#opened.ok) {
      // A refusal retries at each batch; a new state is a new environment.
      const before = this.#noted;
      await this.open();
      const changed = this.#opened.ok || this.#owed || this.#noted !== before;
      return changed ? this.#recreated() : { recreatedProjects: [] };
    }
    if (this.#owed || (await this.#rebuilt())) return this.#recreated();
    return this.#opened.ok ? this.#opened.live.proxy.invalidate(paths) : this.#recreated();
  }

  async recheck(): Promise<InvalidateResult> {
    if (!this.#opened.ok) return { recreatedProjects: [] };
    if (this.#owed || (await this.#rebuilt())) return this.#recreated();
    return this.#opened.ok
      ? ((await this.#opened.live.proxy.recheck?.()) ?? { recreatedProjects: [] })
      : this.#recreated();
  }

  affected(changed: Parameters<RunnerAdapter["affected"]>[0]) {
    return this.#opened.ok
      ? this.#opened.live.proxy.affected(changed)
      : Promise.resolve({ direct: [], transitive: [] });
  }

  closure(testFile: TestFileRef) {
    if (!this.#opened.ok) return Promise.reject(new Error(this.#opened.note));
    return this.#opened.live.proxy.closure(testFile);
  }

  enumerate(testFile: TestFileRef) {
    return this.#opened.ok ? this.#opened.live.proxy.enumerate(testFile) : Promise.resolve([]);
  }

  testFiles() {
    return this.#opened.ok ? this.#opened.live.proxy.testFiles() : Promise.resolve([]);
  }

  async environment(): Promise<readonly RunnerEnvironment[]> {
    const o = this.#options;
    if (!this.#opened.ok) {
      const unavailable = {
        container: o.targetName,
        state: this.#opened.state,
        unavailable: this.#opened.note,
      };
      return [
        {
          project: o.project,
          runnerName: o.runner,
          runnerVersion: "unavailable",
          adapterVersion: o.adapterVersion,
          resolvedConfig: JSON.stringify(unavailable),
          files: [],
        },
      ];
    }
    const { live } = this.#opened;
    return applyContainerEnvironment(await live.proxy.environment(), live.descriptor, live.core);
  }

  async run(testFiles: readonly TestFileRef[], options: RunOptions): Promise<RunReport> {
    const where = `in container ${this.#options.targetName}`;
    if (this.#opened.ok && (await this.#rebuilt())) {
      this.#owed = true;
      return unavailableReport(
        `${where}: its image was rebuilt; the container was replaced and the files are re-keyed before they run`,
      );
    }
    if (!this.#opened.ok) return unavailableReport(`${this.#opened.note} (${where})`);
    const report = await this.#opened.live.proxy.run(testFiles, options);
    return report.failure === null
      ? report
      : { ...report, failure: `${report.failure} (${where})` };
  }

  async close(): Promise<void> {
    if (this.#opened.ok) await this.#teardown(this.#opened.live);
  }
}

/** A run that ran nothing: its files stay unknown with `failure`. */
export function unavailableReport(failure: string): RunReport {
  return {
    end: "crashed",
    durationMs: 0,
    completedFiles: [],
    results: [],
    fileErrors: [],
    failure,
  };
}
