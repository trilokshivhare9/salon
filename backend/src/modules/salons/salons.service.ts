import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateSalonPlatformDto } from './dto/create-salon-platform.dto';
import { UpdateSalonDto } from './dto/update-salon.dto';
import { UpdateWorkingHoursDto } from './dto/working-hours.dto';
import { CreateHolidayDto, CreateBlockedTimeDto } from './dto/holiday.dto';
import * as bcrypt from 'bcrypt';
import { UserRole } from '@prisma/client';

@Injectable()
export class SalonsService {
  constructor(private prisma: PrismaService) {}

  // -------------------------------------------------------------
  // SUPER ADMIN (PLATFORM OWNER) METHODS
  // -------------------------------------------------------------
  async getAllSalonsForPlatformAdmin() {
    const salons = await this.prisma.salon.findMany({
      include: {
        users: {
          where: { role: UserRole.SALON_ADMIN },
          select: { id: true, name: true, email: true, phone: true },
        },
        subscription: {
          include: { plan: true },
        },
        _count: {
          select: {
            staff: true,
            services: true,
            appointments: true,
            customers: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalSalons = salons.length;
    const activeSalons = salons.filter((s) => s.status === 'ACTIVE').length;
    const totalAppointments = salons.reduce((sum, s) => sum + s._count.appointments, 0);

    return {
      stats: {
        totalSalons,
        activeSalons,
        totalAppointments,
      },
      salons,
    };
  }

  private normalizePhoneNumber(input: string): string {
    if (!input) throw new BadRequestException('Phone number is required.');

    // Strip spaces, hyphens, and brackets
    const cleaned = input.trim().replace(/[^\d+]/g, '');

    // Case 1: +91XXXXXXXXXX (13 chars)
    if (cleaned.startsWith('+91')) {
      const digits = cleaned.slice(3);
      if (digits.length !== 10 || !/^[6-9]\d{9}$/.test(digits)) {
        throw new BadRequestException(
          'Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.',
        );
      }
      return cleaned;
    }

    // Case 2: 91XXXXXXXXXX (12 digits)
    if (cleaned.startsWith('91') && cleaned.length === 12) {
      const digits = cleaned.slice(2);
      if (!/^[6-9]\d{9}$/.test(digits)) {
        throw new BadRequestException(
          'Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.',
        );
      }
      return `+91${digits}`;
    }

    // Case 3: 0XXXXXXXXXX (11 digits starting with 0)
    if (cleaned.startsWith('0') && cleaned.length === 11) {
      const digits = cleaned.slice(1);
      if (!/^[6-9]\d{9}$/.test(digits)) {
        throw new BadRequestException(
          'Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.',
        );
      }
      return `+91${digits}`;
    }

    // Case 4: Standard 10-digit Indian number (e.g. 7999817743)
    if (/^[6-9]\d{9}$/.test(cleaned)) {
      return `+91${cleaned}`;
    }

    // Case 5: Other international E.164 number (e.g. +14155552671)
    if (cleaned.startsWith('+') && /^\+[1-9]\d{7,14}$/.test(cleaned)) {
      return cleaned;
    }

    throw new BadRequestException(
      'Please enter a valid 10-digit mobile number (e.g. 7999817743 or +91 7999817743).',
    );
  }

  async createSalonBySuperAdmin(dto: CreateSalonPlatformDto) {
    const email = dto.email.toLowerCase().trim();
    const phone = this.normalizePhoneNumber(dto.phone);

    // 1. Uniqueness check: Owner Email across User database
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existingUser) {
      throw new ConflictException(
        `An account with email '${email}' already exists. Please use a unique owner email.`,
      );
    }

    // 2. Uniqueness check: WhatsApp Phone ID if provided
    if (dto.whatsappPhoneNumberId) {
      const waId = dto.whatsappPhoneNumberId.trim();
      const existingWa = await this.prisma.whatsAppAccount.findUnique({
        where: { phoneNumberId: waId },
      });
      if (existingWa) {
        throw new ConflictException(
          `Meta WhatsApp Phone Number ID '${waId}' is already linked to another salon.`,
        );
      }
    }

    // 3. Operating hours validation
    const openTime = dto.openTime || '09:00';
    const closeTime = dto.closeTime || '21:00';
    if (openTime >= closeTime) {
      throw new BadRequestException('Closing time must be later than opening time.');
    }

    // 4. Resolve slug collisions cleanly
    let baseSlug = (dto.slug || dto.name)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    let slug = baseSlug;
    let slugIndex = 1;
    while (await this.prisma.salon.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${slugIndex}`;
      slugIndex++;
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(dto.password, salt);

    return this.prisma.$transaction(async (tx) => {
      // Find requested plan or default Trial plan
      let plan = null;
      if (dto.planId) {
        plan = await tx.plan.findUnique({ where: { id: dto.planId } });
      }
      if (!plan) {
        plan = await tx.plan.findFirst({ where: { name: 'Trial' } });
      }

      // Create Salon Shard (Initialized as DEACTIVATED until staff & service are added)
      const salon = await tx.salon.create({
        data: {
          name: dto.name.trim(),
          slug,
          phone,
          email,
          address: dto.address?.trim(),
          city: dto.city.trim(),
          timezone: dto.timezone || 'Asia/Kolkata',
          status: 'DEACTIVATED',
        },
      });

      // 14-Day Free Trial Subscription
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 14);
      await tx.subscription.create({
        data: {
          salonId: salon.id,
          planId: plan!.id,
          status: 'ACTIVE',
          trialStartDate: new Date(),
          trialEndDate: trialEnd,
        },
      });

      // Create SALON_ADMIN Owner User (Store Credentials)
      const ownerUser = await tx.user.create({
        data: {
          salonId: salon.id,
          name: dto.ownerName.trim(),
          email,
          phone,
          passwordHash,
          role: UserRole.SALON_ADMIN,
        },
      });

      // 7-Day Business Working Hours (Mon - Sun)
      const days = [
        'MONDAY',
        'TUESDAY',
        'WEDNESDAY',
        'THURSDAY',
        'FRIDAY',
        'SATURDAY',
        'SUNDAY',
      ] as const;

      for (const day of days) {
        await tx.workingHours.create({
          data: {
            salonId: salon.id,
            dayOfWeek: day,
            isOpen: true,
            openTime,
            closeTime,
          },
        });
      }

      // Configure WhatsApp Meta Account if credentials provided
      if (dto.whatsappPhoneNumberId) {
        await tx.whatsAppAccount.create({
          data: {
            salonId: salon.id,
            phoneNumberId: dto.whatsappPhoneNumberId.trim(),
            accessTokenEncrypted: 'system_managed',
            webhookVerifyToken: 'salon_webhook_verify_token_mvp',
            isActive: true,
          },
        });
      }

      return {
        id: salon.id,
        name: salon.name,
        slug: salon.slug,
        ownerName: dto.ownerName,
        email,
        phone,
        city: salon.city,
        timezone: salon.timezone,
        openTime,
        closeTime,
        status: 'DEACTIVATED',
        bookingUrl: `/#book/${salon.slug}`,
        staffCount: 0,
        servicesCount: 0,
      };
    });
  }

  async recalculateSalonActivationStatus(salonId: string): Promise<string> {
    const [activeStaffCount, activeServicesCount] = await Promise.all([
      this.prisma.staff.count({
        where: { salonId, status: 'ACTIVE' },
      }),
      this.prisma.service.count({
        where: { salonId, status: 'ACTIVE' },
      }),
    ]);

    const newStatus = activeStaffCount > 0 && activeServicesCount > 0
      ? 'ACTIVE'
      : 'DEACTIVATED';

    await this.prisma.salon.update({
      where: { id: salonId },
      data: { status: newStatus as any },
    });

    return newStatus;
  }

  async toggleSalonStatus(salonId: string) {
    const salon = await this.prisma.salon.findUnique({ where: { id: salonId } });
    if (!salon) throw new NotFoundException('Salon not found.');

    let newStatus: string;
    if (salon.status === 'ACTIVE') {
      newStatus = 'DEACTIVATED';
    } else {
      // Must have at least 1 active staff and 1 active service to activate
      const [staffCount, svcCount] = await Promise.all([
        this.prisma.staff.count({ where: { salonId, status: 'ACTIVE' } }),
        this.prisma.service.count({ where: { salonId, status: 'ACTIVE' } }),
      ]);
      if (staffCount === 0 || svcCount === 0) {
        throw new BadRequestException(
          'Cannot activate salon: Salon must have at least 1 active staff member and 1 active service.',
        );
      }
      newStatus = 'ACTIVE';
    }

    return this.prisma.salon.update({
      where: { id: salonId },
      data: { status: newStatus as any },
    });
  }

  async updateSalonWhatsAppConfig(
    salonId: string,
    dto: { phoneNumberId: string; wabaId?: string; accessToken?: string },
  ) {
    const salon = await this.prisma.salon.findUnique({ where: { id: salonId } });
    if (!salon) throw new NotFoundException('Salon not found.');

    return this.prisma.whatsAppAccount.upsert({
      where: { salonId },
      update: {
        phoneNumberId: dto.phoneNumberId,
        wabaId: dto.wabaId,
        accessTokenEncrypted: dto.accessToken || 'system_managed',
        webhookVerifyToken: 'salon_webhook_verify_token_mvp',
        isActive: true,
      },
      create: {
        salonId,
        phoneNumberId: dto.phoneNumberId,
        wabaId: dto.wabaId,
        accessTokenEncrypted: dto.accessToken || 'system_managed',
        webhookVerifyToken: 'salon_webhook_verify_token_mvp',
        isActive: true,
      },
    });
  }



  // -------------------------------------------------------------
  // SALON ADMIN METHODS
  // -------------------------------------------------------------
  async getSalonProfile(salonId: string) {
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      include: {
        workingHours: { orderBy: { dayOfWeek: 'asc' } },
        subscription: { include: { plan: true } },
        _count: {
          select: {
            staff: true,
            services: true,
            customers: true,
            appointments: true,
          },
        },
      },
    });

    if (!salon) {
      throw new NotFoundException('Salon not found.');
    }

    return salon;
  }

