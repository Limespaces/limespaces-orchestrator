import { Module } from '@nestjs/common';
import { PrismaModule } from './modules/prisma/prisma.module';
import { WorkspaceModule } from './routes/workspace/workspace.module';
import { AuthModule } from './common/auth/auth.module';
import { UsersModule } from './routes/users/users.module';
import { BullModule } from '@nestjs/bullmq';
import { OrchestratorConfig } from './config';
import { DockerModule } from './modules/docker/docker.module';
import { EventsModule } from './modules/events/events.module';
import { SupervisorModule } from './modules/supervisor/supervisor.module';

@Module({
  imports: [
    PrismaModule,
    DockerModule,
    EventsModule,
    SupervisorModule,
    BullModule.forRoot({
      connection: {
        host: OrchestratorConfig.redis.host,
        port: OrchestratorConfig.redis.port,
        password: OrchestratorConfig.redis.password,
      },
    }),
    AuthModule,
    UsersModule,
    WorkspaceModule,
  ],
})
export class AppModule {}
