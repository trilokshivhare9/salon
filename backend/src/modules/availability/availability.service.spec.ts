import { Test, TestingModule } from '@nestjs/testing';
import { AvailabilityService } from './availability.service';
import { PrismaService } from '../../database/prisma.service';
import { DayOfWeek } from '@prisma/client';

describe('AvailabilityService (Unit Tests)', () => {
  let service: AvailabilityService;
  let prisma: PrismaService;

  const mockSalonId = 'salon-test-123';
  const mockServiceId = 'service-haircut-456';
  const mockStaffId = 'staff-rahul-789';

  const mockSalon = {
    id: mockSalonId,
    status: 'ACTIVE',
    timezone: 'Asia/Kolkata',
    slotIntervalMinutes: 30,
    minAdvanceNoticeMins: 30,
    maxAdvanceDays: 30,
  };

  const mockService = {
    id: mockServiceId,
    salonId: mockSalonId,
    name: 'Haircut',
    durationMinutes: 30,
    status: 'ACTIVE',
  };

  const mockStaff = [
    {
      id: mockStaffId,
      name: 'Rahul',
      salonId: mockSalonId,
      status: 'ACTIVE',
      workingHours: [
        {
          dayOfWeek: DayOfWeek.MONDAY,
          isWorking: true,
          startTime: '10:00',
          endTime: '20:00',
        },
      ],
      breaks: [
        {
          dayOfWeek: DayOfWeek.MONDAY,
          startTime: '13:00',
          endTime: '14:00',
        },
      ],
    },
  ];

  const mockWorkingHours = {
    salonId: mockSalonId,
    dayOfWeek: DayOfWeek.MONDAY,
    isOpen: true,
    openTime: '10:00',
    closeTime: '20:00',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AvailabilityService,
        {
          provide: PrismaService,
          useValue: {
            salon: { findUnique: jest.fn() },
            holiday: { findFirst: jest.fn() },
            service: { findFirst: jest.fn() },
            staff: { findMany: jest.fn() },
            workingHours: { findUnique: jest.fn() },
            appointment: { findMany: jest.fn() },
            blockedTime: { findMany: jest.fn() },
          },
        },
      ],
    }).compile();

    service = module.get<AvailabilityService>(AvailabilityService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return empty slots if salon is marked as closed for a holiday', async () => {
    jest.spyOn(prisma.salon, 'findUnique').mockResolvedValue(mockSalon as any);
    jest.spyOn(prisma.holiday, 'findFirst').mockResolvedValue({ id: 'hol-1', reason: 'Diwali' } as any);

    // Pick a future Monday
    const result = await service.getAvailableSlots(mockSalonId, mockServiceId, '2026-09-07');

    expect(result.availableSlots).toEqual([]);
  });

  it('should accurately exclude lunch break (13:00 - 14:00) from generated slots', async () => {
    jest.spyOn(prisma.salon, 'findUnique').mockResolvedValue(mockSalon as any);
    jest.spyOn(prisma.holiday, 'findFirst').mockResolvedValue(null);
    jest.spyOn(prisma.service, 'findFirst').mockResolvedValue(mockService as any);
    jest.spyOn(prisma.staff, 'findMany').mockResolvedValue(mockStaff as any);
    jest.spyOn(prisma.workingHours, 'findUnique').mockResolvedValue(mockWorkingHours as any);
    jest.spyOn(prisma.appointment, 'findMany').mockResolvedValue([]);
    jest.spyOn(prisma.blockedTime, 'findMany').mockResolvedValue([]);

    // 2026-09-07 is a Monday
    const result = await service.getAvailableSlots(mockSalonId, mockServiceId, '2026-09-07');

    expect(result.availableSlots.length).toBeGreaterThan(0);
    const slotTimes = result.availableSlots.map((s) => s.startTime);

    // 10:00, 10:30, 11:00, 11:30, 12:00, 12:30 must exist
    expect(slotTimes).toContain('10:00');
    expect(slotTimes).toContain('12:30');

    // 13:00 and 13:30 MUST NOT exist because of 13:00 - 14:00 lunch break!
    expect(slotTimes).not.toContain('13:00');
    expect(slotTimes).not.toContain('13:30');

    // 14:00 must resume
    expect(slotTimes).toContain('14:00');
  });

  it('should exclude slots overlapping with existing non-cancelled appointments', async () => {
    jest.spyOn(prisma.salon, 'findUnique').mockResolvedValue(mockSalon as any);
    jest.spyOn(prisma.holiday, 'findFirst').mockResolvedValue(null);
    jest.spyOn(prisma.service, 'findFirst').mockResolvedValue(mockService as any);
    jest.spyOn(prisma.staff, 'findMany').mockResolvedValue(mockStaff as any);
    jest.spyOn(prisma.workingHours, 'findUnique').mockResolvedValue(mockWorkingHours as any);
    jest.spyOn(prisma.blockedTime, 'findMany').mockResolvedValue([]);

    // Existing appointment at 11:00 AM - 11:30 AM (UTC converted)
    const apptStartUtc = new Date('2026-09-07T05:30:00.000Z'); // 11:00 AM IST
    const apptEndUtc = new Date('2026-09-07T06:00:00.000Z');   // 11:30 AM IST

    jest.spyOn(prisma.appointment, 'findMany').mockResolvedValue([
      {
        staffId: mockStaffId,
        startTime: apptStartUtc,
        endTime: apptEndUtc,
      } as any,
    ]);

    const result = await service.getAvailableSlots(mockSalonId, mockServiceId, '2026-09-07');
    const slotTimes = result.availableSlots.map((s) => s.startTime);

    expect(slotTimes).toContain('10:30');
    expect(slotTimes).not.toContain('11:00'); // Blocked by appointment!
    expect(slotTimes).toContain('11:30');
  });
});