  async updateSalonProfile(salonId: string, dto: UpdateSalonDto) {
    return this.prisma.salon.update({
      where: { id: salonId },
      data: dto,
    });
  }

  async getWorkingHours(salonId: string) {
    return this.prisma.workingHours.findMany({
      where: { salonId },
      orderBy: { dayOfWeek: 'asc' },
    });
  }

  async updateWorkingHours(salonId: string, dto: UpdateWorkingHoursDto) {
    return this.prisma.$transaction(async (tx) => {
      for (const item of dto.hours) {
        await tx.workingHours.upsert({
          where: {
            salonId_dayOfWeek: {
              salonId,
              dayOfWeek: item.dayOfWeek,
            },
          },
          update: {
            isOpen: item.isOpen,
            openTime: item.openTime,
            closeTime: item.closeTime,
          },
          create: {
            salonId,
            dayOfWeek: item.dayOfWeek,
            isOpen: item.isOpen,
            openTime: item.openTime,
            closeTime: item.closeTime,
          },
        });
      }

      return tx.workingHours.findMany({
        where: { salonId },
        orderBy: { dayOfWeek: 'asc' },
      });
    });
  }

  async getHolidays(salonId: string) {
    return this.prisma.holiday.findMany({
      where: { salonId },
      orderBy: { date: 'asc' },
    });
  }

