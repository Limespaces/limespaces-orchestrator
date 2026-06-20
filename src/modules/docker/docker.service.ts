import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Job, Queue, QueueEvents } from 'bullmq';
import Dockerode from 'dockerode';
import { readdir } from 'fs/promises';
import { WorkspaceContainerState } from '../prisma/generated/enums';
import path from 'path';

@Injectable()
export class DockerService implements OnApplicationBootstrap {
  private static readonly WORKSPACE_IMAGE_DIR = '/app/repos/images/workspaces';
  private static readonly PLATFORM_IMAGE_DIR = '/app/repos/images/platform';
  private static readonly REGISTRY =
    process.env.WORKSPACE_REGISTRY ?? 'limespaces-registry:5000';
  private static readonly DOCKER_SOCKET =
    process.env.DOCKER_SOCKET_PATH ?? '/var/run/docker.sock';

  private dockerQueueEvents: QueueEvents;
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

  async onApplicationBootstrap() {
    this.logger.log('Creating traefik container...');
    await this.createTraefikContainer();

    this.logger.log('Pulling workspace images...');

    const images = await readdir(DockerService.WORKSPACE_IMAGE_DIR);

    const jobs: Job[] = [];
    for (const image of images) {
      const job = await this.dockerQueue.add(
        'pullWorkspaceImage',
        `${DockerService.REGISTRY}/limespaces/${image}:latest`,
      );

      jobs.push(job);
    }

    const results = await Promise.all(
      jobs.map(async (job) => {
        try {
          await job.waitUntilFinished(this.dockerQueueEvents);
        } catch (_) {
          return true;
        }

        return await job.isFailed();
      }),
    );

    if (results.some((r) => r == true))
      throw new Error('One or more pull jobs failed.');

    this.logger.log('All workspace images pulled.');
  }

  async $pullWorkspaceImage(imageName: string) {
    const stream = await this.engine.pull(imageName);

    await new Promise((resolve, reject) => {
      this.engine.modem.followProgress(
        stream,
        (err, res) => {
          if (err) return reject(err);
          resolve(res);
        },
        (progress) => {
          this.logger.log(
            `Pulling ${imageName}: ${progress.status} ${progress.progress || ''}`,
          );
        },
      );
    });
  }

  private async createTraefikContainer() {
    const pullStream = await this.engine.pull('traefik:v3');

    await new Promise((resolve, reject) => {
      this.engine.modem.followProgress(pullStream, (err, res) => {
        if (err) return reject(err);
        resolve(res);
      });
    });

    const listedContainer = await this.engine.listContainers({
      limit: 1,
      filters: {
        name: ['traefik'],
      },
    });

    if (listedContainer?.[0]) {
      this.logger.log('Deleting existing traefik container...');

      const container = this.engine.getContainer(listedContainer[0].Id);

      if ((await container.inspect()).State.Running) await container.kill();
      await container.remove();
    }

    const container = await this.engine.createContainer({
      Image: 'traefik:v3',
      name: 'traefik',
      HostConfig: {
        // PATHS INSIDE THE workspace-host CONTAINER, NOT THIS ONE
        Mounts: [
          {
            Source: path.join(
              DockerService.PLATFORM_IMAGE_DIR,
              'workspace-host-traefik',
              'traefik.yaml',
            ),
            Target: '/etc/traefik/traefik.yml',
            Type: 'bind',
          },
          {
            Source: '/limespaces/docker.sock',
            Target: '/var/run/docker.sock',
            Type: 'bind',
          },
        ],
        PortBindings: {
          '80/tcp': [
            {
              HostPort: '8000',
            },
          ],
        },
      },
    });

    await container.start();
  }

  async createWorkspaceContainer(workspaceId: string, image: string) {
    const container = await this.engine.createContainer({
      Image: `${DockerService.REGISTRY}/limespaces/${image}:latest`,
      name: `workspace-${workspaceId}`,
      HostConfig: {
        Runtime: 'sysbox-runc',
        SecurityOpt: ['seccomp=unconfined'],
        ShmSize: 2000000000,
        PidsLimit: 100000,
        RestartPolicy: {
          Name: 'no',
        },
      },
      Env: [
        `TZ=Europe/Prague`,
        `HOSTNAME=${workspaceId}.workspace.limespaces.local`,
      ],
      Hostname: `${workspaceId}.workspace.limespaces.local`,
      Labels: {
        [`traefik.http.routers.workspace-${workspaceId}-novnc.rule`]: `Host(\`${workspaceId}.workspace.limespaces.local\`)`,
        [`traefik.http.services.workspace-${workspaceId}-novnc.loadbalancer.server.port`]:
          '6901',
      },
    });

    return container.id;
  }

  async startContainer(dockerContainerId: string) {
    const container = this.engine.getContainer(dockerContainerId);

    await container.start();

    return this.dockerStatusIntoWorkspaceContainerState(
      (await container.inspect()).State.Status,
    );
  }

  async stopContainer(dockerContainerId: string) {
    const container = this.engine.getContainer(dockerContainerId);

    await container.stop();

    return this.dockerStatusIntoWorkspaceContainerState(
      (await container.inspect()).State.Status,
    );
  }

  private dockerStatusIntoWorkspaceContainerState(dockerStatus: string) {
    return {
      created: WorkspaceContainerState.Stopped,
      running: WorkspaceContainerState.Running,
      paused: WorkspaceContainerState.Stopped,
      restarting: WorkspaceContainerState.Starting,
      exited: WorkspaceContainerState.Stopped,
      removing: WorkspaceContainerState.Deleting,
      dead: WorkspaceContainerState.Deleting,
    }[dockerStatus]!;
  }
}
