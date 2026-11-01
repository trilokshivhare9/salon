import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { DayOfWeek } from '@prisma/client';

@Injectable()
export class BreakPropagationEngine {
  private readonly logger = new Logger(BreakPropagationEngine.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Propagates a master SalonBreak to all eligible stylists in the salon.
   * Protects stylist customization invariants:
   * 1. Never overwrites a customized break (isCustomized === true).
   * 2. Avoids creating overlapping/conflicting breaks on shared days.
   */
  async propagateSalonBreak(
    tx: any,
    params: {
      salonId: string;
      salonBreakId: string;
      days: DayOfWeek[];
      title: string;
      startTime: string;
      endTime: string;
    },
  ): Promise<{ propagatedCount: number; skippedStylists: string[] }> {
    const { salonId, salonBreakId, days, title, startTime, endTime } = params;

    const stylists = await tx.stylist.findMany({
      where: { salonId, status: 'ACTIVE' },
      include: {
        breaks: true,
      },
    });

    let propagatedCount = 0;
    const skippedStylists: string[] = [];

    for (const st of stylists) {
      // If already has break for this salonBreakId, update if uncustomized, or leave untouched if customized
      const existingSameBreak = st.breaks.find(
        (b: any) => b.salonBreakId === salonBreakId,
      );
      if (existingSameBreak) {
        if (!existingSameBreak.isCustomized) {
          await tx.stylistBreak.update({
            where: { id: existingSameBreak.id },
            data: { title, startTime, endTime, days },
          });
          propagatedCount++;
        }
        continue;
      }

      // Check for overlap against existing breaks on overlapping days
      const hasOverlap = st.breaks.some(
        (b: any) =>
          b.startTime < endTime &&
          b.endTime > startTime &&
          Array.isArray(b.days) &&
          b.days.some((d: DayOfWeek) => days.includes(d)),
      );

      if (hasOverlap) {
        skippedStylists.push(`${st.name} (Custom Overlap)`);
        continue;
      }

      await tx.stylistBreak.create({
        data: {
          salonId,
          stylistId: st.id,
          salonBreakId,
          days,
          title,
          startTime,
          endTime,
          isCustomized: false,
        },
      });
      propagatedCount++;
    }

    return { propagatedCount, skippedStylists };
  }

  /**
   * Removes propagated uncustomized breaks for a salon break.
   * Customized stylist breaks (isCustomized: true) are detached and preserved.
   */
  async cleanupPropagatedBreaks(tx: any, salonBreakId: string): Promise<number> {
    // Delete non-customized stylist breaks
    const { count } = await tx.stylistBreak.deleteMany({
      where: { salonBreakId, isCustomized: false },
    });

    // Detach customized breaks so they remain as stylist-specific breaks
    await tx.stylistBreak.updateMany({
      where: { salonBreakId, isCustomized: true },
      data: { salonBreakId: null },
    });

    return count;
  }
}
