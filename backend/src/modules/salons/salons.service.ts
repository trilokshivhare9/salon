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
import * as bcrypt from 'bcrypt';
import { AdminRole, SalonStatus, DayOfWeek } from '@prisma/client';

@Injectable()
export class SalonsService {
  constructor(private prisma: PrismaService) {}

  // -------------------------------------------------------------
  // SUPER ADMIN (PLATFORM OWNER) METHODS
  // -------------------------------------------------------------
  async getAllSalonsForPlatformAdmin() {
    const salons = await this.prisma.salon.findMany({
      include: {
        admins: {
          where: { role: AdminRole.SALON_OWNER },
          select: { id: true, name: true, email: true, phone: true },
        },
        _count: {
          select: {
            stylists: true,
            services: true,
            appointments: true,
            salonUsers: true,
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

    const cleaned = input.trim().replace(/[^\d+]/g, '');

    // +91XXXXXXXXXX (13 chars)
    if (cleaned.startsWith('+91')) {
      const digits = cleaned.slice(3);
      if (digits.length !== 10 || !/^[6-9]\d{9}$/.test(digits)) {
        throw new BadRequestException('Please enter a valid 10-digit Indian mobile number.');
      }
      return cleaned;
    }

    // 91XXXXXXXXXX (12 digits)
    if (cleaned.startsWith('91') && cleaned.length === 12) {
      const digits = cleaned.slice(2);
      if (!/^[6-9]\d{9}$/.test(digits)) {
        throw new BadRequestException('Please enter a valid 10-digit Indian mobile number.');
      }
      return `+91${digits}`;
    }

    // 0XXXXXXXXXX (11 digits starting with 0)
    if (cleaned.startsWith('0') && cleaned.length === 11) {
      const digits = cleaned.slice(1);
      if (!/^[6-9]\d{9}$/.test(digits)) {
        throw new BadRequestException('Please enter a valid 10-digit Indian mobile number.');
      }
      return `+91${digits}`;
    }

    // Standard 10-digit Indian number
    if (/^[6-9]\d{9}$/.test(cleaned)) {
      return `+91${cleaned}`;
    }

    // Other international E.164 number
    if (cleaned.startsWith('+') && /^\+[1-9]\d{7,14}$/.test(cleaned)) {
      return cleaned;
    }

    throw new BadRequestException('Please enter a valid 10-digit mobile number.');
  }

  async createSalonBySuperAdmin(superAdminId: string, dto: CreateSalonPlatformDto) {
    const email = dto.email.toLowerCase().trim();
    const phone = this.normalizePhoneNumber(dto.phone);

    // 1. Uniqueness check: Owner Email across Admin database
    const existingAdmin = await this.prisma.admin.findUnique({
      where: { email },
    });
    if (existingAdmin) {
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

    // 4. Resolve slug collisions
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
      // 1. Create Salon
      const salon = await tx.salon.create({
        data: {
          createdByAdminId: superAdminId,
          name: dto.name.trim(),
          slug,
          phone,
          email,
          address: dto.address?.trim(),
          city: dto.city.trim(),
          timezone: dto.timezone || 'Asia/Kolkata',
          status: SalonStatus.ACTIVE,
          defaultStartTime: openTime,
          defaultEndTime: closeTime,
        },
      });

      // 2. Create SALON_OWNER Admin User
      await tx.admin.create({
        data: {
          salonId: salon.id,
          name: dto.ownerName.trim(),
          email,
          phone,
          passwordHash,
          role: AdminRole.SALON_OWNER,
        },
      });

      // 3. Automatically Seed 7-Day Operating Hours
      const days: DayOfWeek[] = [
        DayOfWeek.SUNDAY,
        DayOfWeek.MONDAY,
        DayOfWeek.TUESDAY,
        DayOfWeek.WEDNESDAY,
        DayOfWeek.THURSDAY,
        DayOfWeek.FRIDAY,
        DayOfWeek.SATURDAY,
      ];

      for (const day of days) {
        await tx.salonWorkingHours.create({
          data: {
            salonId: salon.id,
            dayOfWeek: day,
            isClosed: false,
            startTime: openTime,
            endTime: closeTime,
          },
        });
      }

      // 4. Configure WhatsApp Meta Account if credentials provided
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
        status: salon.status,
        bookingUrl: `/#book/${salon.slug}`,
        stylistsCount: 0,
        servicesCount: 0,
      };
    });
  }

  async toggleSalonStatus(salonId: string) {
    const salon = await this.prisma.salon.findUnique({ where: { id: salonId } });
    if (!salon) throw new NotFoundException('Salon not found.');

    const newStatus = salon.status === SalonStatus.ACTIVE ? SalonStatus.DEACTIVATED : SalonStatus.ACTIVE;

    return this.prisma.salon.update({
      where: { id: salonId },
      data: { status: newStatus },
    });
  }

  async deleteSalonBySuperAdmin(salonId: string) {
    const salon = await this.prisma.salon.findUnique({ where: { id: salonId } });
    if (!salon) throw new NotFoundException('Salon not found.');

    await this.prisma.salon.delete({ where: { id: salonId } });
    return { success: true, message: `Salon ${salon.name} deleted successfully.` };
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
  // SALON OWNER METHODS
  // -------------------------------------------------------------
  async getSalonProfile(salonId: string) {
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      include: {
        workingHours: { orderBy: { dayOfWeek: 'asc' } },
        _count: {
          select: {
            stylists: true,
            services: true,
            salonUsers: true,
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
    return this.prisma.salonWorkingHours.findMany({
      where: { salonId },
      orderBy: { dayOfWeek: 'asc' },
    });
  }

  async updateWorkingHours(salonId: string, dto: UpdateWorkingHoursDto) {
    return this.prisma.$transaction(async (tx) => {
      for (const item of dto.hours) {
        const isClosed = item.isClosed !== undefined ? item.isClosed : (item.isOpen !== undefined ? !item.isOpen : false);
        const startTime = item.startTime || item.openTime || '09:00';
        const endTime = item.endTime || item.closeTime || '21:00';

        await tx.salonWorkingHours.upsert({
          where: {
            salonId_dayOfWeek: {
              salonId,
              dayOfWeek: item.dayOfWeek,
            },
          },
          update: {
            isClosed,
            startTime,
            endTime,
            breakStartTime: item.breakStartTime || null,
            breakEndTime: item.breakEndTime || null,
          },
          create: {
            salonId,
            dayOfWeek: item.dayOfWeek,
            isClosed,
            startTime,
            endTime,
            breakStartTime: item.breakStartTime || null,
            breakEndTime: item.breakEndTime || null,
          },
        });
      }

      return tx.salonWorkingHours.findMany({
        where: { salonId },
        orderBy: { dayOfWeek: 'asc' },
      });
    });
  }
}
