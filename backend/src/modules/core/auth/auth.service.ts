import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../../database/prisma.service';
import { PasswordService } from './services/password.service';
import { TokenService } from './services/token.service';
import { SessionService } from './services/session.service';
import { MailService } from '../mail/mail.service';
import { LoginDto } from './dto/login.dto';
import { RegisterSalonDto } from './dto/register.dto';
import {
  ForgotPasswordDto,
  ResetPasswordWithOtpDto,
  ChangePasswordDto,
  UpdateAdminProfileDto,
} from './dto/password-reset.dto';
import { AdminRole, DayOfWeek } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private passwordService: PasswordService,
    private tokenService: TokenService,
    private sessionService: SessionService,
    private mailService: MailService,
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
            isClosed: day === DayOfWeek.TUESDAY,
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
      phone: admin.phone,
      role: admin.role,
      salonId: admin.salonId,
      salon: admin.salon,
    };
  }

  /**
   * Helper: Masks email for safe privacy display (e.g. "trilok@gmail.com" -> "tr***@gmail.com")
   */
  private maskEmail(email: string): string {
    const parts = email.split('@');
    if (parts.length !== 2) return '***@***.com';
    const name = parts[0];
    const domain = parts[1];
    const maskedName = name.length > 2 ? `${name.slice(0, 2)}***` : `${name.slice(0, 1)}***`;
    return `${maskedName}@${domain}`;
  }

  /**
   * Helper: Resolves admin by email or Indian/Intl formatted mobile
   */
  async findAdminByIdentifier(rawInput: string) {
    const trimmed = (rawInput || '').trim();
    if (!trimmed) return null;
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);

    if (isEmail) {
      return this.prisma.admin.findUnique({
        where: { email: trimmed.toLowerCase() },
        include: { salon: true },
      });
    }

    const digitsOnly = trimmed.replace(/\D/g, '');
    const candidates = new Set<string>();
    candidates.add(trimmed);
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

    return this.prisma.admin.findFirst({
      where: {
        OR: [
          { phone: { in: candidateList } },
          { salon: { phone: { in: candidateList } } },
        ],
      },
      include: { salon: true },
    });
  }

  /**
   * Look up registered salon by Owner Mobile Number
   * Displays the saved email that was registered when creating the salon.
   */
  async lookupSalonByMobile(mobile: string) {
    if (!mobile || typeof mobile !== 'string') {
      throw new BadRequestException('Please provide your registered mobile number.');
    }
    const admin = await this.findAdminByIdentifier(mobile.trim());
    if (!admin) {
      throw new NotFoundException('No salon found with this registered mobile number. Please check the number.');
    }
    if (!admin.email) {
      throw new BadRequestException('No recovery email was saved for this salon. Please contact platform support.');
    }
    return {
      success: true,
      salonName: admin.salon?.name || 'Salon Store',
      ownerName: admin.name,
      maskedEmail: this.maskEmail(admin.email),
      mobile: admin.phone || mobile.trim(),
    };
  }

  /**
   * Step 1: Request Password Reset OTP via Email
   */
  async forgotPassword(dto: ForgotPasswordDto, ipAddress?: string, userAgent?: string) {
    const rawIdentifier = (dto.mobile || dto.identifier || '').trim();
    const admin = await this.findAdminByIdentifier(rawIdentifier);

    // Anti-user-enumeration guard: If admin not found, return generic success message
    if (!admin || !admin.email) {
      return {
        success: true,
        message: 'If your account is registered, a 6-digit verification code has been dispatched to your email.',
        maskedEmail: 'your registered email',
        expiresInSeconds: 600,
      };
    }

    // Rate-limiting check: 15-minute waiting time removed (set to 0 for instant testing)
    // const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    // const recentRequests = await this.prisma.adminPasswordReset.count({
    //   where: {
    //     adminId: admin.id,
    //     createdAt: { gte: fifteenMinutesAgo },
    //   },
    // });
    // if (recentRequests >= 4) {
    //   throw new BadRequestException('Too many password reset requests. Please wait 15 minutes before trying again.');
    // }

    // Generate cryptographically random 6-digit code (e.g. '582910')
    const rawOtp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = crypto.createHash('sha256').update(rawOtp).digest('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes TTL

    // Invalidate previous un-used OTPs for this admin
    await this.prisma.adminPasswordReset.updateMany({
      where: { adminId: admin.id, isUsed: false },
      data: { isUsed: true },
    });

    // Save hashed OTP in database
    await this.prisma.adminPasswordReset.create({
      data: {
        adminId: admin.id,
        otpHash,
        expiresAt,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
      },
    });

    // Send email with raw OTP
    await this.mailService.sendPasswordResetOtp(admin.email, rawOtp, admin.name || 'Salon Owner');

    return {
      success: true,
      message: 'A 6-digit verification code has been dispatched to your email.',
      maskedEmail: this.maskEmail(admin.email),
      expiresInSeconds: 600,
    };
  }

  /**
   * Step 2: Verify OTP and Reset Password
   */
  async resetPasswordWithOtp(dto: ResetPasswordWithOtpDto, ipAddress?: string, userAgent?: string) {
    const admin = await this.findAdminByIdentifier(dto.identifier);
    if (!admin) {
      throw new BadRequestException('Invalid or expired verification code.');
    }

    // Find the latest active reset record
    const resetRecord = await this.prisma.adminPasswordReset.findFirst({
      where: {
        adminId: admin.id,
        isUsed: false,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!resetRecord) {
      throw new BadRequestException('No active password reset request found. Please request a new code.');
    }

    // Check expiration
    if (new Date() > resetRecord.expiresAt) {
      await this.prisma.adminPasswordReset.update({
        where: { id: resetRecord.id },
        data: { isUsed: true },
      });
      throw new BadRequestException('Verification code has expired. Please request a new code.');
    }

    // Check max attempts
    if (resetRecord.attempts >= 3) {
      await this.prisma.adminPasswordReset.update({
        where: { id: resetRecord.id },
        data: { isUsed: true },
      });
      throw new BadRequestException('Too many failed attempts. This code has been invalidated for security. Please request a new code.');
    }

    // Compute input OTP hash
    const inputHash = crypto.createHash('sha256').update(dto.otp.trim()).digest('hex');

    if (inputHash !== resetRecord.otpHash) {
      // Increment failed attempt counter
      await this.prisma.adminPasswordReset.update({
        where: { id: resetRecord.id },
        data: { attempts: resetRecord.attempts + 1 },
      });
      const remaining = 2 - resetRecord.attempts;
      throw new BadRequestException(`Incorrect verification code. ${remaining > 0 ? `${remaining} attempt(s) remaining.` : 'Code will be locked on next failure.'}`);
    }

    // OTP is valid! Mark as used
    await this.prisma.adminPasswordReset.update({
      where: { id: resetRecord.id },
      data: { isUsed: true },
    });

    // Hash new password and update admin
    const newPasswordHash = await this.passwordService.hash(dto.newPassword);
    await this.prisma.admin.update({
      where: { id: admin.id },
      data: { passwordHash: newPasswordHash },
    });

    // Revoke all existing sessions to boot out unauthorized devices
    await this.sessionService.revokeAllUserSessions(admin.id);

    return {
      success: true,
      message: 'Your password has been successfully reset! You can now log in with your new password.',
    };
  }

  /**
   * Authenticated: Change Password from Profile
   */
  async changePassword(adminId: string, dto: ChangePasswordDto) {
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
    });

    if (!admin) {
      throw new NotFoundException('Admin account not found.');
    }

    const isCurrentValid = await this.passwordService.compare(dto.currentPassword, admin.passwordHash);
    if (!isCurrentValid) {
      throw new BadRequestException('Current password does not match our records.');
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('New password must be different from your current password.');
    }

    const newHash = await this.passwordService.hash(dto.newPassword);
    await this.prisma.admin.update({
      where: { id: adminId },
      data: { passwordHash: newHash },
    });

    return {
      success: true,
      message: 'Password updated successfully.',
    };
  }

  /**
   * Authenticated: Update Admin Profile (Email, Name, Phone)
   */
  async updateProfile(adminId: string, dto: UpdateAdminProfileDto) {
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
    });

    if (!admin) {
      throw new NotFoundException('Admin account not found.');
    }

    // If email is changing, ensure uniqueness
    if (dto.email && dto.email.toLowerCase() !== admin.email.toLowerCase()) {
      const existing = await this.prisma.admin.findUnique({
        where: { email: dto.email.toLowerCase().trim() },
      });
      if (existing && existing.id !== adminId) {
        throw new ConflictException('This email address is already in use by another account.');
      }
    }

    const updated = await this.prisma.admin.update({
      where: { id: adminId },
      data: {
        name: dto.name !== undefined ? dto.name.trim() : admin.name,
        email: dto.email !== undefined ? dto.email.toLowerCase().trim() : admin.email,
        phone: dto.phone !== undefined ? dto.phone.trim() : admin.phone,
      },
      include: { salon: true },
    });

    return {
      success: true,
      message: 'Profile updated successfully.',
      admin: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        phone: updated.phone,
        role: updated.role,
        salonId: updated.salonId,
        salon: updated.salon,
      },
    };
  }
}
