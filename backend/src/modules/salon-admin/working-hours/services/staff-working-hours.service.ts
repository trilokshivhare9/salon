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

      if (isWorking && item.startTime && item.endTime && item.startTime >= item.endTime) {
        throw new BadRequestException(
          `Shift start time (${item.startTime}) must be earlier than shift end time (${item.endTime}) on ${item.dayOfWeek}.`,
        );
      }
    }

    // 2. Conflict checking against active appointments
    for (const item of dto.hours) {
      const isWorking = item.isWorking !== undefined ? item.isWorking : true;
      const conflicts = await this.propagationEngine.detectStaffShiftConflicts(
        this.prisma,
        salonId,
        staffId,
        item.dayOfWeek,
        isWorking,
        item.startTime,
        item.endTime,
      );

      if (conflicts.length > 0) {
        throw new ConflictException({
          message: `Cannot update schedule for ${item.dayOfWeek}: stylist has ${conflicts.length} confirmed appointment(s) that conflict with the new hours.`,
          conflicts,
        });
      }
    }

    // 3. Persist in transaction
    const result = await this.prisma.$transaction(async (tx) => {
      const updatedHoursList: any[] = [];

      for (const item of dto.hours) {
        const salonDay = salonMap.get(item.dayOfWeek);
        const isWorking = item.isWorking !== undefined ? item.isWorking : true;
        const startTime = item.startTime || salonDay?.startTime || '09:00';
        const endTime = item.endTime || salonDay?.endTime || '21:00';

        // Check if differs from salon to mark isCustomized
        const isDifferentFromSalon =
          !salonDay ||
          isWorking !== !salonDay.isClosed ||
          startTime !== salonDay.startTime ||
          endTime !== salonDay.endTime;

        const isCustomized =
          item.isCustomized !== undefined ? item.isCustomized : isDifferentFromSalon;

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
            isWorking,
            isCustomized,
            startTime,
            endTime,
          },
          update: {
            salonId,
            salonWorkingHoursId: salonDay?.id || null,
            isWorking,
            isCustomized,
            startTime,
            endTime,
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

    return {
      success: true,
      message: `Working hours updated successfully for ${stylist.name}.`,
      stylistId: staffId,
      hours: result,
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

    if (isWorking && startTime >= endTime) {
      throw new BadRequestException(
        `Shift start time (${startTime}) must be earlier than shift end time (${endTime}) on ${dayOfWeek}.`,
      );
    }

    // Conflict detection
    const conflicts = await this.propagationEngine.detectStaffShiftConflicts(
      this.prisma,
      salonId,
      staffId,
      dayOfWeek,
      isWorking,
      startTime,
      endTime,
    );

    if (conflicts.length > 0) {
      throw new ConflictException({
        message: `Cannot update ${dayOfWeek} shift: stylist has ${conflicts.length} active appointment(s) conflicting with this change.`,
        conflicts,
      });
    }

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
        isWorking,
        isCustomized: true, // Specific individual patch marks day customized
        startTime,
        endTime,
      },
      update: {
        salonId,
        salonWorkingHoursId: salonDay?.id || null,
        isWorking,
        isCustomized: true,
        startTime,
        endTime,
      },
    });

    // If customized, stylist no longer follows full salon schedule
    await this.prisma.stylist.update({
      where: { id: staffId },
      data: { followsSalonSchedule: false },
    });

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      staffId,
      action: 'DAY_SHIFT_PATCHED',
      dayOfWeek,
    });

    return {
      success: true,
      message: `Shift for ${dayOfWeek} updated successfully for ${stylist.name}.`,
      dayShift: updated,
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
