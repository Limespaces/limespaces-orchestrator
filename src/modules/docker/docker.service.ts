import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleInit,
} from '@nestjs/common';
import { Job, Queue, QueueEvents } from 'bullmq';
import Dockerode, { Network } from 'dockerode';
import { readdir } from 'fs/promises';
import { WorkspaceContainerState } from '../prisma/generated/enums';
import path from 'path';
import { OrchestratorConfig } from 'src/config';

interface IDockerContainerCreateConfig {
  imageTag: `${string}:${string}`;
  name: string;
  networkName: string;
  type: 'platform' | 'workspace';
  portBindings?: IDockerPortBinding[];
  pathBindings?: IDockerPathBinding[];
}

interface IDockerPortBinding {
  host: number;
  container: number;
  protocol: 'tcp' | 'udp';
}

interface IDockerPathBinding {
  host: string;
  container: string;
  readonly?: boolean;
}

@Injectable()
export class DockerService implements OnApplicationBootstrap {
  private dockerQueueEvents: QueueEvents;

  //////////////////////////////////////////////////////////////////

  // Path/address of hosts docker engine socket
  private static readonly DOCKER_SOCKET =
    process.env.DOCKER_SOCKET_PATH ?? '/var/run/docker.sock';
  // Address of our container registry
  private static PLATFORM_REGISTRY = process.env.WORKSPACE_REGISTRY ?? '';
  // Images that are needed and should be pulled
  private static REQUIRED_IMAGES: `${string}:${string}`[] = [
    // platform
    'traefik:v3',

    // workspace
    `${DockerService.PLATFORM_REGISTRY}/limespaces/fedora42-gnome:latest`,
  ];

  // Hosts docker engine
  private readonly engine: Dockerode = new Dockerode({
    socketPath: DockerService.DOCKER_SOCKET,
  });

  private readonly logger = new Logger(DockerService.name);

  constructor(
    @InjectQueue('docker')
    private readonly dockerQueue: Queue,
  ) {
    this.dockerQueueEvents = new QueueEvents('docker', {
      connection: this.dockerQueue.opts.connection,
    });
  }

  // setup docker environment on application bootstrap
  async onApplicationBootstrap() {
    // Pull required images
    await this._pullRequiredImages();

    // Forcefully recreate platform containers
    await this._destroyPlatformContainers();
    await this._createPlatformContainers();
  }

  // --- bootstrap logic ---

  /**
   * Creates and starts all platform containers
   */
  private async _createPlatformContainers() {
    this.logger.log('Creating platform containers...');

    // Create traefik platform container
    await this.createContainer({
      imageTag: 'traefik:v3',
      name: this.localToFullName('platform', 'traefik'),
      networkName: 'limespaces-net', // Main network (from compose)
      type: 'platform',
      pathBindings: [
        // traefik config
        {
          host: path.join(
            OrchestratorConfig.paths.hostAppDir,
            'repos/images/platform/workspace-host-traefik/traefik.yaml',
          ),
          container: '/etc/traefik/traefik.yml',
        },
        // hosts docker socket
        {
          host: DockerService.DOCKER_SOCKET,
          container: '/var/run/docker.sock',
        },
      ],
    });
    await this.startContainer(this.localToFullName('platform', 'traefik'));
  }

  /**
   * Forcefully destroys all platform containers
   */
  private async _destroyPlatformContainers() {
    this.logger.log('Destroying platform containers...');

    // All platform containers
    const containerNames = ['traefik'];

    for (const containerName of containerNames) {
      const fullName = this.localToFullName('platform', containerName);

      const exists = await this.containerExists(fullName);
      if (!exists) continue;

      await this.killContainer(fullName);
      await this.removeContainer(fullName);
    }
  }

  /**
   * Pulls all required images from our static list
   */
  private async _pullRequiredImages() {
    this.logger.log('Pulling required images...');

    for (const tag of DockerService.REQUIRED_IMAGES) {
      await this.pullImage(tag);
    }
  }

  /**
   * Remaps local name to full name for better separation on hosts docker
   * @param type type of the resource (platform / workspace)
   * @param name name of the resource (eg. traefik or workspace id)
   * @returns limespaces-platform-name for platform and limespaces-workspace-name for workspace
   */
  localToFullName(type: 'platform' | 'workspace', name: string) {
    return `limespaces-${type}-${name}`;
  }

  // --- docker logic ---
  /**
   * Pulls the given tag using the hosts docker
   * @param image docker tag, can container registry url
   */
  async pullImage(image: `${string}:${string}`) {
    this.logger.log(`Pulling image "${image}"`);

    // Initiate pull
    const pullStream = await this.engine.pull(image);

    // Await completion using dockerodes followProgress
    await new Promise((resolve, reject) => {
      this.engine.modem.followProgress(pullStream, (err, res) => {
        if (err) return reject(err);
        resolve(res);
      });
    });
  }

