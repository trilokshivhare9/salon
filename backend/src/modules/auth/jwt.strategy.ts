import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../database/prisma.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  salonId?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret') || 'default-secret-key-min32chars',
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { salon: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User is inactive or no longer exists.');
    }

    if (user.salon && user.salon.status === 'SUSPENDED' && user.role !== 'PLATFORM_ADMIN') {
      throw new UnauthorizedException('Salon account is suspended by platform administration.');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      salonId: user.salonId,
      salon: user.salon,
    };
  }
}