  async addHoliday(salonId: string, dto: CreateHolidayDto) {
    return this.prisma.holiday.upsert({
      where: {
        salonId_date: {
          salonId,
          date: new Date(dto.date),
        },
      },
      update: {
        reason: dto.reason,
      },
      create: {
        salonId,
        date: new Date(dto.date),
        reason: dto.reason,
      },
    });
  }

  async deleteHoliday(salonId: string, holidayId: string) {
    return this.prisma.holiday.deleteMany({
      where: { id: holidayId, salonId },
    });
  }

  async getBlockedTimes(salonId: string) {
    return this.prisma.blockedTime.findMany({
      where: { salonId },
      include: { staff: { select: { id: true, name: true } } },
      orderBy: { startTime: 'asc' },
    });
  }

  async addBlockedTime(salonId: string, dto: CreateBlockedTimeDto) {
    return this.prisma.blockedTime.create({
      data: {
        salonId,
        staffId: dto.staffId || null,
        startTime: new Date(dto.startTime),
        endTime: new Date(dto.endTime),
        reason: dto.reason,
      },
    });
  }

  async deleteSalonBySuperAdmin(salonId: string) {
    await this.prisma.whatsAppLog.deleteMany({ where: { salonId } });
    await this.prisma.whatsAppAccount.deleteMany({ where: { salonId } });
    await this.prisma.conversation.deleteMany({ where: { salonId } });
    await this.prisma.appointmentStatusHistory.deleteMany({
      where: { appointment: { salonId } },
    });
    await this.prisma.notification.deleteMany({ where: { salonId } });
    await this.prisma.appointment.deleteMany({ where: { salonId } });
    await this.prisma.blockedTime.deleteMany({ where: { salonId } });
    await this.prisma.holiday.deleteMany({ where: { salonId } });
    await this.prisma.staffBreak.deleteMany({
      where: { staff: { salonId } },
    });
    await this.prisma.staffWorkingHours.deleteMany({
      where: { staff: { salonId } },
    });
    await this.prisma.staffService.deleteMany({
      where: { staff: { salonId } },
    });
    await this.prisma.service.deleteMany({ where: { salonId } });
    await this.prisma.staff.deleteMany({ where: { salonId } });
    await this.prisma.workingHours.deleteMany({ where: { salonId } });
    await this.prisma.customer.deleteMany({ where: { salonId } });
    await this.prisma.subscription.deleteMany({ where: { salonId } });
    await this.prisma.user.deleteMany({ where: { salonId } });
    await this.prisma.salon.delete({ where: { id: salonId } });

    return { success: true, message: `Salon ${salonId} deleted completely.` };
  }

