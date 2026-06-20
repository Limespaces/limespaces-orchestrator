import { Global, Module } from '@nestjs/common';
import { EventsService } from './events.service';

@Global()
@Module({
  imports: [],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
