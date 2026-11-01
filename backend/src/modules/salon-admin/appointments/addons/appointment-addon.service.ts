import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  Inject,
  forwardRef,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { AppointmentStatus } from '@prisma/client';
import { DateTime } from 'luxon';
import {
  appointmentInclude,
  formatAppointment,
} from '../utils/appointment-helpers';
import { AppointmentModifierService } from '../modifier/appointment-modifier.service';

@Injectable()
export class AppointmentAddonService {
  private readonly logger = new Logger(AppointmentAddonService.name);

  constructor(
    private prisma: PrismaService,
    @Optional()
    @Inject(forwardRef(() => AppointmentModifierService))
    private modifierService?: AppointmentModifierService,
  ) {}

  /**
   * Adds an add-on service to an active/in-service appointment, extending its duration.
   * Validates shift window limits and prevents collision with subsequent bookings.
   */
  async addServiceToAppointment(salonId: string, appointmentId: string, serviceId: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, salonId },
      include: appointmentInclude,
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found.');
    }

    const allowedStatuses: AppointmentStatus[] = [
      AppointmentStatus.CONFIRMED,
      AppointmentStatus.ON_THE_WAY,
      AppointmentStatus.CHECKED_IN,
      AppointmentStatus.SEATED_IN_CHAIR,
    ];
    if (!allowedStatuses.includes(appointment.status)) {
      throw new BadRequestException('No active confirmed appointment found for add-on modification.');
    }

    const extraService = await this.prisma.service.findFirst({
      where: { id: serviceId, salonId, status: 'ACTIVE' },
    });

    if (!extraService) {
      throw new NotFoundException('Service not found or inactive.');
    }

    const newEndAt = DateTime.fromJSDate(appointment.endAt)
      .plus({ minutes: extraService.durationMinutes })
      .toJSDate();

    // Check salon closing time and break window boundaries
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      include: { workingHours: true, salonBreaks: true },
    });
    const tz = salon?.timezone || 'Asia/Kolkata';
    const apptDt = DateTime.fromJSDate(appointment.startAt).setZone(tz);
    const dayOfWeek = apptDt.weekdayLong?.toUpperCase() as any;

    const workingHours = salon?.workingHours?.find((wh) => wh.dayOfWeek === dayOfWeek);

    if (workingHours && !workingHours.isClosed) {
      const [closeHour, closeMin] = workingHours.endTime.split(':').map(Number);
      const salonClosingAt = apptDt.set({ hour: closeHour, minute: closeMin, second: 0, millisecond: 0 }).toJSDate();

      if (newEndAt > salonClosingAt) {
        return {
          success: false,
          conflict: true,
          conflictBooking: {
            stylist: appointment.stylist,
            staff: appointment.stylist,
            stylistId: appointment.stylistId,
            name: 'Salon Closing Time',
          },
          extraService,
        };
      }
    }

    const activeBreaks = (salon?.salonBreaks || []).filter((b) => b.dayOfWeek === dayOfWeek);
    for (const b of activeBreaks) {
      const [bStartH, bStartM] = b.startTime.split(':').map(Number);
      const [bEndH, bEndM] = b.endTime.split(':').map(Number);
      const breakStartAt = apptDt.set({ hour: bStartH, minute: bStartM, second: 0, millisecond: 0 }).toJSDate();
      const breakEndAt = apptDt.set({ hour: bEndH, minute: bEndM, second: 0, millisecond: 0 }).toJSDate();

      if (newEndAt > breakStartAt && appointment.endAt < breakEndAt) {
        return {
          success: false,
          conflict: true,
          conflictBooking: {
            stylist: appointment.stylist,
            staff: appointment.stylist,
            stylistId: appointment.stylistId,
            name: b.title || 'Salon Break Time',
          },
          extraService,
        };
      }
    }

    // Check if stylist has conflicting appointment
    const conflictBooking = await this.prisma.appointment.findFirst({
      where: {
        salonId,
        stylistId: appointment.stylistId,
        appointmentDate: appointment.appointmentDate,
        id: { not: appointmentId },
        status: { in: [AppointmentStatus.BOOKED, AppointmentStatus.CONFIRMED, AppointmentStatus.ON_THE_WAY, AppointmentStatus.CHECKED_IN, AppointmentStatus.SEATED_IN_CHAIR] },
        startAt: { lt: newEndAt },
        endAt: { gt: appointment.endAt },
      },
      include: { stylist: true, service: true },
    });

    if (conflictBooking) {
      return {
        success: false,
        conflict: true,
        conflictBooking: {
          ...conflictBooking,
          staff: conflictBooking.stylist,
        },
        extraService,
      };
    }

    const existingServicesCount = await this.prisma.appointmentService.count({
      where: { salonId, appointmentId },
    });

    const updatedAppointment = await this.prisma.$transaction(async (tx) => {
      await tx.appointmentService.create({
        data: {
          salonId,
          appointmentId,
          serviceId: extraService.id,
          serviceNameSnapshot: extraService.name,
          durationMinutes: extraService.durationMinutes,
          price: extraService.price,
          orderIndex: existingServicesCount,
        },
      });

      return tx.appointment.update({
        where: { id: appointmentId },
        data: {
          endAt: newEndAt,
          durationMinutes: appointment.durationMinutes + extraService.durationMinutes,
          price: Number(appointment.price) + Number(extraService.price),
          serviceNameSnapshot: `${appointment.serviceNameSnapshot}, ${extraService.name}`,
        },
        include: appointmentInclude,
      });
    });

    if (this.modifierService) {
      await this.modifierService.syncAlarm(appointmentId);
    }

    const formatted = formatAppointment(updatedAppointment);
    return {
      success: true,
      updatedAppointment: {
        ...formatted,
        startTime: formatted.startAt,
        endTime: formatted.endAt,
        staff: formatted.stylist,
      },
      extraService,
    };
  }

  /**
   * Calculates the remaining continuous free time for the specialist assigned to an appointment,
   * taking into account their next upcoming booking, salon/stylist breaks, and salon closing time.
   * Returns a complete list of salon services flagged as eligible (fits within available window)
   * or ineligible (exceeds window).
   */
  async getEligibleAddonServices(salonId: string, appointmentId: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, salonId },
      include: {
        stylist: true,
        service: true,
        salon: {
          include: { workingHours: true, salonBreaks: true },
        },
      },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found.');
    }

    const tz = appointment.salon?.timezone || 'Asia/Kolkata';
    const apptEndDt = DateTime.fromJSDate(appointment.endAt).setZone(tz);
    const dayOfWeek = apptEndDt.weekdayLong?.toUpperCase() as any;

    // 1. Salon Closing Time
    const workingHours = appointment.salon?.workingHours?.find((wh) => wh.dayOfWeek === dayOfWeek);
    let salonClosingAt: Date | null = null;
    let salonClosingStr: string | null = null;
    if (workingHours && !workingHours.isClosed) {
      const [closeHour, closeMin] = workingHours.endTime.split(':').map(Number);
      const closeDt = apptEndDt.set({ hour: closeHour, minute: closeMin, second: 0, millisecond: 0 });
      salonClosingAt = closeDt.toJSDate();
      salonClosingStr = closeDt.toFormat('hh:mm a');
    }

    // 2. Next Salon / Staff Break
    const activeBreaks = (appointment.salon?.salonBreaks || []).filter((b) => b.dayOfWeek === dayOfWeek);
    let nextBreakAt: Date | null = null;
    let nextBreakTitle: string | null = null;
    let nextBreakStr: string | null = null;

    for (const b of activeBreaks) {
      const [bStartH, bStartM] = b.startTime.split(':').map(Number);
      const breakStartDt = apptEndDt.set({ hour: bStartH, minute: bStartM, second: 0, millisecond: 0 });
      const bDate = breakStartDt.toJSDate();
      if (bDate >= appointment.endAt) {
        if (!nextBreakAt || bDate < nextBreakAt) {
          nextBreakAt = bDate;
          nextBreakTitle = b.title || 'Salon Break';
          nextBreakStr = breakStartDt.toFormat('hh:mm a');
        }
      }
    }

    // 3. Next Appointment for the same Stylist
    let nextApptAt: Date | null = null;
    let nextApptInfo: any = null;
    let nextApptStr: string | null = null;

    if (appointment.stylistId) {
      const nextBooking = await this.prisma.appointment.findFirst({
        where: {
          salonId,
          stylistId: appointment.stylistId,
          appointmentDate: appointment.appointmentDate,
          id: { not: appointmentId },
          status: {
            in: [
              AppointmentStatus.BOOKED,
              AppointmentStatus.CONFIRMED,
              AppointmentStatus.ON_THE_WAY,
              AppointmentStatus.CHECKED_IN,
              AppointmentStatus.SEATED_IN_CHAIR,
            ],
          },
          startAt: { gte: appointment.endAt },
        },
        orderBy: { startAt: 'asc' },
        include: {
          salonUser: { include: { user: true } },
          service: true,
        },
      });

      if (nextBooking) {
        nextApptAt = nextBooking.startAt;
        const cName = nextBooking.salonUser?.user?.name || nextBooking.appointmentNumber || 'Next Client';
        nextApptStr = DateTime.fromJSDate(nextBooking.startAt).setZone(tz).toFormat('hh:mm a');
        nextApptInfo = {
          id: nextBooking.id,
          appointmentNumber: nextBooking.appointmentNumber,
          customerName: cName,
          serviceName: nextBooking.service?.name,
          startAt: nextBooking.startAt,
          timeStr: nextApptStr,
        };
      }
    }

    // 4. Determine Earliest Blocker
    let earliestBoundary: Date | null = null;
    let blockerType: 'APPOINTMENT' | 'BREAK' | 'CLOSING' | 'NONE' = 'NONE';
    let blockerTitle = 'No upcoming blockers today';
    let blockerTimeStr: string | null = null;

    if (nextApptAt) {
      earliestBoundary = nextApptAt;
      blockerType = 'APPOINTMENT';
      blockerTitle = `Next client: ${nextApptInfo.customerName}`;
      blockerTimeStr = nextApptStr;
    }

    if (nextBreakAt && (!earliestBoundary || nextBreakAt < earliestBoundary)) {
      earliestBoundary = nextBreakAt;
      blockerType = 'BREAK';
      blockerTitle = `Scheduled ${nextBreakTitle}`;
      blockerTimeStr = nextBreakStr;
    }

    if (salonClosingAt && (!earliestBoundary || salonClosingAt < earliestBoundary)) {
      earliestBoundary = salonClosingAt;
      blockerType = 'CLOSING';
      blockerTitle = 'Salon Closing';
      blockerTimeStr = salonClosingStr;
    }

    let maxContinuousMinutes = 0;
    if (earliestBoundary) {
      const diffMs = earliestBoundary.getTime() - appointment.endAt.getTime();
      maxContinuousMinutes = Math.max(0, Math.floor(diffMs / (60 * 1000)));
    } else {
      maxContinuousMinutes = 180; // If no boundaries exist, default to 3 hours
    }

    // 5. Fetch all Active Services
    const services = await this.prisma.service.findMany({
      where: { salonId, status: 'ACTIVE' },
      include: { serviceCategory: true },
      orderBy: [{ durationMinutes: 'asc' }, { price: 'asc' }],
    });

    const mappedServices = services.map((s) => {
      const isEligible = s.durationMinutes <= maxContinuousMinutes;
      const remainingAfter = maxContinuousMinutes - s.durationMinutes;
      let reason = '';
      if (isEligible) {
        reason = `Fits in slot (+${s.durationMinutes}m)`;
      } else if (maxContinuousMinutes === 0) {
        reason = `Back-to-back: ${blockerTitle} at ${blockerTimeStr}`;
      } else {
        reason = `Needs ${s.durationMinutes}m (only ${maxContinuousMinutes}m free before ${blockerTimeStr})`;
      }

      return {
        id: s.id,
        name: s.name,
        durationMinutes: s.durationMinutes,
        price: Number(s.price),
        categoryId: s.categoryId,
        categoryName: s.serviceCategory?.name || s.category || 'General',
        categoryIcon: s.serviceCategory?.icon || '✂️',
        isEligible,
        remainingAfter,
        reason,
      };
    });

    return {
      appointmentId,
      currentEndAt: appointment.endAt,
      currentEndTimeStr: apptEndDt.toFormat('hh:mm a'),
      stylist: appointment.stylist
        ? {
            id: appointment.stylist.id,
            name: appointment.stylist.name,
            profileImageUrl: appointment.stylist.profileImageUrl,
          }
        : null,
      maxContinuousMinutes,
      blocker: {
        type: blockerType,
        title: blockerTitle,
        timeStr: blockerTimeStr,
      },
      eligibleCount: mappedServices.filter((s) => s.isEligible).length,
      totalCount: mappedServices.length,
      services: mappedServices,
    };
  }
}
