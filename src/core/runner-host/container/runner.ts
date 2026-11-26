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
import { tagReportCore } from "../remote/remote-key.js";
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
 * Before each batch and each run it reads consent and the declared target
 * again before any Docker command (review 0.1.644 B5): withdrawn consent
 * ends the host and the container and runs nothing more; a changed target
 * or a rebuilt image closes the host, removes the container, starts a new
 * one and re-keys. A refusal
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
  /** The declared target, or how to read it live; `undefined`: no longer declared. */
  readonly target: ContainerTarget | (() => ContainerTarget | undefined);
  /** This machine's consent, read before each start and batch; `null`: none, and no Docker command runs. */
  readonly consent: () => ContainerConsent | null;
  /** Why the target is not allowed here, for its note; default a short text. */
  readonly unconsentedNote?: () => string;
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
  /** The effective launch configuration it started with (`launchFingerprint`). */
  readonly fingerprint: string;
}

/** Consent, the live target and its resolved network: what one start may use. */
interface Admitted {
  readonly consent: ContainerConsent;
  readonly target: ContainerTarget;
  readonly network: { readonly network?: string };
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

/**
 * The run remote a container's run keeps (spec 027 D7.3), which `squeal
 * status` and `squeal why` read as `in container <target>` (`ranWhereText`).
 */
export function containerRemote(targetName: string): string {
  return `container ${targetName}`;
}

/** The note topic of a container project's state. */
export function containerTopic(runner: string, project: string): string {
  return `container:${runner}:${project}`;
}

/**
 * Review 0.1.644 B5: the target's declared configuration and the consent's
 * network and Compose project, which a live container must have started with.
 */
function launchFingerprint({ consent, target, network }: Admitted): string {
  return JSON.stringify({
    target,
    network: network.network ?? null,
    composeProject: consent.composeProject ?? null,
  });
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
    this.#settle(await this.#start());
  }

  /** Takes `opened` as the state, and tells its status and note when it changed. */
  #settle(opened: Opened): void {
    this.#opened = opened;
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

  /** The live target. */
  #target(): ContainerTarget | undefined {
    const { target } = this.#options;
    return typeof target === "function" ? target() : target;
  }

  /** Consent and the live target, read with no Docker command; refused, why. */
  #admit(): Admitted | Unconsented {
    const o = this.#options;
    const refused = (note: string): Unconsented => ({ ok: false, state: "unconsented", note });
    const consent = o.consent();
    if (consent === null) {
      return refused(
        o.unconsentedNote?.() ?? `container ${o.targetName}: not allowed on this machine`,
      );
    }
    const target = this.#target();
    if (target === undefined) {
      return refused(`container ${o.targetName}: no longer declared in squeal.config.json`);
    }
    const network = resolveContainerNetwork(target, consent);
    if ("problem" in network) return refused(`container ${o.targetName}: ${network.problem}`);
    return { consent, target, network };
  }

  async #start(): Promise<Opened> {
    const o = this.#options;
    const admitted = this.#admit();
    if ("ok" in admitted) return admitted;
    const { consent, target, network } = admitted;
    const managed = {
      name: managedName(o.targetName, o.runner, o.project),
      image: target.image,
      ...network,
      ...(target.workdir === undefined ? {} : { workdir: target.workdir }),
      env: target.env,
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
        target.dependencyServices,
        consent.composeProject,
      );
      descriptor = containerKeyDescriptor({
        keyMode: target.keyMode,
        image,
        probe,
        dockerfileInputs: hashInputs(o.paths.worktreeRoot, target.dockerfileInputs),
        targetEnv: target.env,
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
    const fingerprint = launchFingerprint(admitted);
    return { ok: true, live: { proxy, container, descriptor, core, fingerprint } };
  }

  readonly #defaultChannel = (container: ManagedContainer): HostChannel =>
    openRunnerHostChannel(container, {
      squealCliPath: this.#options.squealCliPath,
      worktreeRoot: this.#options.paths.worktreeRoot,
      runner: this.#options.runner,
      cli: this.#cli,
    });

  /**
   * Review 0.1.644 B5 and D6.2, before each batch and run: consent and the
   * live target are read before any Docker command. Withdrawn, the host and
   * the container end and nothing more runs; a refusal retries the start; a
   * changed launch configuration or a rebuilt or removed image replaces the
   * container. Why the environment changed, or `null` when it did not.
   */
  async #reconcile(): Promise<string | null> {
    const admitted = this.#admit();
    const before = this.#noted;
    if ("ok" in admitted) {
      const was = this.#opened;
      if (was.ok) await this.#teardown(was.live);
      this.#settle(admitted);
      return was.ok || this.#noted !== before ? "it is no longer allowed" : null;
    }
    if (!this.#opened.ok) {
      // A refusal retries at each batch; a new state is a new environment.
      await this.open();
      return this.#opened.ok || this.#noted !== before ? "its container started" : null;
    }
    const { live } = this.#opened;
    if (launchFingerprint(admitted) !== live.fingerprint) {
      await this.#teardown(live);
      await this.open();
      return "its configuration changed and the container was replaced";
    }
    const check = await checkImage(this.#cli, admitted.target.image, live.container.imageId).catch(
      () => null,
    );
    if (check === null || ("changed" in check && !check.changed)) return null;
    // A removed image: the new start refuses it as missing.
    await this.#teardown(live);
    await this.open();
    return "its image was rebuilt and the container was replaced";
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
    if ((await this.#reconcile()) !== null || this.#owed) return this.#recreated();
    return this.#opened.ok ? this.#opened.live.proxy.invalidate(paths) : { recreatedProjects: [] };
  }

  async recheck(): Promise<InvalidateResult> {
    if ((await this.#reconcile()) !== null || this.#owed) return this.#recreated();
    return this.#opened.ok
      ? ((await this.#opened.live.proxy.recheck?.()) ?? { recreatedProjects: [] })
      : { recreatedProjects: [] };
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
    const changed = await this.#reconcile();
    if (!this.#opened.ok) return unavailableReport(`${this.#opened.note} (${where})`);
    if (changed !== null) {
      this.#owed = true;
      return unavailableReport(`${where}: ${changed}; the files are re-keyed before they run`);
    }
    const { live } = this.#opened;
    // Review 0.1.644 B2: the run happened on the container's machine, which the scheduler stores it for.
    const { fileRemotes: _, ...report } = tagReportCore(
      await live.proxy.run(testFiles, options),
      live.core,
    );
    // Review 0.1.644 N2 (D7.3): each failure it stores names the container, as a remote's does;
    // its checks, errors and so their fingerprints stay the host's own.
    const remote = containerRemote(this.#options.targetName);
    return report.failure === null
      ? { ...report, remote }
      : { ...report, remote, failure: `${report.failure} (${where})` };
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
