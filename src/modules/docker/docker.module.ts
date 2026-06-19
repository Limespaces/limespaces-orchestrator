import { Global, Module } from '@nestjs/common';
import { DockerService } from './docker.service';
import { BullModule } from '@nestjs/bullmq';
import { DockerProcessor } from './docker.processor';

@Global()
@Module({
  imports: [
    BullModule.registerQueue({
      name: 'docker',
    }),
  ],
  providers: [DockerService, DockerProcessor],
  exports: [DockerService],
})
export class DockerModule {}
