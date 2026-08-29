import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Public } from '../../common/decorators/public.decorator';

@Public()
@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async checkHealth() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: 'ok',
        database: 'connected',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
      };
    } catch (err) {
      return {
        status: 'error',
        database: 'disconnected',
        error: err.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}
