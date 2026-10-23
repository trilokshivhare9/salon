import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { DayOfWeek, AppointmentStatus } from '@prisma/client';
import { DateTime } from 'luxon';
import { TimeUtility } from '../../../../common/utils/time.utility';
import { IWorkingHoursPropagationResult } from '../interfaces/working-hours.interface';

@Injectable()
export class WorkingHoursPropagationEngine {
  private readonly logger = new Logger(WorkingHoursPropagationEngine.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Initializes 7 concrete working hours rows for a newly created stylist,
   * cleanly cloned from the salon's facility operating hours.
   */
  async initializeStylistWorkingHours(
    tx: any,
    salonId: string,
    stylistId: string,
  ): Promise<number> {
    const salonHours = await tx.salonWorkingHours.findMany({
      where: { salonId },
    });

    if (!salonHours || salonHours.length === 0) {
      this.logger.warn(`No salon working hours found for salon ${salonId} to clone to stylist ${stylistId}`);
      return 0;
    }

    const dataToInsert = salonHours.map((sh: any) => ({
      salonId,
      stylistId,
      salonWorkingHoursId: sh.id,
      dayOfWeek: sh.dayOfWeek,
      isWorking: !sh.isClosed,
      isCustomized: false,
      startTime: sh.startTime,
      endTime: sh.endTime,
    }));

    await tx.stylistWorkingHours.createMany({
      data: dataToInsert,
      skipDuplicates: true,
    });

    this.logger.log(
      `Cloned ${dataToInsert.length} salon working hours rows for new stylist ${stylistId} in salon ${salonId}`,
    );
    return dataToInsert.length;
  }

  /**
   * Propagates salon facility operating hour changes to all stylists in the salon.
   * - Enforces HARD FACILITY BOUNDARY: If salon is closed on a day, all stylists are forced off.
   * - Updates uncustomized stylists (isCustomized === false) to mirror the new hours.
   * - Respects customized stylist shifts (isCustomized === true) when salon is open.
   */
  async propagateSalonHoursToStylists(
    tx: any,
    salonId: string,
    updatedSalonHours: Array<{
      id: string;
      dayOfWeek: DayOfWeek;
      isClosed: boolean;
      startTime: string;
      endTime: string;
    }>,
  ): Promise<IWorkingHoursPropagationResult> {
    const result: IWorkingHoursPropagationResult = {
      updatedStylistsCount: 0,
      updatedDaysCount: 0,
      enforcedClosedDaysCount: 0,
    };

    const stylists = await tx.stylist.findMany({
      where: { salonId },
      select: { id: true, name: true, followsSalonSchedule: true },
    });

    if (stylists.length === 0) {
      return result;
    }

    const stylistIds = stylists.map((s: any) => s.id);
    const affectedStylistIds = new Set<string>();

    for (const sh of updatedSalonHours) {
      if (sh.isClosed) {
        // FACILITY BOUNDARY: Salon is closed -> Stylists CANNOT work.
        // Sync uncustomized staff members to isWorking = false without altering isCustomized
        const closedUpdate = await tx.stylistWorkingHours.updateMany({
          where: {
            salonId,
            dayOfWeek: sh.dayOfWeek,
            isCustomized: false,
          },
          data: {
            isWorking: false,
            salonWorkingHoursId: sh.id,
          },
        });

        if (closedUpdate.count > 0) {
          result.enforcedClosedDaysCount += closedUpdate.count;
          stylistIds.forEach((id: string) => affectedStylistIds.add(id));
        }

        // Ensure salonWorkingHoursId is linked for customized records without mutating their custom blueprint
        await tx.stylistWorkingHours.updateMany({
          where: {
            salonId,
            dayOfWeek: sh.dayOfWeek,
            isCustomized: true,
          },
          data: {
            salonWorkingHoursId: sh.id,
          },
        });
      } else {
        // Salon is OPEN -> Sync uncustomized staff members (isCustomized === false)
        // Automatically restore uncustomized stylists to isWorking = true with salon hours!
        const syncUpdate = await tx.stylistWorkingHours.updateMany({
          where: {
            salonId,
            dayOfWeek: sh.dayOfWeek,
            isCustomized: false,
          },
          data: {
            isWorking: true,
            startTime: sh.startTime,
            endTime: sh.endTime,
            salonWorkingHoursId: sh.id,
          },
        });

        if (syncUpdate.count > 0) {
          result.updatedDaysCount += syncUpdate.count;
          stylistIds.forEach((id: string) => affectedStylistIds.add(id));
        }

        // Also ensure salonWorkingHoursId is linked even for customized records
        await tx.stylistWorkingHours.updateMany({
          where: {
            salonId,
            dayOfWeek: sh.dayOfWeek,
            isCustomized: true,
          },
          data: {
            salonWorkingHoursId: sh.id,
          },
        });

        // Enforce Facility Boundary: clamp any customized shifts extending outside salon hours
        await tx.stylistWorkingHours.updateMany({
          where: {
            salonId,
            dayOfWeek: sh.dayOfWeek,
            isCustomized: true,
            endTime: { gt: sh.endTime },
          },
          data: {
            endTime: sh.endTime,
          },
        });

        await tx.stylistWorkingHours.updateMany({
          where: {
            salonId,
            dayOfWeek: sh.dayOfWeek,
            isCustomized: true,
            startTime: { lt: sh.startTime },
          },
          data: {
            startTime: sh.startTime,
          },
        });
      }
    }

    result.updatedStylistsCount = affectedStylistIds.size;
    return result;
  }

  /**
   * Validates if a stylist can work on a given day, checking against salon facility operating status.
   */
  async validateStaffDayAgainstSalon(
    tx: any,
    salonId: string,
    dayOfWeek: DayOfWeek,
    isWorking: boolean,
  ): Promise<{ salonIsClosed: boolean; salonHours: any }> {
    const salonHour = await tx.salonWorkingHours.findUnique({
      where: {
        salonId_dayOfWeek: {
          salonId,
          dayOfWeek,
        },
      },
    });

    const salonIsClosed = salonHour ? salonHour.isClosed : false;

    if (isWorking && salonIsClosed) {
      throw new ConflictException(
        `Facility Closed: The salon is closed on ${dayOfWeek}. Stylists cannot be scheduled to work when the facility is closed.`,
      );
    }

    return { salonIsClosed, salonHours: salonHour };
  }
}

