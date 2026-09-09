import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../database/prisma.service';
import { SessionService } from './services/session.service';

export interface JwtPayload {
  sub: string;
  sessionId?: string;
  email: string;
  role: string;
  salonId?: string | null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private prisma: PrismaService,
    private sessionService: SessionService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret') || 'default-secret-key-min32chars',
    });
  }

  async validate(payload: JwtPayload) {
    // If sessionId is present in payload, verify session has not been revoked via SessionService
    if (payload.sessionId) {
      const isValid = await this.sessionService.validateSession(payload.sessionId);
      if (!isValid) {
        throw new UnauthorizedException('Session has been revoked or expired.');
      }
    }

    const admin = await this.prisma.admin.findUnique({
      where: { id: payload.sub },
      include: { salon: true },
    });

    if (!admin || admin.status !== 'ACTIVE') {
      throw new UnauthorizedException('Admin account is inactive or no longer exists.');
    }

    if (admin.salon && admin.salon.status === 'SUSPENDED' && admin.role !== 'SUPER_ADMIN') {
      throw new UnauthorizedException('Salon account is suspended by platform administration.');
    }

    return {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
      salonId: admin.salonId,
      salon: admin.salon,
    };
  }
}
