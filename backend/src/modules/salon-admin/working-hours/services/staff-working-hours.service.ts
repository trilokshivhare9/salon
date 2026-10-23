import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { DayOfWeek } from '@prisma/client';
import {
  UpdateStaffWorkingHoursDto,
} from '../dto/update-staff-working-hours.dto';
import { PatchStaffDayShiftDto } from '../dto/patch-staff-day-shift.dto';
import { WorkingHoursPropagationEngine } from './working-hours-propagation.engine';
import { AppointmentsService } from '../../appointments/appointments.service';
import { IStaffWorkingHoursResponse } from '../interfaces/working-hours.interface';

const DAY_ORDER: Record<DayOfWeek, number> = {
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
  SUNDAY: 7,
};

@Injectable()
export class StaffWorkingHoursService {
  private readonly logger = new Logger(StaffWorkingHoursService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly propagationEngine: WorkingHoursPropagationEngine,
    private readonly appointmentsService: AppointmentsService,
  ) {}

  /**
   * Retrieves all 7 days of working hours for a staff member,
   * enriched with facility boundary indicators (salonIsClosed, canWork) and breaks.
   */
  async getStaffWorkingHours(
    salonId: string,
    staffId: string,
  ): Promise<IStaffWorkingHoursResponse> {
    const stylist = await this.prisma.stylist.findFirst({
      where: { id: staffId, salonId },
    });
    if (!stylist) {
      throw new NotFoundException('Stylist not found in this salon.');
    }

    const [stylistHours, salonHours, stylistBreaks] = await Promise.all([
      this.prisma.stylistWorkingHours.findMany({
        where: { stylistId: staffId, salonId },
      }),
      this.prisma.salonWorkingHours.findMany({
        where: { salonId },
      }),
      this.prisma.stylistBreak.findMany({
        where: { stylistId: staffId, salonId },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      }),
    ]);

    const salonMap = new Map<DayOfWeek, any>(salonHours.map((sh) => [sh.dayOfWeek, sh]));

    const sortedHours = stylistHours.sort(
      (a, b) => (DAY_ORDER[a.dayOfWeek] || 0) - (DAY_ORDER[b.dayOfWeek] || 0),
    );

    const enrichedHours = sortedHours.map((sh) => {
      const salonDay = salonMap.get(sh.dayOfWeek);
      const salonIsClosed = salonDay ? Boolean(salonDay.isClosed) : false;
      const canWork = !salonIsClosed;

      return {
        id: sh.id,
        salonId: sh.salonId,
        stylistId: sh.stylistId,
        salonWorkingHoursId: sh.salonWorkingHoursId,
        dayOfWeek: sh.dayOfWeek,
        isWorking: sh.isWorking && canWork, // Hard boundary: if salon is closed, stylist cannot be active
        isCustomized: sh.isCustomized,
        startTime: sh.startTime,
        endTime: sh.endTime,
        salonIsClosed,
        canWork,
        breaks: stylistBreaks
          .filter((b) => b.dayOfWeek === sh.dayOfWeek)
          .map((b) => ({
            id: b.id,
            title: b.title,
            startTime: b.startTime,
            endTime: b.endTime,
            isCustomized: b.isCustomized,
          })),
        createdAt: sh.createdAt,
        updatedAt: sh.updatedAt,
      };
    });

    return {
      stylistId: stylist.id,
      stylistName: stylist.name,
      followsSalonSchedule: stylist.followsSalonSchedule,
      hours: enrichedHours,
    };
  }

