import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { PasswordService } from './services/password.service';
import { TokenService } from './services/token.service';
import { SessionService } from './services/session.service';
import { LoginDto } from './dto/login.dto';
import { RegisterSalonDto } from './dto/register.dto';
import { AdminRole, DayOfWeek } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private passwordService: PasswordService,
    private tokenService: TokenService,
    private sessionService: SessionService,
  ) {}

  async login(loginDto: LoginDto, userAgent?: string, ipAddress?: string) {
    const rawInput = (loginDto.email || '').trim();
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawInput);

    let admin: any = null;

    if (isEmail) {
      admin = await this.prisma.admin.findUnique({
        where: { email: rawInput.toLowerCase() },
        include: { salon: true },
      });
    } else {
      // Lookup by Mobile / WhatsApp Number with Indian formatting candidates
      const digitsOnly = rawInput.replace(/\D/g, '');
      const candidates = new Set<string>();
      candidates.add(rawInput);
      if (digitsOnly) {
        candidates.add(digitsOnly);
        candidates.add(`+${digitsOnly}`);
        if (digitsOnly.length === 10) {
          candidates.add(`+91${digitsOnly}`);
          candidates.add(`91${digitsOnly}`);
          candidates.add(`+91 ${digitsOnly.slice(0, 5)} ${digitsOnly.slice(5)}`);
          candidates.add(`+91 ${digitsOnly}`);
        } else if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
          const ten = digitsOnly.slice(2);
          candidates.add(ten);
          candidates.add(`+91${ten}`);
          candidates.add(`+91 ${ten.slice(0, 5)} ${ten.slice(5)}`);
          candidates.add(`+91 ${ten}`);
        }
      }
      const candidateList = Array.from(candidates);

      admin = await this.prisma.admin.findFirst({
        where: {
          OR: [
            { phone: { in: candidateList } },
            { salon: { phone: { in: candidateList } } },
          ],
        },
        include: { salon: true },
      });
    }

    if (!admin) {
      throw new UnauthorizedException(
        isEmail
          ? 'Email address is not registered. Please check your email or create an account.'
          : 'Mobile number is not registered. Please check your mobile number or create an account.',
      );
    }

    const isPasswordValid = await this.passwordService.compare(loginDto.password, admin.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Incorrect password. Please check your password and try again.');
    }

    if (admin.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account has been deactivated.');
    }

    // Delegate Session Creation to SessionService
    const { session, rawRefreshToken } = await this.sessionService.createSession(
      admin.id,
      userAgent,
      ipAddress,
    );

    // Delegate JWT Generation to TokenService
    const payload = {
      sub: admin.id,
      sessionId: session.id,
      email: admin.email,
      role: admin.role,
      salonId: admin.salonId,
    };

    const accessToken = this.tokenService.generateAccessToken(payload);

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      expiresIn: 900,
      user: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        salonId: admin.salonId,
        salon: admin.salon
          ? {
              id: admin.salon.id,
              name: admin.salon.name,
              slug: admin.salon.slug,
              timezone: admin.salon.timezone,
              status: admin.salon.status,
            }
          : null,
      },
    };
  }

  async refresh(rawRefreshToken: string, userAgent?: string, ipAddress?: string) {
    if (!rawRefreshToken || typeof rawRefreshToken !== 'string') {
      throw new UnauthorizedException('Refresh token is required.');
    }

    const existingSession = await this.sessionService.findSessionByToken(rawRefreshToken);

    // Reuse Detection & Revocation Protocol
    if (!existingSession) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    if (existingSession.isRevoked) {
      // Security Event: Revoked token presented again -> revoke entire family via SessionService!
      await this.sessionService.revokeFamily(existingSession.familyId);
      throw new UnauthorizedException('Security Breach Alert: Token reuse detected. All active family sessions revoked.');
    }

    if (new Date() > existingSession.expiresAt) {
      await this.sessionService.revokeSessionByToken(rawRefreshToken);
      throw new UnauthorizedException('Refresh token has expired. Please log in again.');
    }

    if (!existingSession.admin || existingSession.admin.status !== 'ACTIVE') {
      await this.sessionService.revokeSessionByToken(rawRefreshToken);
      throw new UnauthorizedException('User account deactivated or suspended.');
    }

    // Refresh Token Rotation (RTR): Delegate rotation to SessionService
    const { session: newSession, rawRefreshToken: newRawRefreshToken } =
      await this.sessionService.rotateSession(existingSession, userAgent, ipAddress);

    const payload = {
      sub: existingSession.admin.id,
      sessionId: newSession.id,
      email: existingSession.admin.email,
      role: existingSession.admin.role,
      salonId: existingSession.admin.salonId,
    };

    const newAccessToken = this.tokenService.generateAccessToken(payload);

    return {
      accessToken: newAccessToken,
      refreshToken: newRawRefreshToken,
      expiresIn: 900,
      user: {
        id: existingSession.admin.id,
        name: existingSession.admin.name,
        email: existingSession.admin.email,
        role: existingSession.admin.role,
        salonId: existingSession.admin.salonId,
        salon: existingSession.admin.salon,
      },
    };
  }

  async logout(rawRefreshToken: string) {
    await this.sessionService.revokeSessionByToken(rawRefreshToken);
    return { success: true, message: 'Logged out successfully.' };
  }

  async logoutAllDevices(adminId: string) {
    await this.sessionService.revokeAllUserSessions(adminId);
    return { success: true, message: 'Logged out from all devices.' };
  }

  async registerSalon(registerDto: RegisterSalonDto) {
    const email = registerDto.email.toLowerCase().trim();
    const existingAdmin = await this.prisma.admin.findUnique({
      where: { email },
    });

    if (existingAdmin) {
      throw new ConflictException('An account with this email already exists.');
    }

    let baseSlug = registerDto.salonName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    let slug = baseSlug;
    let slugIndex = 1;
    while (await this.prisma.salon.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${slugIndex}`;
      slugIndex++;
    }

    const passwordHash = await this.passwordService.hash(registerDto.password);

    return this.prisma.$transaction(async (tx) => {
      const ownerAdmin = await tx.admin.create({
        data: {
          name: registerDto.ownerName,
          email,
          phone: registerDto.phone,
          passwordHash,
          role: AdminRole.SALON_OWNER,
        },
      });

      const salon = await tx.salon.create({
        data: {
          createdByAdminId: ownerAdmin.id,
          name: registerDto.salonName,
          slug,
          phone: registerDto.phone,
          email,
          city: registerDto.city,
          timezone: registerDto.timezone || 'Asia/Kolkata',
          defaultStartTime: '09:00',
          defaultEndTime: '21:00',
        },
      });

      await tx.admin.update({
        where: { id: ownerAdmin.id },
        data: { salonId: salon.id },
      });

      const days: DayOfWeek[] = [
        DayOfWeek.SUNDAY,
        DayOfWeek.MONDAY,
        DayOfWeek.TUESDAY,
        DayOfWeek.WEDNESDAY,
        DayOfWeek.THURSDAY,
        DayOfWeek.FRIDAY,
        DayOfWeek.SATURDAY,
      ];

      for (const day of days) {
        await tx.salonWorkingHours.create({
          data: {
            salonId: salon.id,
            dayOfWeek: day,
            isClosed: false,
            startTime: '09:00',
            endTime: '21:00',
          },
        });
      }

      // Create initial session inside transaction via SessionService
      const { session, rawRefreshToken } = await this.sessionService.createSession(
        ownerAdmin.id,
        undefined,
        undefined,
        undefined,
        tx,
      );

      const payload = {
        sub: ownerAdmin.id,
        sessionId: session.id,
        email: ownerAdmin.email,
        role: ownerAdmin.role,
        salonId: salon.id,
      };

      const accessToken = this.tokenService.generateAccessToken(payload);

      return {
        accessToken,
        refreshToken: rawRefreshToken,
        expiresIn: 900,
        user: {
          id: ownerAdmin.id,
          name: ownerAdmin.name,
          email: ownerAdmin.email,
          role: ownerAdmin.role,
          salonId: salon.id,
          salon: {
            id: salon.id,
            name: salon.name,
            slug: salon.slug,
            timezone: salon.timezone,
            status: salon.status,
          },
        },
      };
    });
  }

  async getMe(adminId: string) {
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      include: { salon: true },
    });

    if (!admin) {
      throw new NotFoundException('Admin not found.');
    }

    return {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      salonId: admin.salonId,
      salon: admin.salon,
    };
  }
}
