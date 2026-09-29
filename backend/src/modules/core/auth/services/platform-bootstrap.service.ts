import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { PasswordService } from './password.service';
import { AdminRole, AdminStatus } from '@prisma/client';

@Injectable()
export class PlatformBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PlatformBootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
  ) {}

  async onApplicationBootstrap() {
    try {
      if (!this.prisma?.admin?.count) return;

      const email = (process.env.SUPER_ADMIN_EMAIL || 'admin@salonsaas.com').trim().toLowerCase();
      const password = process.env.SUPER_ADMIN_PASSWORD || 'Password123!';

      // 1. Check if any super admin exists in the database
      const superAdminCount = await this.prisma.admin.count({
        where: { role: AdminRole.SUPER_ADMIN },
      });

      if (superAdminCount === 0) {
        const passwordHash = await this.passwordService.hash(password);
        const admin = await this.prisma.admin.create({
          data: {
            name: 'Platform Super Admin',
            email,
            passwordHash,
            role: AdminRole.SUPER_ADMIN,
            status: AdminStatus.ACTIVE,
          },
        });
        this.logger.log(
          `🛡️ [Platform Root] Fresh database detected. Master Super Admin initialized: ${admin.email} (ID: ${admin.id})`,
        );
      } else if (process.env.SUPER_ADMIN_PASSWORD_RESET === 'true') {
        const passwordHash = await this.passwordService.hash(password);
        await this.prisma.admin.updateMany({
          where: { role: AdminRole.SUPER_ADMIN },
          data: { passwordHash },
        });
        this.logger.log(`🔑 [Platform Root] Master Super Admin password synchronized from environment.`);
      }
    } catch (err: any) {
      this.logger.warn(`⚠️ [Platform Root] Initialization check deferred: ${err?.message}`);
    }
  }
}
