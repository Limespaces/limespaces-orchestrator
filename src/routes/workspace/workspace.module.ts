import { Module } from '@nestjs/common';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';
import { BullModule } from '@nestjs/bullmq';
import { WorkspaceProcessor } from './workspace.processor';
import { VncModule } from './vnc/vnc.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'workspace',
    }),
    VncModule,
  ],
  controllers: [WorkspaceController],
  providers: [WorkspaceService, WorkspaceProcessor],
})
export class WorkspaceModule {}