  /**
   * Updates weekly working hours for a staff member.
   * Enforces RULE 1 (Facility Boundary): stylist cannot be scheduled if salon is closed.
   * Detects appointment conflicts before saving.
   */
  async updateStaffWorkingHours(
    salonId: string,
    staffId: string,
    dto: UpdateStaffWorkingHoursDto,
  ) {
    const stylist = await this.prisma.stylist.findFirst({
      where: { id: staffId, salonId },
    });
    if (!stylist) {
      throw new NotFoundException('Stylist not found in this salon.');
    }

    const salonHours = await this.prisma.salonWorkingHours.findMany({
      where: { salonId },
    });
    const salonMap = new Map<DayOfWeek, any>(salonHours.map((sh) => [sh.dayOfWeek, sh]));

    // 1. Validate facility boundaries & time ranges
    for (const item of dto.hours) {
      const salonDay = salonMap.get(item.dayOfWeek);
      const isWorking = item.isWorking !== undefined ? item.isWorking : true;

      if (isWorking && salonDay?.isClosed) {
        throw new BadRequestException(
          `Facility Boundary Error: Salon is closed on ${item.dayOfWeek}. Stylists cannot be scheduled to work when the salon is closed.`,
        );
      }

      if (isWorking && item.startTime && item.endTime) {
        if (item.startTime >= item.endTime) {
          throw new BadRequestException(
            `Shift start time (${item.startTime}) must be earlier than shift end time (${item.endTime}) on ${item.dayOfWeek}.`,
          );
        }

        const salonStart = salonDay?.startTime || '09:00';
        const salonEnd = salonDay?.endTime || '21:00';

        if (item.startTime < salonStart || item.endTime > salonEnd) {
          throw new BadRequestException(
            `Facility Boundary Error on ${item.dayOfWeek}: Stylist shift (${item.startTime} – ${item.endTime}) cannot extend outside salon facility operating hours (${salonStart} – ${salonEnd}). Stylists must work under salon hours.`,
          );
        }
      }
    }

    // 2. Persist in transaction
    const result = await this.prisma.$transaction(async (tx) => {
      const updatedHoursList: any[] = [];

      for (const item of dto.hours) {
        const salonDay = salonMap.get(item.dayOfWeek);
        const isWorking = item.isWorking !== undefined ? item.isWorking : true;
        const startTime = item.startTime || salonDay?.startTime || '09:00';
        const endTime = item.endTime || salonDay?.endTime || '21:00';

        // Check if differs from salon facility schedule
        const isDifferentFromSalon =
          !salonDay ||
          isWorking !== !salonDay.isClosed ||
          (startTime !== salonDay.startTime && !salonDay.isClosed) ||
          (endTime !== salonDay.endTime && !salonDay.isClosed);

        // Shifts that match salon facility operating hours are never customized
        // An explicit day off when salon is open is ALWAYS customized
        const isCustomized = !isWorking && !salonDay?.isClosed
          ? true
          : (item.isCustomized === false ? false : isDifferentFromSalon);

        const finalStartTime = !isCustomized && salonDay?.startTime ? salonDay.startTime : startTime;
        const finalEndTime = !isCustomized && salonDay?.endTime ? salonDay.endTime : endTime;
        const finalIsWorking = isWorking === false ? false : (!isCustomized && salonDay ? !salonDay.isClosed : isWorking);

        const updated = await tx.stylistWorkingHours.upsert({
          where: {
            stylistId_dayOfWeek: {
              stylistId: staffId,
              dayOfWeek: item.dayOfWeek,
            },
          },
          create: {
            salonId,
            stylistId: staffId,
            salonWorkingHoursId: salonDay?.id || null,
            dayOfWeek: item.dayOfWeek,
            isWorking: finalIsWorking,
            isCustomized,
            startTime: finalStartTime,
            endTime: finalEndTime,
          },
          update: {
            salonId,
            salonWorkingHoursId: salonDay?.id || null,
            isWorking: finalIsWorking,
            isCustomized,
            startTime: finalStartTime,
            endTime: finalEndTime,
          },
        });

        updatedHoursList.push(updated);
      }

      // Update followsSalonSchedule flag
      const followsSalonSchedule =
        dto.followsSalonSchedule !== undefined
          ? dto.followsSalonSchedule
          : updatedHoursList.every((h) => !h.isCustomized);

      await tx.stylist.update({
        where: { id: staffId },
        data: { followsSalonSchedule },
      });

      return updatedHoursList;
    });

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      staffId,
      action: 'WORKING_HOURS_UPDATED',
    });

    // Resolve any conflicting bookings in background and send WhatsApp reschedule proposal
    let totalAffected = 0;
    let totalRescheduled = 0;
    for (const item of dto.hours) {
      const isWorking = item.isWorking !== undefined ? item.isWorking : true;
      const res = await this.appointmentsService.resolveScheduleConflicts({
        salonId,
        scope: 'STYLIST',
        stylistId: staffId,
        dayOfWeek: item.dayOfWeek,
        shiftHours: { startTime: item.startTime, endTime: item.endTime },
        isClosedOrOff: !isWorking,
        reason: !isWorking ? `Stylist marked off on ${item.dayOfWeek}` : `Stylist shift updated on ${item.dayOfWeek}`,
      });
      totalAffected += res.totalAffected;
      totalRescheduled += res.rescheduledCount;
    }

    const statusMsg = totalAffected > 0
      ? `Working hours saved for ${stylist.name}. ${totalAffected} booking(s) automatically sent reschedule request via WhatsApp.`
      : `Working hours updated successfully for ${stylist.name}.`;

    return {
      success: true,
      message: statusMsg,
      stylistId: staffId,
      hours: result,
      affectedBookingsCount: totalAffected,
      rescheduledCount: totalRescheduled,
    };
  }

  /**
   * Patches a single day shift for a staff member (e.g., toggling day off, changing shift).
   */
  async patchStaffDayShift(
    salonId: string,
    staffId: string,
    dayOfWeek: DayOfWeek,
    dto: PatchStaffDayShiftDto,
  ) {
    const stylist = await this.prisma.stylist.findFirst({
      where: { id: staffId, salonId },
    });
    if (!stylist) {
      throw new NotFoundException('Stylist not found in this salon.');
    }

    const salonDay = await this.prisma.salonWorkingHours.findUnique({
      where: {
        salonId_dayOfWeek: {
          salonId,
          dayOfWeek,
        },
      },
    });

    const isWorking = dto.isWorking !== undefined ? dto.isWorking : true;

    // Facility boundary check
    if (isWorking && salonDay?.isClosed) {
      throw new BadRequestException(
        `Facility Boundary Error: Salon is closed on ${dayOfWeek}. Stylist cannot be scheduled to work.`,
      );
    }

    const currentShift = await this.prisma.stylistWorkingHours.findUnique({
      where: {
        stylistId_dayOfWeek: {
          stylistId: staffId,
          dayOfWeek,
        },
      },
    });

    const startTime = dto.startTime || currentShift?.startTime || salonDay?.startTime || '09:00';
    const endTime = dto.endTime || currentShift?.endTime || salonDay?.endTime || '21:00';

    if (isWorking) {
      if (salonDay?.isClosed) {
        throw new BadRequestException(
          `Facility Boundary Error: Salon is closed on ${dayOfWeek}. Stylists cannot be scheduled to work when the salon is closed.`,
        );
      }
      if (startTime >= endTime) {
        throw new BadRequestException(
          `Shift start time (${startTime}) must be earlier than shift end time (${endTime}) on ${dayOfWeek}.`,
        );
      }

      const salonStart = salonDay?.startTime || '09:00';
      const salonEnd = salonDay?.endTime || '21:00';

      if (startTime < salonStart || endTime > salonEnd) {
        throw new BadRequestException(
          `Facility Boundary Error on ${dayOfWeek}: Stylist shift (${startTime} – ${endTime}) cannot extend outside salon facility operating hours (${salonStart} – ${salonEnd}). Stylists must work under salon hours.`,
        );
      }
    }


    const isDifferentFromSalon =
      !salonDay ||
      isWorking !== !salonDay.isClosed ||
      (startTime !== salonDay.startTime && !salonDay.isClosed) ||
      (endTime !== salonDay.endTime && !salonDay.isClosed);

    // Shifts matching salon operating hours are never customized
    // An explicit day off when salon is open is ALWAYS customized
    const isCustomized = !isWorking && !salonDay?.isClosed
      ? true
      : (dto.isCustomized === false ? false : isDifferentFromSalon);
    const finalStartTime = !isCustomized && salonDay?.startTime ? salonDay.startTime : startTime;
    const finalEndTime = !isCustomized && salonDay?.endTime ? salonDay.endTime : endTime;
    const finalIsWorking = isWorking === false ? false : (!isCustomized && salonDay ? !salonDay.isClosed : isWorking);

    const updated = await this.prisma.stylistWorkingHours.upsert({
      where: {
        stylistId_dayOfWeek: {
          stylistId: staffId,
          dayOfWeek,
        },
      },
      create: {
        salonId,
        stylistId: staffId,
        salonWorkingHoursId: salonDay?.id || null,
        dayOfWeek,
        isWorking: finalIsWorking,
        isCustomized,
        startTime: finalStartTime,
        endTime: finalEndTime,
      },
      update: {
        salonId,
        salonWorkingHoursId: salonDay?.id || null,
        isWorking: finalIsWorking,
        isCustomized,
        startTime: finalStartTime,
        endTime: finalEndTime,
      },
    });

    // Check if any customized days remain to update followsSalonSchedule accurately
    const allStylistHours = await this.prisma.stylistWorkingHours.findMany({
      where: { stylistId: staffId },
    });
    const hasAnyCustomized = allStylistHours.some((h) => h.isCustomized);

    await this.prisma.stylist.update({
      where: { id: staffId },
      data: { followsSalonSchedule: !hasAnyCustomized },
    });

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      staffId,
      action: 'DAY_SHIFT_PATCHED',
      dayOfWeek,
    });

    // Resolve any conflicting bookings in background and send WhatsApp reschedule proposal
    const resolution = await this.appointmentsService.resolveScheduleConflicts({
      salonId,
      scope: 'STYLIST',
      stylistId: staffId,
      dayOfWeek,
      shiftHours: { startTime: finalStartTime, endTime: finalEndTime },
      isClosedOrOff: !finalIsWorking,
      reason: !finalIsWorking ? `Stylist marked off on ${dayOfWeek}` : `Stylist shift updated on ${dayOfWeek}`,
    });

    const statusMsg = resolution.totalAffected > 0
      ? `Shift for ${dayOfWeek} saved for ${stylist.name}. ${resolution.totalAffected} booking(s) automatically sent reschedule request via WhatsApp.`
      : `Shift for ${dayOfWeek} updated successfully for ${stylist.name}.`;

    return {
      success: true,
      message: statusMsg,
      dayShift: updated,
      affectedBookingsCount: resolution.totalAffected,
      rescheduledCount: resolution.rescheduledCount,
    };
  }

  /**
   * Resets all working hours of a staff member to cleanly mirror the salon facility schedule.
   */
  async resetStaffWorkingHours(salonId: string, staffId: string) {
    const stylist = await this.prisma.stylist.findFirst({
      where: { id: staffId, salonId },
    });
    if (!stylist) {
      throw new NotFoundException('Stylist not found in this salon.');
    }

    const salonHours = await this.prisma.salonWorkingHours.findMany({
      where: { salonId },
    });

    if (salonHours.length === 0) {
      throw new BadRequestException('No salon operating hours found to reset to.');
    }

    await this.prisma.$transaction(async (tx) => {
      // Delete existing rows and recreate from salonHours
      await tx.stylistWorkingHours.deleteMany({
        where: { stylistId: staffId, salonId },
      });

      await tx.stylistWorkingHours.createMany({
        data: salonHours.map((sh) => ({
          salonId,
          stylistId: staffId,
          salonWorkingHoursId: sh.id,
          dayOfWeek: sh.dayOfWeek,
          isWorking: !sh.isClosed,
          isCustomized: false,
          startTime: sh.startTime,
          endTime: sh.endTime,
        })),
      });

      await tx.stylist.update({
        where: { id: staffId },
        data: { followsSalonSchedule: true },
      });
    });

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      staffId,
      action: 'WORKING_HOURS_RESET',
    });

    return {
      success: true,
      message: `Working hours for ${stylist.name} reset to match salon schedule.`,
    };
  }
}