  /**
   * Creates a network
   * @param name name of the network
   * @param subnet optional IPAM subnet (e.g. 10.240.0.0/29)
   * @param gateway optional IPAM gateway (e.g. 10.240.0.1)
   * @returns dockerode network
   */
  async createNetwork(name: string, subnet?: string, gateway?: string) {
    // Check if network already exists
    try {
      const network = this.engine.getNetwork(name);
      await network.inspect();

      return network;
    } catch (_) {}

    const ipamConfig =
      subnet && gateway ? [{ Subnet: subnet, Gateway: gateway }] : undefined;

    const network = await this.engine.createNetwork({
      Driver: 'bridge',
      Name: name,
      IPAM: ipamConfig ? { Config: ipamConfig } : undefined,
    });

    return network;
  }

  /**
   * Removes a network if it exists
   * @param name name of the network
   */
  async removeNetwork(name: string) {
    this.logger.log(`Removing network "${name}"...`);
    try {
      const network = this.engine.getNetwork(name);
      await network.remove();
    } catch (_) {}
  }

  /**
   * Makes given container join the given network
   * @param containerIdOrName name of the container
   * @param networkIdOrName name of the network to join
   */
  async joinNetwork(containerIdOrName: string, networkIdOrName: string) {
    const network = this.engine.getNetwork(networkIdOrName);
    await network.connect({
      Container: containerIdOrName,
    });
  }

  /**
   * Makes given container leave the given network
   * @param containerIdOrName name of the container
   * @param networkIdOrName name of the network to leave
   */
  async leaveNetwork(containerIdOrName: string, networkIdOrName: string) {
    try {
      const network = this.engine.getNetwork(networkIdOrName);
      await network.disconnect({
        Container: containerIdOrName,
        Force: true,
      });
    } catch (_) {}
  }

  /**
   * Creates a docker container on the host
   * @param config container configuration
   * @returns dockerode container
   */
  async createContainer(config: IDockerContainerCreateConfig) {
    // Generate hostname
    const hostname = `${config.name.split('-').slice(2).join('-')}.${config.type}.limespaces.local`;

    this.logger.log(`Creating container "${config.name}`);

    // Create a dockerode container
    const container = await this.engine.createContainer({
      Image: config.imageTag,
      name: config.name,
      HostConfig: {
        NetworkMode: config.networkName,

        // Workspace specific config
        ...(config.type == 'workspace'
          ? {
              Runtime: 'sysbox-runc',
              ShmSize: 2000000000,
              PidsLimit: 100000,
            }
          : {}),

        PortBindings: this._generatePortBindings(config.portBindings ?? []),
        Mounts:
          config.pathBindings?.map((b) => ({
            Type: 'bind',
            Source: b.host,
            Target: b.container,
            ReadOnly: b.readonly ?? false,
          })) ?? [],
        RestartPolicy: {
          Name: 'no',
        },
      },
      Env:
        config.type == 'workspace'
          ? [`TZ=Europe/Prague`, `HOSTNAME=${hostname}`]
          : [],
      Hostname: hostname,
      Labels: {
        ...(config.type == 'workspace'
          ? {
              [`traefik.http.routers.${config.name}-vnc.rule`]: `Host(\`vnc.${hostname}\`)`,
              [`traefik.http.routers.${config.name}-vnc.service`]: `${config.name}-vnc`,
              [`traefik.http.services.${config.name}-vnc.loadbalancer.server.port`]:
                '6901',
              [`traefik.http.routers.${config.name}-supervisor.rule`]: `Host(\`supervisor.${hostname}\`)`,
              [`traefik.http.routers.${config.name}-supervisor.service`]: `${config.name}-supervisor`,
              [`traefik.http.services.${config.name}-supervisor.loadbalancer.server.port`]:
                '5000',
            }
          : {}),
        'limespaces.managedby': 'limespaces',
        'limespaces.type': config.type,
      },
    });

    return container;
  }

  /**
   * Kills given container
   * @param idOrName full container name
   */
  async killContainer(idOrName: string) {
    this.logger.log(`Killing container "${idOrName}"...`);

    const container = this.engine.getContainer(idOrName);
    const inspectionResult = await container.inspect();

    if (!inspectionResult.State.Running) return;

    await container.kill();
  }

  /**
   * Removes the given container
   * @param idOrName full container name
   */
  async removeContainer(idOrName: string) {
    this.logger.log(`Removing container "${idOrName}"...`);

    const container = this.engine.getContainer(idOrName);
    await container.remove({
      force: true,
    });
  }

