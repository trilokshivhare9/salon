import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service';
import { CreateSalonPlatformDto } from './dto/create-salon-platform.dto';
import { UpdateSalonDto } from './dto/update-salon.dto';
import { UpdateWorkingHoursDto, CreateSalonBreakDto, UpdateSalonBreakDto } from './dto/working-hours.dto';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { DateTime } from 'luxon';
import { TimeUtility } from '../../../common/utils/time.utility';
import { AdminRole, SalonStatus, StylistStatus, ServiceStatus, DayOfWeek, AppointmentStatus } from '@prisma/client';
import { WhatsAppService } from '../../channels/whatsapp/whatsapp.service';
import { AppointmentsService } from '../appointments/appointments.service';

@Injectable()
export class SalonsService {
  private readonly logger = new Logger(SalonsService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private whatsAppService: WhatsAppService,
    @Inject(forwardRef(() => AppointmentsService))
    private appointmentsService: AppointmentsService,
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

    const totalSalons = salons.length;
    const activeSalons = salons.filter((s) => s.status === SalonStatus.ACTIVE).length;
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
    let waId = dto.whatsappPhoneNumberId?.trim() || null;
    if (waId) {
      // Verify against Meta Graph API in real-time
      await this.verifyMetaPhoneNumberId(waId);

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

    const created = await this.prisma.$transaction(async (tx) => {
      // 1. Create Salon
      const salon = await tx.salon.create({
        data: {
          createdByAdminId: superAdminId,
          name: dto.name.trim(),
          slug,
          phone,
          email,
          address: dto.address?.trim() || null,
          city: dto.city.trim(),
          latitude: dto.latitude !== undefined && dto.latitude !== null ? Number(dto.latitude) : null,
          longitude: dto.longitude !== undefined && dto.longitude !== null ? Number(dto.longitude) : null,
          googleMapsUrl: dto.googleMapsUrl?.trim() || null,
          locationType: dto.locationType || 'MANUAL',
          timezone: dto.timezone || TimeUtility.DEFAULT_TIMEZONE,
          status: SalonStatus.INACTIVE, // ARCHITECTURAL RULE: Newly registered salon starts INACTIVE until >= 1 stylist & >= 1 service are configured
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

      // 3. Seed 7-Day Operating Hours (using dto.schedule if provided, otherwise default hours)
      if (Array.isArray(dto.schedule) && dto.schedule.length > 0) {
        for (const item of dto.schedule) {
          const isClosed = item.isClosed !== undefined ? item.isClosed : item.dayOfWeek === DayOfWeek.TUESDAY;
          const sTime = item.startTime || openTime;
          const eTime = item.endTime || closeTime;
          const breaksToSave = (Array.isArray(item.breaks) && !isClosed)
            ? item.breaks.map((b: any) => ({
              id: b.id || crypto.randomUUID(),
              startTime: b.startTime,
              endTime: b.endTime,
              title: b.title || 'Lunch Break',
            }))
            : [];

          await tx.salonWorkingHours.create({
            data: {
              salonId: salon.id,
              dayOfWeek: item.dayOfWeek,
              isClosed,
              startTime: sTime,
              endTime: eTime,
            },
          });

          for (const b of breaksToSave) {
            await tx.salonBreak.create({
              data: {
                salonId: salon.id,
                dayOfWeek: item.dayOfWeek,
                title: b.title || 'Salon Break',
                startTime: b.startTime,
                endTime: b.endTime,
              },
            });
          }
        }
      } else {
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
              isClosed: day === DayOfWeek.TUESDAY,
              startTime: openTime,
              endTime: closeTime,
            },
          });
        }
      }

      // 4. Configure WhatsApp Meta Account if waId is present
      if (waId) {
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
        address: salon.address,
        city: salon.city,
        latitude: salon.latitude,
        longitude: salon.longitude,
        googleMapsUrl: salon.googleMapsUrl,
        locationType: salon.locationType,
        timezone: salon.timezone,
        openTime,
        closeTime,
        status: salon.status,
        bookingUrl: `/#book/${salon.slug}`,
        stylistsCount: 0,
        servicesCount: 0,
        whatsappPhoneNumberId: waId,
      };
    }, { maxWait: 15000, timeout: 35000 });

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

  async getDeactivationPreview(salonId: string) {
    const salon = await this.prisma.salon.findUnique({ where: { id: salonId } });
    if (!salon) throw new NotFoundException('Salon not found.');

    const { startOfDay: startOfToday } = TimeUtility.getDayBoundaries(undefined, salon.timezone);

    const activeBookings = await this.prisma.appointment.findMany({
      where: {
        salonId,
        status: { in: [AppointmentStatus.BOOKED, AppointmentStatus.CONFIRMED, AppointmentStatus.ON_THE_WAY, AppointmentStatus.CHECKED_IN, AppointmentStatus.SEATED_IN_CHAIR] },
        appointmentDate: { gte: startOfToday },
      },
      include: {
        salonUser: { include: { user: { select: { id: true, name: true, phone: true } } } },
        service: { select: { id: true, name: true } },
        stylist: { select: { id: true, name: true } },
      },
      orderBy: { appointmentDate: 'asc' },
    });

    const inServiceCount = activeBookings.filter((b) => b.status === AppointmentStatus.SEATED_IN_CHAIR).length;

    return {
      salonId,
      salonName: salon.name,
      currentStatus: salon.status,
      activeBookingsCount: activeBookings.length,
      inServiceCount,
      activeBookings,
    };
  }

  async toggleSalonStatus(salonId: string, forceCancel = false) {
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      include: { whatsappAccount: true },
    });
    if (!salon) throw new NotFoundException('Salon not found.');

