import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { WorkspaceModule } from './routes/workspace/workspace.module';
import { AuthModule } from './common/auth/auth.module';
import { UsersModule } from './routes/users/users.module';

@Module({
  imports: [PrismaModule, AuthModule, UsersModule, WorkspaceModule],
})
export class AppModule {}
