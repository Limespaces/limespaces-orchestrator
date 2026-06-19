import { Module } from '@nestjs/common';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';
import { BullModule } from '@nestjs/bullmq';
import { WorkspaceProcessor } from './workspace.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'workspace',
    }),
  ],
  controllers: [WorkspaceController],
  providers: [WorkspaceService, WorkspaceProcessor],
})
export class WorkspaceModule {}
