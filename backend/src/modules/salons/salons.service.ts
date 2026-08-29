import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { UpdateSalonDto } from './dto/update-salon.dto';
import { UpdateWorkingHoursDto } from './dto/working-hours.dto';
import { CreateHolidayDto, CreateBlockedTimeDto } from './dto/holiday.dto';
import * as bcrypt from 'bcrypt';
import { UserRole } from '@prisma/client';

export interface CreateSalonByAdminDto {
  name: string;
  slug?: string;
  phone: string;
  email: string;
  ownerName: string;
  password?: string;
  address?: string;
  city?: string;
  timezone?: string;
  planId?: string;
  whatsappPhoneNumberId?: string;
}

@Injectable()
export class SalonsService {
  constructor(private prisma: PrismaService) {}

  // -------------------------------------------------------------
  // SUPER ADMIN (PLATFORM OWNER) METHODS
  // -------------------------------------------------------------
  async getAllSalonsForPlatformAdmin() {
    const salons = await this.prisma.salon.findMany({
      include: {
        subscription: { include: { plan: true } },
        _count: {
          select: {
            staff: true,
            services: true,
            customers: true,
            appointments: true,
          },
        },
        users: {
          where: { role: UserRole.SALON_ADMIN },
          select: { id: true, name: true, email: true, phone: true },
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

  async createSalonBySuperAdmin(dto: CreateSalonByAdminDto) {
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
    const passwordHash = await bcrypt.hash(dto.password || 'Password123!', salt);

    return this.prisma.$transaction(async (tx) => {
      let plan = null;
      if (dto.planId) {
        plan = await tx.plan.findUnique({ where: { id: dto.planId } });
      }
      if (!plan) {
        plan = await tx.plan.findFirst({ where: { name: 'Trial' } });
      }

      const salon = await tx.salon.create({
        data: {
          name: dto.name,
          slug,
          phone: dto.phone,
          email: dto.email.toLowerCase(),
          address: dto.address,
          city: dto.city,
          timezone: dto.timezone || 'Asia/Kolkata',
        },
      });

      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 30);
      await tx.subscription.create({
        data: {
          salonId: salon.id,
          planId: plan!.id,
          status: 'ACTIVE',
          trialStartDate: new Date(),
          trialEndDate: trialEnd,
        },
      });

      await tx.user.create({
        data: {
          salonId: salon.id,
          name: dto.ownerName,
          email: dto.email.toLowerCase(),
          phone: dto.phone,
          passwordHash,
          role: UserRole.SALON_ADMIN,
        },
      });

      // Default Mon - Sun working hours (10:00 - 20:00)
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
            openTime: '10:00',
            closeTime: '20:00',
          },
        });
      }

      // 1. Create Default Services
      const s1 = await tx.service.create({
        data: {
          salonId: salon.id,
          name: 'Classic Haircut & Styling',
          description: 'Precision cut, wash, and blowdry style.',
          price: 500.0,
          durationMinutes: 30,
          category: 'Hair',
          status: 'ACTIVE',
        },
      });

      const s2 = await tx.service.create({
        data: {
          salonId: salon.id,
          name: 'Deep Hair Spa & Conditioning',
          description: 'Intense hydration therapy with scalp massage.',
          price: 1200.0,
          durationMinutes: 60,
          category: 'Hair',
          status: 'ACTIVE',
        },
      });

      const s3 = await tx.service.create({
        data: {
          salonId: salon.id,
          name: 'Glow Facial & Skin Care',
          description: 'Deep cleansing, exfoliation, and radiance mask.',
          price: 1500.0,
          durationMinutes: 45,
          category: 'Skin',
          status: 'ACTIVE',
        },
      });

      // 2. Create Default Staff (Owner Stylist)
      const defaultStaff = await tx.staff.create({
        data: {
          salonId: salon.id,
          name: dto.ownerName,
          phone: dto.phone,
          email: dto.email.toLowerCase(),
          status: 'ACTIVE',
        },
      });

      // Bind staff to all starter services
      await tx.staffService.createMany({
        data: [
          { staffId: defaultStaff.id, serviceId: s1.id },
          { staffId: defaultStaff.id, serviceId: s2.id },
          { staffId: defaultStaff.id, serviceId: s3.id },
        ],
      });

      // Default staff working hours
      for (const day of days) {
        await tx.staffWorkingHours.create({
          data: {
            staffId: defaultStaff.id,
            dayOfWeek: day,
            isWorking: true,
            startTime: '10:00',
            endTime: '20:00',
          },
        });
      }

      if (dto.whatsappPhoneNumberId) {
        await tx.whatsAppAccount.create({
          data: {
            salonId: salon.id,
            phoneNumberId: dto.whatsappPhoneNumberId,
            accessTokenEncrypted: 'system_managed',
            webhookVerifyToken: 'salon_webhook_verify_token_mvp',
            isActive: true,
          },
        });
      }

      return salon;
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

  async toggleSalonStatus(salonId: string) {
    const salon = await this.prisma.salon.findUnique({ where: { id: salonId } });
    if (!salon) throw new NotFoundException('Salon not found.');

    const newStatus = salon.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    return this.prisma.salon.update({
      where: { id: salonId },
      data: { status: newStatus },
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

  async deleteBlockedTime(salonId: string, blockedTimeId: string) {
    return this.prisma.blockedTime.deleteMany({
      where: { id: blockedTimeId, salonId },
    });
  }
}
