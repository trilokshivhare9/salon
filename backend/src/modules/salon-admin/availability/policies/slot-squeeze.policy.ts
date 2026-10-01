import { Injectable } from '@nestjs/common';

export interface SqueezeEvaluationResult {
  fits: boolean;
  isSqueezed: boolean;
  squeezedMinutes: number;
  effectiveDuration: number;
}

@Injectable()
export class SlotSqueezePolicy {
  /**
   * Maximum allowable squeeze in minutes.
   * In physical salon operations, staff can adjust up to 10 minutes for longer services.
   */
  private readonly MAX_SQUEEZE_MINUTES = 10;

  /**
   * Calculates safe squeeze minutes based on service duration.
   * Proportional guard ensures short services (e.g. 15-min beard trim) are never over-compressed.
   */
  calculateAllowedSqueeze(totalDurationMinutes: number): number {
    if (totalDurationMinutes < 20) {
      return 0; // Services under 20 mins cannot be safely compressed
    }
    if (totalDurationMinutes < 35) {
      return 5; // 20m–34m services can flex up to 5 minutes
    }
    return this.MAX_SQUEEZE_MINUTES; // 35m+ services can flex up to 10 minutes
  }

  /**
   * Determines if a service can fit inside a free interval window using human flex.
   *
   * @param remainingIntervalMinutes Minutes available in the continuous free block
   * @param totalDurationMinutes Nominal catalog service duration
   */
  canFit(
    remainingIntervalMinutes: number,
    totalDurationMinutes: number,
  ): SqueezeEvaluationResult {
    // 1. Natural Fit without squeeze
    if (remainingIntervalMinutes >= totalDurationMinutes) {
      return {
        fits: true,
        isSqueezed: false,
        squeezedMinutes: 0,
        effectiveDuration: totalDurationMinutes,
      };
    }

    // 2. Evaluate squeeze tolerance
    const allowedSqueeze = this.calculateAllowedSqueeze(totalDurationMinutes);
    const minRequiredMinutes = totalDurationMinutes - allowedSqueeze;

    if (remainingIntervalMinutes >= minRequiredMinutes) {
      const squeezedMinutes = totalDurationMinutes - remainingIntervalMinutes;
      return {
        fits: true,
        isSqueezed: true,
        squeezedMinutes,
        // The effective duration on the calendar is bounded to the available gap
        effectiveDuration: remainingIntervalMinutes,
      };
    }

    // 3. Gap is too small even with squeeze
    return {
      fits: false,
      isSqueezed: false,
      squeezedMinutes: 0,
      effectiveDuration: totalDurationMinutes,
    };
  }
}