  /**
   * Checks if the given container exists
   * @param idOrName full container name
   * @returns true if exists, false otherwise
   */
  async containerExists(idOrName: string) {
    try {
      const container = this.engine.getContainer(idOrName);
      await container.inspect();

      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Starts the given container
   * @param idOrName full container name
   */
  async startContainer(idOrName: string) {
    this.logger.log(`Starting container "${idOrName}"...`);

    const container = this.engine.getContainer(idOrName);
    await container.start();
  }

  /**
   * Stops the given container
   * @param idOrName full container name
   */
  async stopContainer(idOrName: string) {
    this.logger.log(`Stopping container "${idOrName}"...`);

    const container = this.engine.getContainer(idOrName);
    await container.stop();
  }

  /**
   * Converts our definition of port bindings to docker format
   * @param bindings our definition
   * @returns docker definition
   */
  private _generatePortBindings(bindings: IDockerPortBinding[]) {
    return Object.fromEntries(
      bindings.map((binding) => [
        `${binding.container}/${binding.protocol}`,
        [
          {
            HostPort: binding.host.toString(),
          },
        ],
      ]),
    );
  }

  // --- High level ---

  /**
   * Finds a free /29 subnet in the 10.240.0.0/16 range
   */
  async findFreeSubnet(): Promise<{ subnet: string; gateway: string }> {
    const networks = await this.engine.listNetworks();
    const usedSubnets = new Set<string>();

    for (const net of networks) {
      if (net.IPAM && net.IPAM.Config)
        for (const config of net.IPAM.Config) {
          if (config.Subnet) usedSubnets.add(config.Subnet);
        }
    }

    // @author Gemini 3.5 Flash inside Google Antigravity IDE
    for (let i = 0; i < 8192; i++) {
      const offset = 8 * i;
      const b2 = Math.floor(offset / 256) % 256;
      const b3 = offset % 256;

      const subnet = `10.240.${b2}.${b3}/29`;

      if (!usedSubnets.has(subnet)) {
        const gateway = `10.240.${b2}.${b3 + 1}`;
        return { subnet, gateway };
      }
    }

    // TODO: Notify system administrator -- critical
    throw new Error('No free subnets available in 10.240.0.0/16 range');
  }

  /**
   * Creates a workspace container
   * @param workspaceId id of the workspace (will be used for name)
   * @param imageTag image name and tag
   * @returns dockerode container
   */
  async createWorkspaceContainer(
    workspaceId: string,
    imageTag: `${string}:${string}`,
  ) {
    const fullName = this.localToFullName('workspace', workspaceId);
    const networkName = `${fullName}-net`;

    // Find a unique /29 subnet and create the network
    const { subnet, gateway } = await this.findFreeSubnet();
    await this.createNetwork(networkName, subnet, gateway);

    const container = await this.createContainer({
      name: fullName,
      networkName: networkName,
      imageTag: `${DockerService.PLATFORM_REGISTRY}/limespaces/${imageTag}`,
      type: 'workspace',
      pathBindings: [
        // TODO: CRITICAL: Remove this, when not in-dev
        // Critical security flaw, we should package this into Dockerfile
        // when building for production
        {
          host: path.join(
            OrchestratorConfig.paths.hostAppDir,
            'repos/supervisor/bin/limespaces-supervisor',
          ),
          container: '/usr/share/bin/limespaces-supervisor',
          readonly: true,
        },
      ],
    });

    // Make traefik join the network
    await this.joinNetwork(
      this.localToFullName('platform', 'traefik'),
      networkName,
    );

    return container;
  }

  /**
   * Returns all containers that are managed by limespaces and are workspaces
   */
  async findAllWorkspaceContainers() {
    const containers = await this.engine.listContainers({
      filters: {
        label: ['limespaces.managedby=limespaces', 'limespaces.type=workspace'],
      },
      all: true,
    });

    return await Promise.all(
      containers.map(async (container) => {
        const containerObject = this.engine.getContainer(container.Id);
        const inspectionResult = await containerObject.inspect();

        return {
          id: container.Id,
          name: container.Names[0].split('/')[1],
          state: inspectionResult.State,
        };
      }),
    );
  }

  /**
   * Ensures that traefik is joined on the workspace containers network
   * @param workspaceId
   */
  async ensureTraefikOnWorkspaceNetwork(workspaceId: string) {
    const fullContainerName = this.localToFullName('workspace', workspaceId);
    const networkName = `${fullContainerName}-net`;
    const fullTraefikName = this.localToFullName('platform', 'traefik');

    // TODO: Check if its already joined instead of just trying to force it anyways
    try {
      await this.joinNetwork(fullTraefikName, networkName);
    } catch {}
  }

  /**
   * Returns actual container state
   * @param idOrName full container name
   * @returns actual container state
   */
  async getContainerState(idOrName: string): Promise<string | null> {
    try {
      const container = this.engine.getContainer(idOrName);
      const inspectionResult = await container.inspect();
      const dockerStatus = inspectionResult.State.Status;

      return dockerStatus;
    } catch (err: any) {
      return null;
    }
  }
}