    // If salon is currently ACTIVE and Super Admin is attempting to DEACTIVATE it
    if (salon.status === SalonStatus.ACTIVE) {
      const { startOfDay: startOfToday } = TimeUtility.getDayBoundaries(undefined, salon.timezone);

      const activeBookings = await this.prisma.appointment.findMany({
        where: {
          salonId,
          status: { in: [AppointmentStatus.BOOKED, AppointmentStatus.CONFIRMED, AppointmentStatus.ON_THE_WAY, AppointmentStatus.CHECKED_IN, AppointmentStatus.SEATED_IN_CHAIR] },
          appointmentDate: { gte: startOfToday },
        },
        include: {
          salonUser: { include: { user: true } },
          service: true,
        },
      });

      if (activeBookings.length > 0) {
        if (!forceCancel) {
          throw new ConflictException({
            message: `Salon "${salon.name}" has ${activeBookings.length} active/future booking(s). All future bookings must be cancelled before deactivation.`,
            activeBookingsCount: activeBookings.length,
            requiresConfirmation: true,
          });
        }

        // Execute bulk cancellation for all active/future bookings
        this.logger.warn(
          `[SalonsService] Executing bulk deactivation cancellation for ${activeBookings.length} booking(s) on salon "${salon.name}" (${salon.id})...`,
        );

        for (const booking of activeBookings) {
          try {
            await this.appointmentsService.cancelBooking(salonId, booking.id, {
              source: 'SYSTEM_SALON_DEACTIVATION',
              fault: 'SYSTEM',
              reason: 'Salon Account Deactivated by Platform Super Admin',
              skipMoveUp: true,
            });
          } catch (err: any) {
            this.logger.warn(`Failed to cancel booking ${booking.id} during deactivation: ${err.message}`);
          }
        }
      }

      // Transition status to DEACTIVATED
      return this.prisma.salon.update({
        where: { id: salonId },
        data: { status: SalonStatus.DEACTIVATED },
      });
    } else {
      // Re-activating salon: dynamically evaluate operational readiness
      const [activeStylistCount, activeServiceCount] = await Promise.all([
        this.prisma.stylist.count({ where: { salonId, status: StylistStatus.ACTIVE } }),
        this.prisma.service.count({ where: { salonId, status: ServiceStatus.ACTIVE } }),
      ]);
      const meetsRequirements = activeStylistCount >= 1 && activeServiceCount >= 1;
      return this.prisma.salon.update({
        where: { id: salonId },
        data: { status: meetsRequirements ? SalonStatus.ACTIVE : SalonStatus.INACTIVE },
      });
    }
  }

  async deleteSalonBySuperAdmin(salonId: string) {
    const salon = await this.prisma.salon.findUnique({ where: { id: salonId } });
    if (!salon) throw new NotFoundException('Salon not found.');

    await this.prisma.$transaction(async (tx) => {
      // 1. Delete notifications for this salon
      await tx.notification.deleteMany({ where: { salonId } });
      // 2. Delete appointment services & appointments
      await tx.appointmentService.deleteMany({ where: { salonId } });
      await tx.appointment.deleteMany({ where: { salonId } });
      // 3. Delete conversations
      await tx.conversation.deleteMany({ where: { salonId } });
      // 4. Delete whatsApp logs & account
      await tx.whatsAppLog.deleteMany({ where: { salonId } });
      await tx.whatsAppAccount.deleteMany({ where: { salonId } });
      // 5. Delete salon users (customers linked to this salon)
      await tx.salonUser.deleteMany({ where: { salonId } });
      // 6. Delete stylist working hours, services, absences & stylists
      await tx.stylistWorkingHours.deleteMany({ where: { stylist: { salonId } } });
      await tx.stylistService.deleteMany({ where: { stylist: { salonId } } });
      await tx.stylistAbsence.deleteMany({ where: { salonId } });
      await tx.stylist.deleteMany({ where: { salonId } });
      // 7. Delete services & categories
      await tx.service.deleteMany({ where: { salonId } });
      await tx.serviceCategory.deleteMany({ where: { salonId } });
      // 8. Delete salon closures, quick codes & working hours
      await tx.salonClosure.deleteMany({ where: { salonId } });
      await tx.salonQuickCode.deleteMany({ where: { salonId } });
      await tx.salonWorkingHours.deleteMany({ where: { salonId } });
      // 9. Delete audit logs & error logs for this salon
      await tx.auditLog.deleteMany({ where: { salonId } });
      await tx.errorLog.deleteMany({ where: { salonId } });
      // 10. Delete salon admins & user sessions
      const superAdmin = await tx.admin.findFirst({ where: { role: AdminRole.SUPER_ADMIN } });
      if (superAdmin && salon.createdByAdminId !== superAdmin.id) {
        await tx.salon.update({
          where: { id: salonId },
          data: { createdByAdminId: superAdmin.id },
        });
      }
      await tx.userSession.deleteMany({ where: { admin: { salonId } } });
      await tx.admin.deleteMany({ where: { salonId, role: AdminRole.SALON_OWNER } });
      // 11. Finally, delete salon
      await tx.salon.delete({ where: { id: salonId } });
    }, { maxWait: 15000, timeout: 35000 });

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
    const [hours, breaks] = await Promise.all([
      this.prisma.salonWorkingHours.findMany({
        where: { salonId },
        orderBy: { dayOfWeek: 'asc' },
      }),
      this.prisma.salonBreak.findMany({
        where: { salonId },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      }),
    ]);

    return hours.map((h) => ({
      ...h,
      breaks: breaks
        .filter((b) => b.dayOfWeek === h.dayOfWeek)
        .map((b) => ({
          id: b.id,
          title: b.title,
          startTime: b.startTime,
          endTime: b.endTime,
        })),
    }));
  }

  private hashToSignedInt32(input: string): number {
    return crypto.createHash('sha256').update(input).digest().readInt32BE(0);
  }

  async updateWorkingHours(salonId: string, dto: UpdateWorkingHoursDto) {
    const salon = await this.prisma.salon.findUnique({ where: { id: salonId } });
    if (!salon) throw new NotFoundException('Salon not found.');
    const tz = salon.timezone || TimeUtility.DEFAULT_TIMEZONE;

    return this.prisma.$transaction(async (tx) => {
      for (const item of dto.hours) {
        const isClosed = item.isClosed !== undefined ? item.isClosed : (item.isOpen !== undefined ? !item.isOpen : false);
        let startTime = item.startTime || item.openTime || '09:00';
        let endTime = item.endTime || item.closeTime || '21:00';

        let breaksToSave: any[] = [];
        if (item.breaks && item.breaks.length > 0) {
          for (const b of item.breaks) {
            if (b.startTime >= b.endTime) {
              throw new BadRequestException(`Break start time ${b.startTime} must be earlier than break end time ${b.endTime}.`);
            }
            // Seamless Operating Schedule Harmonization:
            // If an admin schedules a facility break on a day, ensure the operating window accommodates the break
            // so routine breaks are never dropped or rejected.
            if (!isClosed) {
              if (b.startTime < startTime) startTime = b.startTime;
              if (b.endTime > endTime) endTime = b.endTime;
            }
            breaksToSave.push({
              id: b.id || crypto.randomUUID(),
              startTime: b.startTime,
              endTime: b.endTime,
              title: b.title || 'Lunch Break',
            });
          }
        }

        if (startTime >= endTime) {
          throw new BadRequestException('Shift start time must be earlier than shift end time.');
        }

        // Level 1: Acquire exclusive schedule lock for this salon and day
        const key1 = this.hashToSignedInt32(`salon:${salonId}`);
        const scheduleKey2 = this.hashToSignedInt32(`schedule:${item.dayOfWeek}`);
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(${key1}, ${scheduleKey2})`,
        );

        // Check active future appointments across all stylists for salon-level facility collisions
        const now = new Date();
        const futureAppointments = await tx.appointment.findMany({
          where: {
            salonId,
            startAt: { gt: now },
            status: { in: [AppointmentStatus.BOOKED, AppointmentStatus.CONFIRMED, AppointmentStatus.ON_THE_WAY, AppointmentStatus.CHECKED_IN, AppointmentStatus.SEATED_IN_CHAIR] },
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

            for (const b of breaksToSave) {
              if (apptStart < b.endTime && apptEnd > b.startTime) {
                if (dto.autoReschedule) {
                  await tx.appointment.update({
                    where: { id: appt.id },
                    data: { status: AppointmentStatus.PENDING_RESCHEDULE },
                  });
                } else {
                  throw new ConflictException(
                    `Cannot set salon break on ${item.dayOfWeek} to ${b.startTime}-${b.endTime}: future appointment #${appt.appointmentNumber} (${apptStart}-${apptEnd}) conflicts with the break. Enable auto-reschedule to automatically notify the client.`,
                  );
                }
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
          },
          create: {
            salonId,
            dayOfWeek: item.dayOfWeek,
            isClosed,
            startTime,
            endTime,
          },
        });

        // Sync to first-class SalonBreak table and propagate to stylists
        if (item.breaks !== undefined) {
          const existingSalonBreaks = await tx.salonBreak.findMany({
            where: { salonId, dayOfWeek: item.dayOfWeek },
          });

          // Delete breaks that are no longer in breaksToSave
          for (const ex of existingSalonBreaks) {
            const stillExists = breaksToSave.some(
              (b) => b.startTime === ex.startTime && b.endTime === ex.endTime,
            );
            if (!stillExists) {
              await tx.stylistBreak.deleteMany({
                where: { salonBreakId: ex.id, isCustomized: false },
              });
              await tx.stylistBreak.updateMany({
                where: { salonBreakId: ex.id, isCustomized: true },
                data: { salonBreakId: null },
              });
              await tx.salonBreak.delete({ where: { id: ex.id } });
            }
          }

          // Add new breaks and propagate
          const stylists = await tx.stylist.findMany({ where: { salonId } });
          for (const b of breaksToSave) {
            const alreadyExists = existingSalonBreaks.find(
              (ex) => ex.startTime === b.startTime && ex.endTime === b.endTime,
            );
            if (!alreadyExists) {
              const newSb = await tx.salonBreak.create({
                data: {
                  salonId,
                  dayOfWeek: item.dayOfWeek,
                  title: b.title || 'Salon Break',
                  startTime: b.startTime,
                  endTime: b.endTime,
                },
              });

              for (const st of stylists) {
                const stBreaks = await tx.stylistBreak.findMany({
                  where: { stylistId: st.id, dayOfWeek: item.dayOfWeek },
                });
                const hasOverlap = stBreaks.some(
                  (sb) => sb.startTime < b.endTime && sb.endTime > b.startTime,
                );
                if (!hasOverlap) {
                  await tx.stylistBreak.create({
                    data: {
                      salonId,
                      stylistId: st.id,
                      salonBreakId: newSb.id,
                      dayOfWeek: item.dayOfWeek,
                      title: b.title || 'Salon Break',
                      startTime: b.startTime,
                      endTime: b.endTime,
                      isCustomized: false,
                    },
                  });
                }
              }
            }
          }
        }
      }

      const [finalHours, finalBreaks] = await Promise.all([
        tx.salonWorkingHours.findMany({
          where: { salonId },
          orderBy: { dayOfWeek: 'asc' },
        }),
        tx.salonBreak.findMany({
          where: { salonId },
          orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
        }),
      ]);

      return finalHours.map((h) => ({
        ...h,
        breaks: finalBreaks
          .filter((b) => b.dayOfWeek === h.dayOfWeek)
          .map((b) => ({
            id: b.id,
            title: b.title,
            startTime: b.startTime,
            endTime: b.endTime,
          })),
      }));
    }, { maxWait: 15000, timeout: 35000 });
  }

  // -------------------------------------------------------------
  // SALON MASTER BREAKS & PROPAGATION MANAGEMENT
  // -------------------------------------------------------------
  async getSalonBreaks(salonId: string) {
    return this.prisma.salonBreak.findMany({
      where: { salonId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
  }

  async createSalonBreak(salonId: string, dto: CreateSalonBreakDto) {
    const salon = await this.prisma.salon.findUnique({ where: { id: salonId } });
    if (!salon) throw new NotFoundException('Salon not found.');

    if (dto.startTime >= dto.endTime) {
      throw new BadRequestException('Break start time must be earlier than break end time.');
    }

    const [bStartH, bStartM] = dto.startTime.split(':').map(Number);
    const [bEndH, bEndM] = dto.endTime.split(':').map(Number);
    const breakDuration = (bEndH * 60 + bEndM) - (bStartH * 60 + bStartM);
    if (breakDuration < 15 || breakDuration % 15 !== 0) {
      throw new BadRequestException('Break duration must be at least 15 minutes and divisible by 15.');
    }

    // 1. Check if an identical break already exists at salon level
    const existing = await this.prisma.salonBreak.findFirst({
      where: {
        salonId,
        dayOfWeek: dto.dayOfWeek,
        startTime: dto.startTime,
        endTime: dto.endTime,
      },
    });
    if (existing) {
      throw new ConflictException('An identical salon break already exists for this day and time window.');
    }

    // 2. Create the master SalonBreak
    const salonBreak = await this.prisma.salonBreak.create({
      data: {
        salonId,
        dayOfWeek: dto.dayOfWeek,
        title: dto.title || 'Salon Break',
        startTime: dto.startTime,
        endTime: dto.endTime,
      },
    });

    // 3. Smart Propagation: Propagate to stylists in the salon
    const stylists = await this.prisma.stylist.findMany({ where: { salonId } });
    const skippedStylists: string[] = [];

    for (const st of stylists) {
      // Check if this stylist already has an overlapping break on this dayOfWeek
      const existingBreaks = await this.prisma.stylistBreak.findMany({
        where: { stylistId: st.id, dayOfWeek: dto.dayOfWeek },
      });

      const hasOverlap = existingBreaks.some(
        (b) => b.startTime < dto.endTime && b.endTime > dto.startTime,
      );

      if (hasOverlap) {
        skippedStylists.push(st.name);
        continue; // Skip copying to avoid collision on customized stylist!
      }

      await this.prisma.stylistBreak.create({
        data: {
          salonId,
          stylistId: st.id,
          salonBreakId: salonBreak.id,
          dayOfWeek: dto.dayOfWeek,
          title: dto.title || 'Salon Break',
          startTime: dto.startTime,
          endTime: dto.endTime,
          isCustomized: false,
        },
      });
    }

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      action: 'CREATE_SALON_BREAK',
      breakId: salonBreak.id,
    });

    return {
      salonBreak,
      skippedStylists,
    };
  }

  async updateSalonBreak(salonId: string, breakId: string, dto: UpdateSalonBreakDto) {
    const existingBreak = await this.prisma.salonBreak.findUnique({
      where: { id: breakId },
    });
    if (!existingBreak || existingBreak.salonId !== salonId) {
      throw new NotFoundException('Salon break not found.');
    }

    const newStart = dto.startTime || existingBreak.startTime;
    const newEnd = dto.endTime || existingBreak.endTime;
    const newTitle = dto.title || existingBreak.title;

    if (newStart >= newEnd) {
      throw new BadRequestException('Break start time must be earlier than break end time.');
    }

    // 1. Update the master SalonBreak
    const updated = await this.prisma.salonBreak.update({
      where: { id: breakId },
      data: {
        startTime: newStart,
        endTime: newEnd,
        title: newTitle,
      },
    });

    // 2. Smart Propagation: Update all linked stylist breaks where isCustomized is FALSE
    await this.prisma.stylistBreak.updateMany({
      where: {
        salonBreakId: breakId,
        isCustomized: false,
      },
      data: {
        startTime: newStart,
        endTime: newEnd,
        title: newTitle,
      },
    });

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      action: 'UPDATE_SALON_BREAK',
      breakId,
    });

    return updated;
  }

  async deleteSalonBreak(salonId: string, breakId: string) {
    const existingBreak = await this.prisma.salonBreak.findUnique({
      where: { id: breakId },
    });
    if (!existingBreak || existingBreak.salonId !== salonId) {
      throw new NotFoundException('Salon break not found.');
    }

    // 1. Smart Propagation: Delete non-customized stylist breaks
    await this.prisma.stylistBreak.deleteMany({
      where: {
        salonBreakId: breakId,
        isCustomized: false,
      },
    });

    // 2. For customized stylist breaks, detach them so they become personal breaks
    await this.prisma.stylistBreak.updateMany({
      where: {
        salonBreakId: breakId,
        isCustomized: true,
      },
      data: {
        salonBreakId: null,
      },
    });

    // 3. Delete master SalonBreak
    await this.prisma.salonBreak.delete({
      where: { id: breakId },
    });

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      action: 'DELETE_SALON_BREAK',
      breakId,
    });

    return { success: true };
  }

}
