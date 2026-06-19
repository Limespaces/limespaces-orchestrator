import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Job, Queue, QueueEvents } from 'bullmq';
import Dockerode from 'dockerode';
import { readdir } from 'fs/promises';

@Injectable()
export class DockerService implements OnApplicationBootstrap {
  private static readonly WORKSPACE_IMAGE_DIR = '/app/repos/images/workspaces';
  private static readonly REGISTRY =
    process.env.WORKSPACE_REGISTRY ?? 'limespaces-registry:5000';

  private dockerQueueEvents: QueueEvents;
  private readonly engine: Dockerode = new Dockerode({
    socketPath: process.env.DOCKER_SOCKET_PATH ?? '/var/run/docker.sock',
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

  async createWorkspaceContainer(workspaceId: string, image: string) {
    const container = await this.engine.createContainer({
      Image: `${DockerService.REGISTRY}/limespaces/${image}:latest`,
      name: `workspace-${workspaceId}`,
      HostConfig: {
        Runtime: 'sysbox-runc',
        SecurityOpt: ['seccomp=unconfined'],
        ShmSize: 2000000000,
        RestartPolicy: {
          Name: 'no',
        },
      },
      Env: [
        `TZ=Europe/Prague`,
        `HOSTNAME=${workspaceId}.workspace.limespaces.local`,
      ],
      Hostname: `${workspaceId}.workspace.limespaces.local`,
    });

    return container.id;
  }
}
