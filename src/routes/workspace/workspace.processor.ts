import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { WorkspaceService } from './workspace.service';
import { Logger } from '@nestjs/common';

@Processor('workspace')
export class WorkspaceProcessor extends WorkerHost {
  private readonly logger = new Logger(WorkspaceProcessor.name);

  constructor(private readonly workspaceService: WorkspaceService) {
    super();
  }

  async process(job: Job): Promise<any> {
    this.logger.log(`Starting job ${job.name} in queue ${job.queueName}`);

    try {
      switch (job.name) {
        case 'createContainer':
          this.workspaceService.$createContainer(job.data);
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
