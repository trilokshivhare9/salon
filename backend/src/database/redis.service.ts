import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  public client!: Redis;
  public readonly SCHEDULE_KEY = 'reminders:schedule';

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const redisUrl =
      this.configService.get<string>('REDIS_URL') || process.env.REDIS_URL;

    if (redisUrl) {
      this.logger.log('Initializing Redis client with REDIS_URL...');
      this.client = new Redis(redisUrl, {
        lazyConnect: false,
        retryStrategy: (times) => Math.min(times * 200, 3000),
        maxRetriesPerRequest: 3,
        tls: redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
      });

      this.client.on('connect', () => {
        this.logger.log('⚡ Connected to Redis via REDIS_URL');
      });
    } else {
      const host = this.configService.get<string>('REDIS_HOST', '127.0.0.1');
      const port = Number(this.configService.get<number>('REDIS_PORT', 6379));
      const password = this.configService.get<string>('REDIS_PASSWORD') || undefined;

      this.client = new Redis({
        host,
        port,
        password,
        lazyConnect: false,
        retryStrategy: (times) => Math.min(times * 200, 3000),
        maxRetriesPerRequest: 3,
      });

      this.client.on('connect', () => {
        this.logger.log(`⚡ Connected to Redis at ${host}:${port}`);
      });
    }

    this.client.on('error', (err) => {
      this.logger.error(`❌ Redis connection error: ${err.message}`);
    });
  }

  public isReady(): boolean {
    return this.client && this.client.status === 'ready';
  }

  async onModuleDestroy() {
    if (this.client) {
      this.logger.log('Closing Redis connection...');
      await this.client.quit().catch(() => this.client.disconnect());
    }
  }

  /**
   * Arm or replace scheduled reminder alarm in Redis sorted set
   */
  async setAlarm(appointmentId: string, actionType: string, timestampMs: number): Promise<void> {
    await this.clearAlarm(appointmentId);
    const member = `${appointmentId}:${actionType}`;
    await this.client.zadd(this.SCHEDULE_KEY, timestampMs, member);
  }

  /**
   * Purge all alarms matching this appointmentId
   */
  async clearAlarm(appointmentId: string): Promise<void> {
    const luaScript = `
      local key = KEYS[1]
      local prefix = ARGV[1] .. ":"
      local members = redis.call('zrange', key, 0, -1)
      local to_remove = {}
      for _, member in ipairs(members) do
        if string.sub(member, 1, #prefix) == prefix then
          table.insert(to_remove, member)
        end
      end
      if #to_remove > 0 then
        return redis.call('zrem', key, unpack(to_remove))
      end
      return 0
    `;
    await this.client.eval(luaScript, 1, this.SCHEDULE_KEY, appointmentId);
  }

  /**
   * Atomically pop due alarms ready to execute
   */
  async popDueAlarms(maxScoreMs: number, limit: number = 50): Promise<string[]> {
    const luaPop = `
      local due = redis.call('zrangebyscore', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, ARGV[2])
      if #due > 0 then
        redis.call('zrem', KEYS[1], unpack(due))
      end
      return due
    `;
    const result = (await this.client.eval(
      luaPop,
      1,
      this.SCHEDULE_KEY,
      maxScoreMs,
      limit,
    )) as string[];
    return result || [];
  }
}
