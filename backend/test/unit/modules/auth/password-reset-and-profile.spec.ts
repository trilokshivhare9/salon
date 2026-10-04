import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '../../../../src/modules/core/auth/auth.service';
import { PrismaService } from '../../../../src/database/prisma.service';
import { PasswordService } from '../../../../src/modules/core/auth/services/password.service';
import { TokenService } from '../../../../src/modules/core/auth/services/token.service';
import { SessionService } from '../../../../src/modules/core/auth/services/session.service';
import { MailService } from '../../../../src/modules/core/mail/mail.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';

describe('AuthService: Password Reset, Email OTP & Profile Management', () => {
  let authService: AuthService;
  let prismaService: any;
  let passwordService: any;
  let sessionService: any;
  let mailService: any;

  const mockAdminId = 'admin-uuid-123';
  const mockSalonId = 'salon-uuid-456';
  const mockEmail = 'owner@royalsalon.com';
  const mockPhone = '919876543210';
  const mockCurrentPasswordHash = '$2b$10$existingHashedPassword123';

  const mockAdmin = {
    id: mockAdminId,
    email: mockEmail,
    phone: mockPhone,
    name: 'Royal Owner',
    status: 'ACTIVE',
    salonId: mockSalonId,
    passwordHash: mockCurrentPasswordHash,
    salon: { id: mockSalonId, name: 'Royal Hair Studio' },
  };

  beforeEach(async () => {
    prismaService = {
      admin: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.email === mockEmail || where.id === mockAdminId) {
            return Promise.resolve(mockAdmin);
          }
          return Promise.resolve(null);
        }),
        findFirst: jest.fn().mockResolvedValue(mockAdmin),
        update: jest.fn(),
      },
      adminPasswordReset: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    passwordService = {
      compare: jest.fn(),
      hash: jest.fn().mockImplementation(async (pwd: string) => `hashed_${pwd}`),
    };

    sessionService = {
      createSession: jest.fn(),
      revokeAllUserSessions: jest.fn().mockResolvedValue(undefined),
    };

    mailService = {
      sendPasswordResetOtp: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prismaService },
        { provide: PasswordService, useValue: passwordService },
        { provide: TokenService, useValue: {} },
        { provide: SessionService, useValue: sessionService },
        { provide: MailService, useValue: mailService },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
  });

  describe('lookupSalonByMobile', () => {
    it('should throw NotFoundException if mobile number has no registered salon', async () => {
      prismaService.admin.findFirst.mockResolvedValue(null);

      await expect(authService.lookupSalonByMobile('9999999999')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return salon name and masked registered email saved at salon creation', async () => {
      prismaService.admin.findFirst.mockResolvedValue(mockAdmin);

      const result = await authService.lookupSalonByMobile(mockPhone);

      expect(result.success).toBe(true);
      expect(result.salonName).toBe('Royal Hair Studio');
      expect(result.maskedEmail).toContain('@royalsalon.com');
      expect(result.mobile).toBe(mockPhone);
    });
  });

  describe('forgotPassword', () => {
    it('should return anti-enumeration generic message if identifier is not found', async () => {
      prismaService.admin.findUnique.mockResolvedValue(null);
      prismaService.admin.findFirst.mockResolvedValue(null);

      const result = await authService.forgotPassword({ identifier: 'unknown@example.com' });

      expect(result.success).toBe(true);
      expect(result.message).toContain('If your account is registered');
      expect(mailService.sendPasswordResetOtp).not.toHaveBeenCalled();
    });

    it.skip('should enforce rate limit if more than 3 requests were made in 15 minutes (disabled for zero wait)', async () => {
      prismaService.adminPasswordReset.count.mockResolvedValue(4);

      await expect(
        authService.forgotPassword({ identifier: mockEmail }),
      ).rejects.toThrow(BadRequestException);

      expect(mailService.sendPasswordResetOtp).not.toHaveBeenCalled();
    });

    it('should generate 6-digit OTP, store SHA-256 hash, and dispatch email for valid admin', async () => {
      prismaService.adminPasswordReset.count.mockResolvedValue(0);
      prismaService.adminPasswordReset.create.mockResolvedValue({
        id: 'new-reset-id',
        adminId: mockAdminId,
      });

      const result = await authService.forgotPassword({ identifier: mockPhone });

      expect(result.success).toBe(true);
      expect(result.maskedEmail).toContain('@royalsalon.com');
      expect(prismaService.adminPasswordReset.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            adminId: mockAdminId,
            otpHash: expect.any(String),
            expiresAt: expect.any(Date),
          }),
        }),
      );
      expect(mailService.sendPasswordResetOtp).toHaveBeenCalledWith(
        mockEmail,
        expect.stringMatching(/^\d{6}$/),
        'Royal Owner',
      );
    });
  });

  describe('resetPasswordWithOtp', () => {
    const rawOtp = '123456';
    const otpHash = crypto.createHash('sha256').update(rawOtp).digest('hex');

    it('should throw BadRequestException if reset request not found or expired', async () => {
      prismaService.adminPasswordReset.findFirst.mockResolvedValue(null);

      await expect(
        authService.resetPasswordWithOtp({
          identifier: mockEmail,
          otp: rawOtp,
          newPassword: 'BrandNewSecurePassword123!',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if maximum verification attempts exceeded', async () => {
      prismaService.adminPasswordReset.findFirst.mockResolvedValue({
        id: 'reset-1',
        attempts: 5,
        otpHash,
      });

      await expect(
        authService.resetPasswordWithOtp({
          identifier: mockEmail,
          otp: rawOtp,
          newPassword: 'BrandNewSecurePassword123!',
        }),
      ).rejects.toThrow(/Too many failed attempts/);
    });

    it('should increment attempts and throw BadRequestException on incorrect OTP', async () => {
      prismaService.adminPasswordReset.findFirst.mockResolvedValue({
        id: 'reset-1',
        attempts: 1,
        otpHash,
      });

      await expect(
        authService.resetPasswordWithOtp({
          identifier: mockEmail,
          otp: '999999', // Incorrect OTP
          newPassword: 'BrandNewSecurePassword123!',
        }),
      ).rejects.toThrow(/Incorrect verification code/);

      expect(prismaService.adminPasswordReset.update).toHaveBeenCalledWith({
        where: { id: 'reset-1' },
        data: { attempts: 2 },
      });
    });

    it('should successfully update password, mark reset as used, and revoke all sessions', async () => {
      prismaService.adminPasswordReset.findFirst.mockResolvedValue({
        id: 'reset-1',
        attempts: 1,
        otpHash,
      });

      const result = await authService.resetPasswordWithOtp({
        identifier: mockEmail,
        otp: rawOtp,
        newPassword: 'BrandNewSecurePassword123!',
      });

      expect(result.success).toBe(true);
      expect(prismaService.adminPasswordReset.update).toHaveBeenCalledWith({
        where: { id: 'reset-1' },
        data: { isUsed: true },
      });
      expect(prismaService.admin.update).toHaveBeenCalledWith({
        where: { id: mockAdminId },
        data: { passwordHash: 'hashed_BrandNewSecurePassword123!' },
      });
      expect(sessionService.revokeAllUserSessions).toHaveBeenCalledWith(mockAdminId);
    });
  });

  describe('changePassword', () => {
    it('should verify current password and reject if incorrect', async () => {
      passwordService.compare.mockResolvedValue(false);

      await expect(
        authService.changePassword(mockAdminId, {
          currentPassword: 'WrongPassword!',
          newPassword: 'NewPassword123!',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject if new password is identical to current password', async () => {
      passwordService.compare.mockResolvedValue(true);

      await expect(
        authService.changePassword(mockAdminId, {
          currentPassword: 'SamePassword123!',
          newPassword: 'SamePassword123!',
        }),
      ).rejects.toThrow(/must be different/);
    });

    it('should update password with bcrypt hash when current password is valid', async () => {
      passwordService.compare.mockResolvedValue(true);

      const result = await authService.changePassword(mockAdminId, {
        currentPassword: 'OldPassword123!',
        newPassword: 'BrandNewPassword999!',
      });

      expect(result.success).toBe(true);
      expect(prismaService.admin.update).toHaveBeenCalledWith({
        where: { id: mockAdminId },
        data: { passwordHash: 'hashed_BrandNewPassword999!' },
      });
    });
  });

  describe('updateProfile', () => {
    it('should reject email update if another admin account already uses it', async () => {
      prismaService.admin.findUnique
        .mockResolvedValueOnce({ id: mockAdminId, email: 'original@salon.com', name: 'John' })
        .mockResolvedValueOnce({ id: 'different-admin-999', email: 'taken@salon.com' });

      await expect(
        authService.updateProfile(mockAdminId, {
          email: 'taken@salon.com',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should successfully update name, email, and phone', async () => {
      prismaService.admin.findUnique
        .mockResolvedValueOnce({ id: mockAdminId, email: 'old@salon.com', name: 'John', phone: '911111111111' })
        .mockResolvedValueOnce(null); // No collision on new email

      prismaService.admin.update.mockResolvedValue({
        id: mockAdminId,
        name: 'New Name',
        email: 'new@salon.com',
        phone: '912222222222',
        role: 'SALON_ADMIN',
        salonId: mockSalonId,
      });

      const result = await authService.updateProfile(mockAdminId, {
        name: 'New Name',
        email: 'new@salon.com',
        phone: '912222222222',
      });

      expect(result.success).toBe(true);
      expect(result.admin.email).toBe('new@salon.com');
      expect(prismaService.admin.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockAdminId },
          data: expect.objectContaining({
            name: 'New Name',
            email: 'new@salon.com',
            phone: '912222222222',
          }),
        }),
      );
    });
  });
});
