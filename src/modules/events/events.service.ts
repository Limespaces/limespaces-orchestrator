import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { fromEventPattern, map } from 'rxjs';
import { OrchestratorConfig } from 'src/config';

@Injectable()
export class EventsService implements OnModuleDestroy {
  #redisClient: Redis;

  constructor() {
    this.#redisClient = this.createRedisInstance();
  }

  /**
   * Creates a new redis instance
   * @returns redis instance
   */
  private createRedisInstance() {
    return new Redis({
      host: OrchestratorConfig.redis.host,
      port: OrchestratorConfig.redis.port,
      password: OrchestratorConfig.redis.password,
    });
  }

  public createSseChannel(channel: string) {
    // Create new one instead of using the class one --
    // will get blocked (we wouldn't be able to push new events)
    const redisInstance = this.createRedisInstance();

    return fromEventPattern<{ channel: string; message: string }>(
      // What happens on sse connection
      (handler) => {
        redisInstance.subscribe(channel);
        redisInstance.on('message', (channel, message) =>
          handler({ channel, message }),
        );

        // What happens after sse disconnects
        async () => {
          await redisInstance.unsubscribe(channel);
          await redisInstance.quit();
        };
      },
    ).pipe(
      // Transform redis format into sse one
      map(({ message }) => {
        const parsed = JSON.parse(message);

        return {
          data: parsed.data,
          type: parsed.event,
        } as MessageEvent;
      }),
    );
  }

  public async emit(channel: string, event: string, data: any) {
    await this.#redisClient.publish(
      channel,
      JSON.stringify({
        event: event,
        data: data,
      }),
    );
  }

  public getChannel(userId: string, scope: string, identifier: string) {
    return `users:${userId}:${scope}s:${identifier}`;
  }

  onModuleDestroy() {
    this.#redisClient.disconnect();
  }
}
