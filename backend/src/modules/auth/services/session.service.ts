import { Injectable, UnauthorizedException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../../database/prisma.service';
import { TokenService } from './token.service';

@Injectable()
export class SessionService {
  constructor(
    private prisma: PrismaService,
    private tokenService: TokenService,
  ) {}

  /**
   * Creates a new UserSession record in PostgreSQL DB.
   * Supports optional Prisma transaction client (`tx`) for atomic registration transactions.
   */
  async createSession(
    adminId: string,
    userAgent?: string,
    ipAddress?: string,
    familyId?: string,
    tx?: any,
  ) {
    const db = tx || this.prisma;
    const sessionFamilyId = familyId || uuidv4();
    const rawRefreshToken = this.tokenService.generateRefreshToken();
    const tokenHash = this.tokenService.hashToken(rawRefreshToken);
    const expiresAt = this.tokenService.calculateExpiryDate(7);

    const session = await db.userSession.create({
      data: {
        adminId,
        tokenHash,
        familyId: sessionFamilyId,
        expiresAt,
        userAgent: userAgent || null,
        ipAddress: ipAddress || null,
      },
    });

    return {
      session,
      rawRefreshToken,
    };
  }

  /**
   * Finds session by raw refresh token (hashing raw token first).
   */
  async findSessionByToken(rawRefreshToken: string) {
    if (!rawRefreshToken || typeof rawRefreshToken !== 'string') {
      return null;
    }
    const tokenHash = this.tokenService.hashToken(rawRefreshToken);
    return this.prisma.userSession.findUnique({
      where: { tokenHash },
      include: { admin: { include: { salon: true } } },
    });
  }

  /**
   * Executes Refresh Token Rotation (RTR):
   * 1. Revokes the existing session.
   * 2. Creates a new session under the same familyId.
   */
  async rotateSession(existingSession: any, userAgent?: string, ipAddress?: string) {
    // Revoke old session
    await this.prisma.userSession.update({
      where: { id: existingSession.id },
      data: { isRevoked: true, revokedAt: new Date() },
    });

    // Create new rotated session under same familyId
    return this.createSession(
      existingSession.adminId,
      userAgent || existingSession.userAgent,
      ipAddress || existingSession.ipAddress,
      existingSession.familyId,
    );
  }

  /**
   * Token Family Revocation protocol triggered on refresh token reuse.
   * Revokes all active sessions sharing the familyId.
   */
  async revokeFamily(familyId: string) {
    await this.prisma.userSession.updateMany({
      where: { familyId },
      data: { isRevoked: true, revokedAt: new Date() },
    });
  }

  /**
   * Single session revocation (logout).
   */
  async revokeSessionByToken(rawRefreshToken: string) {
    if (!rawRefreshToken) return;
    const tokenHash = this.tokenService.hashToken(rawRefreshToken);
    await this.prisma.userSession.updateMany({
      where: { tokenHash },
      data: { isRevoked: true, revokedAt: new Date() },
    });
  }

  /**
   * Revokes all active sessions for a user (logout-all).
   */
  async revokeAllUserSessions(adminId: string) {
    await this.prisma.userSession.updateMany({
      where: { adminId, isRevoked: false },
      data: { isRevoked: true, revokedAt: new Date() },
    });
  }

  /**
   * Validates a session by ID (used by JwtStrategy).
   */
  async validateSession(sessionId: string) {
    if (!sessionId) return false;
    const session = await this.prisma.userSession.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.isRevoked || new Date() > session.expiresAt) {
      return false;
    }
    return true;
  }
}
