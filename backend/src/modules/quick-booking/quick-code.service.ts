import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DateTime } from 'luxon';
import * as crypto from 'crypto';
import { SalonQuickCode } from '@prisma/client';

export interface CodeVerificationResult {
  success: boolean;
  message: string;
  minutesRemaining?: number;
  attemptsRemaining?: number;
}

@Injectable()
export class QuickCodeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Helper to generate cryptographically secure 4-digit code
   */
  private generateCodeString(): string {
    return crypto.randomInt(1000, 10000).toString();
  }

  /**
   * Get current local date string (YYYY-MM-DD) for a salon
   */
  async getTodaySalonDate(salonId: string): Promise<string> {
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: { timezone: true },
    });
    if (!salon) {
      throw new NotFoundException('Salon not found');
    }
    const tz = salon.timezone || 'Asia/Kolkata';
    return DateTime.now().setZone(tz).toFormat('yyyy-MM-dd');
  }

  /**
   * Get or generate today's active Quick Code for a salon
   */
  async getOrCreateTodayCode(salonId: string): Promise<SalonQuickCode> {
    const todayDate = await this.getTodaySalonDate(salonId);

    const existing = await this.prisma.salonQuickCode.findUnique({
      where: { salonId },
    });

    if (existing && existing.validDate === todayDate) {
      return existing;
    }

    const newCode = this.generateCodeString();

    return this.prisma.salonQuickCode.upsert({
      where: { salonId },
      update: {
        code: newCode,
        validDate: todayDate,
      },
      create: {
        salonId,
        code: newCode,
        validDate: todayDate,
      },
    });
  }

  /**
   * Force generate a fresh Quick Code for today (replaces active code)
   */
  async forceRegenerateCode(salonId: string): Promise<SalonQuickCode> {
    const todayDate = await this.getTodaySalonDate(salonId);
    const newCode = this.generateCodeString();

    return this.prisma.salonQuickCode.upsert({
      where: { salonId },
      update: {
        code: newCode,
        validDate: todayDate,
      },
      create: {
        salonId,
        code: newCode,
        validDate: todayDate,
      },
    });
  }

  /**
   * Verify customer submitted code with 10-minute lockout on 5th attempt
   */
  async verifyCode(
    salonId: string,
    customerPhone: string,
    submittedCode: string,
  ): Promise<CodeVerificationResult> {
    const now = new Date();

    const conversation = await this.prisma.conversation.findUnique({
      where: { salonId_customerPhone: { salonId, customerPhone } },
    });

    let currentAttempts = conversation?.quickCodeAttempts || 0;
    let lockedUntil = conversation?.quickCodeLockedUntil;

    // 1. Check if currently locked
    if (lockedUntil && now < lockedUntil) {
      const msLeft = lockedUntil.getTime() - now.getTime();
      const minutesRemaining = Math.ceil(msLeft / (60 * 1000));
      return {
        success: false,
        message: 'LOCKED',
        minutesRemaining: Math.max(1, minutesRemaining),
      };
    }

    // Lock expired: reset lock
    if (lockedUntil && now >= lockedUntil) {
      currentAttempts = 0;
      lockedUntil = null;
    }

    // 2. Fetch active today code
    const activeQuickCode = await this.getOrCreateTodayCode(salonId);

    // 3. Evaluate submitted code
    const cleanSubmitted = (submittedCode || '').trim();

    if (activeQuickCode && cleanSubmitted === activeQuickCode.code) {
      // SUCCESS: Clear attempts, clear lock, set verified timestamp
      if (conversation) {
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            quickCodeAttempts: 0,
            quickCodeLockedUntil: null,
            quickCodeVerifiedAt: now,
          },
        });
      }
      return {
        success: true,
        message: 'VERIFIED',
      };
    } else {
      // FAILED ATTEMPT
      const newAttempts = currentAttempts + 1;
      let newLockedUntil: Date | null = null;

      if (newAttempts >= 5) {
        newLockedUntil = new Date(now.getTime() + 10 * 60 * 1000); // 10 minute lock
      }

      if (conversation) {
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            quickCodeAttempts: newAttempts,
            quickCodeLockedUntil: newLockedUntil,
          },
        });
      }

      if (newAttempts >= 5) {
        return {
          success: false,
          message: 'LOCKED_NOW',
          minutesRemaining: 10,
        };
      } else {
        return {
          success: false,
          message: 'INVALID_CODE',
          attemptsRemaining: 5 - newAttempts,
        };
      }
    }
  }
}
