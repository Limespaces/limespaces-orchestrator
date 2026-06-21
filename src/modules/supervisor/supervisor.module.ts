import { Global, Module } from '@nestjs/common';
import { SupervisorService } from './supervisor.service';

@Global()
@Module({
  imports: [],
  providers: [SupervisorService],
  exports: [SupervisorService],
})
export class SupervisorModule {}
