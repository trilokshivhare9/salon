import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { CreateSalonPlatformDto } from './dto/create-salon-platform.dto';
import { UpdateSalonDto } from './dto/update-salon.dto';
import { UpdateWorkingHoursDto } from './dto/working-hours.dto';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { DateTime } from 'luxon';
import { AdminRole, SalonStatus, DayOfWeek, AppointmentStatus } from '@prisma/client';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

@Injectable()
export class SalonsService {
  private readonly logger = new Logger(SalonsService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private whatsAppService: WhatsAppService,
  ) { }

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
        whatsappAccount: {
          select: { id: true, phoneNumberId: true, isActive: true },
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

    // Enforce business rule: A salon is ONLY ACTIVE when it has minimum 1 stylist AND 1 service!
    // Auto-sync existing database records if they are improperly marked ACTIVE without minimum catalog.
    for (const s of salons) {
      const hasMinCatalog = s._count.stylists >= 1 && s._count.services >= 1;
      if (!hasMinCatalog && s.status === SalonStatus.ACTIVE) {
        await this.prisma.salon.update({
          where: { id: s.id },
          data: { status: SalonStatus.INACTIVE },
        });
        s.status = SalonStatus.INACTIVE;
      }
    }

    const totalSalons = salons.length;
    const activeSalons = salons.filter(
      (s) => s.status === 'ACTIVE' && s._count.stylists >= 1 && s._count.services >= 1,
    ).length;
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

  async verifyMetaPhoneNumberId(phoneId: string) {
    if (!phoneId || !/^\d{10,20}$/.test(phoneId.trim())) {
      throw new BadRequestException('Meta WhatsApp Phone Number ID must be numeric (10-20 digits).');
    }

    const cleanId = phoneId.trim();
    const token =
      this.configService.get<string>('whatsapp.accessToken') ||
      process.env.WHATSAPP_ACCESS_TOKEN;

    if (!token) {
      throw new BadRequestException('WHATSAPP_ACCESS_TOKEN is not configured in server environment.');
    }

    try {
      const response = await fetch(`https://graph.facebook.com/v20.0/${cleanId}?access_token=${encodeURIComponent(token)}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });

      const data: any = await response.json();

      if (!response.ok || data.error) {
        const errorMsg = data?.error?.message || `Meta Cloud API responded with HTTP status ${response.status}`;
        throw new BadRequestException(`Invalid Meta Phone Number ID: ${errorMsg}`);
      }

      return {
        valid: true,
        phoneNumberId: cleanId,
        verifiedName: data.verified_name || 'Active WhatsApp Number',
        displayPhoneNumber: data.display_phone_number || cleanId,
        qualityRating: data.quality_rating || 'UNKNOWN',
        platformType: data.platform_type || 'CLOUD_API',
        codeVerificationStatus: data.code_verification_status || 'VERIFIED',
      };
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(`Could not verify with Meta Cloud API: ${err.message || err}`);
    }
  }

  async verifyPhoneNumberWithMeta(rawPhone: string, usePlatformBot = false) {
    if (!rawPhone) throw new BadRequestException('Phone number is required.');

    const normalized = this.normalizePhoneNumber(rawPhone);
    const inputDigits = normalized.replace(/\D/g, '');

    const token =
      this.configService.get<string>('whatsapp.accessToken') ||
      process.env.WHATSAPP_ACCESS_TOKEN;

    if (!token) {
      throw new BadRequestException('WHATSAPP_ACCESS_TOKEN is not configured in server environment.');
    }

    const platformPhoneId =
      this.configService.get<string>('whatsapp.phoneNumberId') ||
      process.env.WHATSAPP_PHONE_NUMBER_ID ||
      '1266237649907696';

    // Probe the active Meta Cloud API Phone Number ID
    let metaPhone: any = null;
    try {
      metaPhone = await this.verifyMetaPhoneNumberId(platformPhoneId);
    } catch (err) {
      // ignore
    }

    if (metaPhone) {
      const metaDigits = (metaPhone.displayPhoneNumber || '').replace(/\D/g, '');
      const isDirectMatch =
        inputDigits === metaDigits ||
        inputDigits.endsWith(metaDigits) ||
        metaDigits.endsWith(inputDigits);

      return {
        valid: true,
        phoneNumberId: metaPhone.phoneNumberId,
        displayPhoneNumber: metaPhone.displayPhoneNumber,
        verifiedName: metaPhone.verifiedName,
        qualityRating: metaPhone.qualityRating,
        platformType: metaPhone.platformType,
        isDedicated: isDirectMatch,
        message: isDirectMatch
          ? `Direct Dedicated Meta Number: ${metaPhone.displayPhoneNumber} is verified!`
          : `WhatsApp Bot auto-linked via Meta Cloud API (${metaPhone.verifiedName}) for ${normalized}.`,
      };
    }

    throw new BadRequestException(
      `Could not connect to Meta WhatsApp Cloud API (Phone ID: ${platformPhoneId}). Please check your server WHATSAPP_ACCESS_TOKEN.`,
    );
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

    // 2. Uniqueness check & Live Meta Verification: WhatsApp Phone ID (if provided)
    const platformPhoneId =
      this.configService.get<string>('whatsapp.phoneNumberId') ||
      process.env.WHATSAPP_PHONE_NUMBER_ID ||
      '1266237649907696';

    let shouldCreateWhatsAppAccount = false;
    let waId = dto.whatsappPhoneNumberId?.trim() || null;
    if (waId) {
      // Verify against Meta Graph API in real-time
      await this.verifyMetaPhoneNumberId(waId);

      const existingWa = await this.prisma.whatsAppAccount.findUnique({
        where: { phoneNumberId: waId },
      });
      if (existingWa) {
        if (waId === platformPhoneId) {
          // Central shared platform bot is already present in DB
          shouldCreateWhatsAppAccount = false;
        } else {
          throw new ConflictException(
            `Meta WhatsApp Phone Number ID '${waId}' is already linked to another salon.`,
          );
        }
      } else {
        shouldCreateWhatsAppAccount = true;
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

    const created = await this.prisma.$transaction(async (tx) => {
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

      // 4. Configure WhatsApp Meta Account if waId is present and not shared duplicate
      if (waId && shouldCreateWhatsAppAccount) {
        await tx.whatsAppAccount.create({
          data: {
            salonId: salon.id,
            phoneNumberId: waId,
            accessTokenEncrypted: 'system_managed',
            webhookVerifyToken: 'salon_webhook_verify_token_mvp',
            isActive: true,
          },
        });
      }

      // 5. Inherit Master Categories from Super Admin into newly provisioned Salon
      const masterCategories = await tx.masterCategory.findMany({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });

      if (masterCategories.length > 0) {
        await tx.serviceCategory.createMany({
          data: masterCategories.map((mc) => ({
            salonId: salon.id,
            name: mc.name,
            icon: mc.icon || 'scissors',
            sortOrder: mc.sortOrder,
          })),
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
        whatsappPhoneNumberId: waId,
      };
    });

    // 5. Automatically dispatch Welcome WhatsApp Notification with Owner Credentials
    try {
      const frontendUrl =
        this.configService.get<string>('FRONTEND_URL') ||
        process.env.FRONTEND_URL ||
        'http://localhost:8080';
      const portalUrl = `${frontendUrl}/#login`;

      const welcomeMessage =
        `🎉 *Welcome to StyleSlot!*

Your salon *${dto.name.trim()}* has been successfully registered.

Here are your salon owner login credentials:
📱 *Login Mobile:* ${phone}
🔑 *Password:* ${dto.password}
🌐 *Portal URL:* ${portalUrl}

👉 Please login at the link above using your mobile number and password to set up your stylists, services, and live bookings!`;

      this.logger.log(`[SalonsService] Dispatching onboarding WhatsApp message to ${phone}...`);
      await this.whatsAppService.sendMetaMessage(
        phone,
        { textBody: welcomeMessage },
        waId || undefined,
        created.id,
      );
      this.logger.log(`[SalonsService] ✅ Onboarding WhatsApp message sent to ${phone}`);
    } catch (waErr: any) {
      this.logger.warn(
        `[SalonsService] ⚠️ Outbound WhatsApp credentials could not be sent to ${phone}: ${waErr.message}`,
      );
    }

    return created;
  }

  async linkSalonWhatsAppAccount(salonId: string, phoneNumberId: string) {
    const salon = await this.prisma.salon.findUnique({ where: { id: salonId } });
    if (!salon) throw new NotFoundException('Salon not found.');

    // 1. Verify with Meta Cloud API
    const metaCheck = await this.verifyMetaPhoneNumberId(phoneNumberId);
    const waId = phoneNumberId.trim();

    // 2. Check if another salon is already using this phone ID
    const existingWa = await this.prisma.whatsAppAccount.findUnique({
      where: { phoneNumberId: waId },
    });
    if (existingWa && existingWa.salonId !== salonId) {
      throw new ConflictException(`Meta WhatsApp Phone Number ID '${waId}' is already linked to another salon.`);
    }

    // 3. Upsert WhatsAppAccount
    const account = await this.prisma.whatsAppAccount.upsert({
      where: { salonId },
      update: {
        phoneNumberId: waId,
        accessTokenEncrypted: 'system_managed',
        webhookVerifyToken: 'salon_webhook_verify_token_mvp',
        isActive: true,
      },
      create: {
        salonId,
        phoneNumberId: waId,
        accessTokenEncrypted: 'system_managed',
        webhookVerifyToken: 'salon_webhook_verify_token_mvp',
        isActive: true,
      },
    });

    return {
      success: true,
      account,
      meta: metaCheck,
      message: `WhatsApp Bot linked successfully to "${salon.name}".`,
    };
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

    await this.prisma.$transaction(async (tx) => {
      // 1. Delete notifications for this salon
      await tx.notification.deleteMany({ where: { salonId } });
      // 2. Delete appointments for this salon
      await tx.appointment.deleteMany({ where: { salonId } });
      // 3. Delete conversations
      await tx.conversation.deleteMany({ where: { salonId } });
      // 4. Delete whatsApp logs & account
      await tx.whatsAppLog.deleteMany({ where: { salonId } });
      await tx.whatsAppAccount.deleteMany({ where: { salonId } });
      // 5. Delete salon users (customers linked to this salon)
      await tx.salonUser.deleteMany({ where: { salonId } });
      // 6. Delete stylist services & working hours & stylists
      await tx.stylistWorkingHours.deleteMany({ where: { stylist: { salonId } } });
      await tx.stylistService.deleteMany({ where: { stylist: { salonId } } });
      await tx.stylist.deleteMany({ where: { salonId } });
      // 7. Delete services
      await tx.service.deleteMany({ where: { salonId } });
      // 8. Delete salon working hours
      await tx.salonWorkingHours.deleteMany({ where: { salonId } });
      // 9. Delete audit logs for this salon
      await tx.auditLog.deleteMany({ where: { salonId } });
      // 10. Delete salon admins (SALON_OWNER for this salon)
      await tx.admin.deleteMany({ where: { salonId, role: AdminRole.SALON_OWNER } });
      // 11. Finally, delete salon
      await tx.salon.delete({ where: { id: salonId } });
    });

    return { success: true, message: `Salon "${salon.name}" and all associated data permanently deleted.` };
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

  private hashToSignedInt32(input: string): number {
    return crypto.createHash('sha256').update(input).digest().readInt32BE(0);
  }

  async updateWorkingHours(salonId: string, dto: UpdateWorkingHoursDto) {
    const salon = await this.prisma.salon.findUnique({ where: { id: salonId } });
    if (!salon) throw new NotFoundException('Salon not found.');
    const tz = salon.timezone || 'Asia/Kolkata';

    return this.prisma.$transaction(async (tx) => {
      for (const item of dto.hours) {
        const isClosed = item.isClosed !== undefined ? item.isClosed : (item.isOpen !== undefined ? !item.isOpen : false);
        const startTime = item.startTime || item.openTime || '09:00';
        const endTime = item.endTime || item.closeTime || '21:00';

        if (startTime >= endTime) {
          throw new BadRequestException('Shift start time must be earlier than shift end time.');
        }

        // Validate break if provided
        if (item.breakStartTime || item.breakEndTime) {
          if (!item.breakStartTime || !item.breakEndTime) {
            throw new BadRequestException('Both break start time and break end time must be specified.');
          }
          if (item.breakStartTime >= item.breakEndTime) {
            throw new BadRequestException('Break start time must be earlier than break end time.');
          }
          if (item.breakStartTime <= startTime || item.breakEndTime >= endTime) {
            throw new BadRequestException('Break times must fall strictly within the salon operating shift.');
          }
          const [bStartH, bStartM] = item.breakStartTime.split(':').map(Number);
          const [bEndH, bEndM] = item.breakEndTime.split(':').map(Number);
          const breakDuration = (bEndH * 60 + bEndM) - (bStartH * 60 + bStartM);
          if (breakDuration < 15 || breakDuration % 15 !== 0) {
            throw new BadRequestException('Break duration must be at least 15 minutes and divisible by 15.');
          }
        }

        // Level 1: Acquire exclusive schedule lock for this salon and day
        const key1 = this.hashToSignedInt32(`salon:${salonId}`);
        const scheduleKey2 = this.hashToSignedInt32(`schedule:${item.dayOfWeek}`);
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(${key1}, ${scheduleKey2})`,
        );

        // Check active future appointments strictly for stylists who follow the salon schedule
        const now = new Date();
        const futureAppointments = await tx.appointment.findMany({
          where: {
            salonId,
            startAt: { gt: now },
            status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_SERVICE] },
            stylist: { followsSalonSchedule: true },
          },
          include: { stylist: true },
        });

        const dayAppointments = futureAppointments.filter((appt) => {
          const dayName = DateTime.fromJSDate(appt.startAt, { zone: tz }).toFormat('cccc').toUpperCase();
          return dayName === item.dayOfWeek;
        });

        if (isClosed) {
          if (dayAppointments.length > 0) {
            const conflicting = dayAppointments[0];
            throw new ConflictException(
              `Cannot close salon on ${item.dayOfWeek}: stylist ${conflicting.stylist.name} has existing future appointment #${conflicting.appointmentNumber}.`,
            );
          }
        } else {
          for (const appt of dayAppointments) {
            const apptStart = DateTime.fromJSDate(appt.startAt, { zone: tz }).toFormat('HH:mm');
            const apptEnd = DateTime.fromJSDate(appt.endAt, { zone: tz }).toFormat('HH:mm');

            if (apptStart < startTime || apptEnd > endTime) {
              throw new ConflictException(
                `Cannot update salon hours on ${item.dayOfWeek} to ${startTime}-${endTime}: future appointment #${appt.appointmentNumber} (${apptStart}-${apptEnd}) falls outside the operating window.`,
              );
            }

            if (item.breakStartTime && item.breakEndTime) {
              if (apptStart < item.breakEndTime && apptEnd > item.breakStartTime) {
                throw new ConflictException(
                  `Cannot set salon break on ${item.dayOfWeek} to ${item.breakStartTime}-${item.breakEndTime}: future appointment #${appt.appointmentNumber} (${apptStart}-${apptEnd}) conflicts with the break.`,
                );
              }
            }
          }
        }

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
