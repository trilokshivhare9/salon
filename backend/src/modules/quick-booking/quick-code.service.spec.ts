import { Test, TestingModule } from '@nestjs/testing';
import { QuickCodeService } from './quick-code.service';
import { PrismaService } from '../../database/prisma.service';

describe('QuickCodeService', () => {
  let service: QuickCodeService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const mockPrisma = {
      salon: {
        findUnique: jest.fn(),
      },
      salonQuickCode: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
      conversation: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuickCodeService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<QuickCodeService>(QuickCodeService);
    prisma = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getOrCreateTodayCode', () => {
    it('should return 4-digit numeric code', async () => {
      (prisma.salon.findUnique as jest.Mock).mockResolvedValue({ timezone: 'Asia/Kolkata' });
      (prisma.salonQuickCode.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.salonQuickCode.upsert as jest.Mock).mockImplementation(({ create }) => create);

      const result = await service.getOrCreateTodayCode('salon-1');
      expect(result.code).toMatch(/^\d{4}$/);
    });
  });

  describe('verifyCode', () => {
    it('should verify correct code and reset attempts', async () => {
      (prisma.salon.findUnique as jest.Mock).mockResolvedValue({ timezone: 'Asia/Kolkata' });
      (prisma.conversation.findUnique as jest.Mock).mockResolvedValue({
        id: 'conv-1',
        quickCodeAttempts: 2,
        quickCodeLockedUntil: null,
      });
      (prisma.salonQuickCode.findUnique as jest.Mock).mockResolvedValue({
        id: 'code-1',
        salonId: 'salon-1',
        code: '1234',
      });
      (prisma.salonQuickCode.upsert as jest.Mock).mockResolvedValue({
        id: 'code-1',
        salonId: 'salon-1',
        code: '1234',
      });
      (prisma.conversation.update as jest.Mock).mockResolvedValue({});

      const result = await service.verifyCode('salon-1', '+919999999999', '1234');
      expect(result.success).toBe(true);
      expect(result.message).toBe('VERIFIED');
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: expect.objectContaining({
          quickCodeAttempts: 0,
          quickCodeLockedUntil: null,
        }),
      });
    });

    it('should increment attempt counter on wrong code', async () => {
      (prisma.salon.findUnique as jest.Mock).mockResolvedValue({ timezone: 'Asia/Kolkata' });
      (prisma.conversation.findUnique as jest.Mock).mockResolvedValue({
        id: 'conv-1',
        quickCodeAttempts: 1,
        quickCodeLockedUntil: null,
      });
      (prisma.salonQuickCode.findUnique as jest.Mock).mockResolvedValue({
        id: 'code-1',
        salonId: 'salon-1',
        code: '1234',
      });
      (prisma.salonQuickCode.upsert as jest.Mock).mockResolvedValue({
        id: 'code-1',
        salonId: 'salon-1',
        code: '1234',
      });
      (prisma.conversation.update as jest.Mock).mockResolvedValue({});

      const result = await service.verifyCode('salon-1', '+919999999999', '9999');
      expect(result.success).toBe(false);
      expect(result.message).toBe('INVALID_CODE');
      expect(result.attemptsRemaining).toBe(3);
    });

    it('should lock user for 10 minutes on 5th failed attempt', async () => {
      (prisma.salon.findUnique as jest.Mock).mockResolvedValue({ timezone: 'Asia/Kolkata' });
      (prisma.conversation.findUnique as jest.Mock).mockResolvedValue({
        id: 'conv-1',
        quickCodeAttempts: 4,
        quickCodeLockedUntil: null,
      });
      (prisma.salonQuickCode.findUnique as jest.Mock).mockResolvedValue({
        id: 'code-1',
        salonId: 'salon-1',
        code: '1234',
      });
      (prisma.salonQuickCode.upsert as jest.Mock).mockResolvedValue({
        id: 'code-1',
        salonId: 'salon-1',
        code: '1234',
      });
      (prisma.conversation.update as jest.Mock).mockResolvedValue({});

      const result = await service.verifyCode('salon-1', '+919999999999', '9999');
      expect(result.success).toBe(false);
      expect(result.message).toBe('LOCKED_NOW');
      expect(result.minutesRemaining).toBe(10);
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: expect.objectContaining({
          quickCodeAttempts: 5,
          quickCodeLockedUntil: expect.any(Date),
        }),
      });
    });

    it('should reject immediately if user is currently locked', async () => {
      const lockedUntil = new Date(Date.now() + 5 * 60 * 1000); // 5 mins in future
      (prisma.conversation.findUnique as jest.Mock).mockResolvedValue({
        id: 'conv-1',
        quickCodeAttempts: 5,
        quickCodeLockedUntil: lockedUntil,
      });

      const result = await service.verifyCode('salon-1', '+919999999999', '1234');
      expect(result.success).toBe(false);
      expect(result.message).toBe('LOCKED');
      expect(result.minutesRemaining).toBe(5);
    });
  });
});
