import { Processor, WorkerHost } from '@nestjs/bullmq';
import { DockerService } from './docker.service';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';

@Processor('docker')
export class DockerProcessor extends WorkerHost {
  private readonly logger = new Logger(DockerProcessor.name);

  constructor(private readonly dockerService: DockerService) {
    super();
  }

  async process(job: Job): Promise<any> {
    this.logger.log(`Starting job ${job.name} in queue ${job.queueName}`);

    try {
      switch (job.name) {
        case 'pullWorkspaceImage':
          await this.dockerService.$pullWorkspaceImage(job.data);
          break;

        default:
          throw new Error(
            `Job "${job.name}" not found for "${job.queueName}" queue`,
          );
      }
    } catch (e: any) {
      const message = `Job ${job.name} in queue ${job.queueName} failed: ${e instanceof Error ? e.message : e}`;

      this.logger.error(message);
      throw new Error(message);
    }
  }
}
