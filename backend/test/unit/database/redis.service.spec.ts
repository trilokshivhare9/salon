import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../../src/database/redis.service';

describe('RedisService (Unit Test)', () => {
  let service: RedisService;

  const mockRedisClient = {
    zadd: jest.fn().mockResolvedValue(1),
    eval: jest.fn().mockResolvedValue([]),
    quit: jest.fn().mockResolvedValue('OK'),
    disconnect: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultVal?: any) => {
              if (key === 'REDIS_HOST') return '127.0.0.1';
              if (key === 'REDIS_PORT') return 6379;
              return defaultVal;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<RedisService>(RedisService);
    service.client = mockRedisClient as any;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(service.SCHEDULE_KEY).toBe('reminders:schedule');
  });

  it('should set an alarm in Redis sorted set', async () => {
    const apptId = 'appt-abc';
    const timestamp = Date.now() + 60000;

    await service.setAlarm(apptId, 'REMINDER_2H', timestamp);

    expect(mockRedisClient.eval).toHaveBeenCalledWith(
      expect.stringContaining('zrange'),
      1,
      'reminders:schedule',
      apptId,
    );
    expect(mockRedisClient.zadd).toHaveBeenCalledWith(
      'reminders:schedule',
      timestamp,
      `${apptId}:REMINDER_2H`,
    );
  });

  it('should atomically pop due alarms', async () => {
    mockRedisClient.eval.mockResolvedValue(['appt-1:REMINDER_2H']);

    const due = await service.popDueAlarms(Date.now(), 10);

    expect(due).toEqual(['appt-1:REMINDER_2H']);
    expect(mockRedisClient.eval).toHaveBeenCalledWith(
      expect.stringContaining('zrangebyscore'),
      1,
      'reminders:schedule',
      expect.any(Number),
      10,
    );
  });
});
