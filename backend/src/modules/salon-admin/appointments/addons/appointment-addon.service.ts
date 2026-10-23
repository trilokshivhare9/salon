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
}