  async purgeAllOldSalonsExcept(keepSlugOrId: string) {
    const keepSalon = await this.prisma.salon.findFirst({
      where: {
        OR: [{ id: keepSlugOrId }, { slug: keepSlugOrId }],
      },
    });

    const otherSalons = await this.prisma.salon.findMany({
      where: keepSalon ? { id: { not: keepSalon.id } } : {},
      select: { id: true, name: true },
    });

    for (const s of otherSalons) {
      await this.deleteSalonBySuperAdmin(s.id);
    }

    // Also clean up any orphan conversations that don't belong to keepSalon
    if (keepSalon) {
      await this.prisma.conversation.deleteMany({
        where: { salonId: { not: keepSalon.id } },
      });
      // Link whatsapp account to keepSalon if missing
      await this.prisma.whatsAppAccount.upsert({
        where: { salonId: keepSalon.id },
        update: {
          phoneNumberId: '1266237649907696',
          isActive: true,
        },
        create: {
          salonId: keepSalon.id,
          phoneNumberId: '1266237649907696',
          accessTokenEncrypted: 'system_managed',
          webhookVerifyToken: 'salon_webhook_verify_token_mvp',
          isActive: true,
        },
      });
    }

    return {
      success: true,
      deletedCount: otherSalons.length,
      deletedSalons: otherSalons.map((s) => s.name),
      activeSalon: keepSalon ? keepSalon.name : 'none',
    };
  }

  async resetDatabaseToZero() {
    // 1. Delete all transactional, catalog, and tenant records
    await this.prisma.whatsAppLog.deleteMany();
    await this.prisma.whatsAppAccount.deleteMany();
    await this.prisma.appointmentStatusHistory.deleteMany();
    await this.prisma.notification.deleteMany();
    await this.prisma.appointment.deleteMany();
    await this.prisma.blockedTime.deleteMany();
    await this.prisma.holiday.deleteMany();
    await this.prisma.staffBreak.deleteMany();
    await this.prisma.staffWorkingHours.deleteMany();
    await this.prisma.staffService.deleteMany();
    await this.prisma.service.deleteMany();
    await this.prisma.staff.deleteMany();
    await this.prisma.workingHours.deleteMany();
    await this.prisma.customer.deleteMany();
    await this.prisma.subscription.deleteMany();
    // Delete non-platform-admin users
    await this.prisma.user.deleteMany({
      where: { role: { not: 'PLATFORM_ADMIN' } },
    });
    await this.prisma.salon.deleteMany();

    // 2. Ensure Plans exist
    const planCount = await this.prisma.plan.count();
    if (planCount === 0) {
      await this.prisma.plan.create({
        data: {
          name: 'Trial',
          priceMonthly: 0,
          priceYearly: 0,
          maxStaff: 10,
          maxServices: 50,
          allowWhatsApp: true,
        },
      });
      await this.prisma.plan.create({
        data: {
          name: 'Pro',
          priceMonthly: 1999,
          priceYearly: 19999,
          maxStaff: 50,
          maxServices: 200,
          allowWhatsApp: true,
        },
      });
    }

    return {
      success: true,
      message: 'Database reset to clean zero state successfully.',
      remainingSalons: 0,
    };
  }
}
