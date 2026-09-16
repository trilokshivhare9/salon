import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../../../database/prisma.service';
import { MarkAbsentDto, PreviewAbsenceQueryDto, ExtendLeaveDto } from '../dto/absence.dto';
import { LeavePortion } from '@prisma/client';

export interface NormalizedLeaveDates {
  startIso: string;
  endIso: string;
  startDateParsed: DateTime;
  endDateParsed: DateTime;
  startDateObj: Date;
  endDateObj: Date;
}

@Injectable()
export class LeaveValidationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validates stylist existence and salon membership.
   */
  async validateStylistAndSalon(salonId: string, stylistId: string) {
    const stylist = await this.prisma.stylist.findFirst({
      where: { id: stylistId, salonId },
      select: { id: true, name: true, phone: true, followsSalonSchedule: true },
    });
    if (!stylist) {
      throw new NotFoundException('Stylist not found in this salon.');
    }

    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
    });
    if (!salon) {
      throw new NotFoundException('Salon not found.');
    }

    return { stylist, salon, timezone: salon.timezone || 'Asia/Kolkata' };
  }

  /**
   * Normalizes and validates date range parameters from MarkAbsentDto / PreviewAbsenceQueryDto.
   */
  validateAndNormalizeDates(
    dto: { startDate?: string; endDate?: string; date?: string },
    timezone: string,
    allowPastDates = false,
  ): NormalizedLeaveDates {
    const startIso = (dto.startDate || dto.date || '').split('T')[0];
    const endIso = (dto.endDate || dto.startDate || dto.date || '').split('T')[0];

    if (!startIso || !endIso) {
      throw new BadRequestException('At least one valid date (date, startDate, or endDate) must be provided.');
    }

    const startDateParsed = DateTime.fromISO(startIso, { zone: timezone }).startOf('day');
    const endDateParsed = DateTime.fromISO(endIso, { zone: timezone }).startOf('day');

    if (!startDateParsed.isValid || !endDateParsed.isValid) {
      throw new BadRequestException('Invalid date. Format must be YYYY-MM-DD.');
    }

    if (endDateParsed < startDateParsed) {
      throw new BadRequestException('End date cannot be earlier than start date.');
    }

    if (!allowPastDates) {
      const todayInSalon = DateTime.now().setZone(timezone).startOf('day');
      if (endDateParsed < todayInSalon) {
        throw new BadRequestException('Cannot mark leave for past dates.');
      }
    }

    const startDateObj = new Date(`${startIso}T00:00:00.000Z`);
    const endDateObj = new Date(`${endIso}T00:00:00.000Z`);

    return {
      startIso,
      endIso,
      startDateParsed,
      endDateParsed,
      startDateObj,
      endDateObj,
    };
  }

  /**
   * Validates CUSTOM_HOURS leave portion parameters.
   */
  validateLeavePortion(leavePortion?: LeavePortion, customStartTime?: string, customEndTime?: string): void {
    if (leavePortion === LeavePortion.CUSTOM_HOURS) {
      if (!customStartTime || !customEndTime) {
        throw new BadRequestException('customStartTime and customEndTime are required for CUSTOM_HOURS leave portion.');
      }
      const [sh, sm] = customStartTime.split(':').map((v) => parseInt(v, 10));
      const [eh, em] = customEndTime.split(':').map((v) => parseInt(v, 10));
      const sMin = sh * 60 + sm;
      const eMin = eh * 60 + em;
      if (sMin >= eMin) {
        throw new BadRequestException('customStartTime must be strictly before customEndTime.');
      }
    }
  }

  /**
   * Validates leave extension parameters against an existing leave record.
   */
  validateLeaveExtension(existingAbsence: any, dto: ExtendLeaveDto, timezone: string) {
    const newEndIso = dto.newEndDate.includes('T') ? dto.newEndDate.split('T')[0] : dto.newEndDate;
    const newEndDateParsed = DateTime.fromISO(newEndIso, { zone: timezone }).startOf('day');
    const oldEndDateParsed = DateTime.fromJSDate(existingAbsence.endDate, { zone: timezone }).startOf('day');

    if (newEndDateParsed <= oldEndDateParsed) {
      throw new BadRequestException('New end date must be strictly after the current end date.');
    }

    const incrementalStartParsed = oldEndDateParsed.plus({ days: 1 });
    const newEndDateObj = new Date(`${newEndIso}T00:00:00.000Z`);

    return {
      newEndIso,
      newEndDateParsed,
      oldEndDateParsed,
      incrementalStartParsed,
      newEndDateObj,
    };
  }
}
