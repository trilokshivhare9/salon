import { Test, TestingModule } from '@nestjs/testing';
import { AvailabilityService } from './availability.service';
import { PrismaService } from '../../database/prisma.service';
import { DayOfWeek } from '@prisma/client';

describe('AvailabilityService (Unit Tests)', () => {
  let service: AvailabilityService;
  let prisma: PrismaService;

  const mockSalonId = 'salon-test-123';
  const mockServiceId1 = 'service-haircut-456';
  const mockServiceId2 = 'service-beard-789';
  const mockStylistId1 = 'stylist-rahul-001';
  const mockStylistId2 = 'stylist-priya-002';

  const mockSalon = {
    id: mockSalonId,
    status: 'ACTIVE',
    timezone: 'Asia/Kolkata',
    maxAdvanceDays: 30,
  };

  const mockService1 = {
    id: mockServiceId1,
    salonId: mockSalonId,
    name: 'Haircut',
    durationMinutes: 30,
    price: 350,
    status: 'ACTIVE',
  };

  const mockService2 = {
    id: mockServiceId2,
    salonId: mockSalonId,
    name: 'Beard Trim',
    durationMinutes: 15,
    price: 150,
    status: 'ACTIVE',
  };

  const mockSalonWorkingHours = {
    salonId: mockSalonId,
    dayOfWeek: DayOfWeek.MONDAY,
    isClosed: false,
    startTime: '10:00',
    endTime: '20:00',
    breakStartTime: '13:00',
    breakEndTime: '14:00',
  };

  const mockStylists = [
    {
      id: mockStylistId1,
      name: 'Rahul',
      salonId: mockSalonId,
      status: 'ACTIVE',
      followsSalonSchedule: true,
      workingHours: [],
    },
    {
      id: mockStylistId2,
      name: 'Priya (Custom Schedule)',
      salonId: mockSalonId,
      status: 'ACTIVE',
      followsSalonSchedule: false,
      workingHours: [
        {
          dayOfWeek: DayOfWeek.MONDAY,
          isWorking: true,
          startTime: '08:00',
          endTime: '16:00',
          breakStartTime: '12:00',
          breakEndTime: '12:30',
        },
      ],
    },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AvailabilityService,
        {
          provide: PrismaService,
          useValue: {
            salon: { findUnique: jest.fn() },
            service: { findMany: jest.fn() },
            salonWorkingHours: { findUnique: jest.fn() },
            stylist: { findMany: jest.fn() },
            appointment: { findMany: jest.fn() },
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

  it('should return empty slots if salon is closed on that day and no custom stylists are working', async () => {
    jest.spyOn(prisma.salon, 'findUnique').mockResolvedValue(mockSalon as any);
    jest.spyOn(prisma.service, 'findMany').mockResolvedValue([mockService1] as any);
    jest.spyOn(prisma.salonWorkingHours, 'findUnique').mockResolvedValue({
      salonId: mockSalonId,
      dayOfWeek: DayOfWeek.MONDAY,
      isClosed: true,
      startTime: '10:00',
      endTime: '20:00',
    } as any);
    // Only Rahul who follows salon schedule
    jest.spyOn(prisma.stylist, 'findMany').mockResolvedValue([mockStylists[0]] as any);
    jest.spyOn(prisma.appointment, 'findMany').mockResolvedValue([]);

    // 2026-09-14 is Monday (future date within 30-day maxAdvanceDays window)
    const result = await service.getAvailableSlots(mockSalonId, mockService1.id, '2026-09-14');
    expect(result.availableSlots).toEqual([]);
  });

  it('should exclude salon break (13:00 - 14:00) for salon-schedule stylists', async () => {
    jest.spyOn(prisma.salon, 'findUnique').mockResolvedValue(mockSalon as any);
    jest.spyOn(prisma.service, 'findMany').mockResolvedValue([mockService1] as any);
    jest.spyOn(prisma.salonWorkingHours, 'findUnique').mockResolvedValue(mockSalonWorkingHours as any);
    jest.spyOn(prisma.stylist, 'findMany').mockResolvedValue([mockStylists[0]] as any);
    jest.spyOn(prisma.appointment, 'findMany').mockResolvedValue([]);

    const result = await service.getAvailableSlots(mockSalonId, mockService1.id, '2026-09-14');
    expect(result.availableSlots.length).toBeGreaterThan(0);

    const slotTimes = result.availableSlots.map((s) => s.startTime);
    expect(slotTimes).toContain('10:00');
    expect(slotTimes).toContain('12:30');
    // 13:00 and 13:30 should not exist because service duration is 30m and break is 13:00-14:00
    expect(slotTimes).not.toContain('13:00');
    expect(slotTimes).not.toContain('13:30');
    expect(slotTimes).toContain('14:00');
  });

  it('should exclude slots overlapping with existing CONFIRMED, CHECKED_IN, or IN_SERVICE appointments', async () => {
    jest.spyOn(prisma.salon, 'findUnique').mockResolvedValue(mockSalon as any);
    jest.spyOn(prisma.service, 'findMany').mockResolvedValue([mockService1] as any);
    jest.spyOn(prisma.salonWorkingHours, 'findUnique').mockResolvedValue(mockSalonWorkingHours as any);
    jest.spyOn(prisma.stylist, 'findMany').mockResolvedValue([mockStylists[0]] as any);

    // Existing appointment 11:00 - 11:30 IST (05:30 - 06:00 UTC) on 2026-09-14
    const apptStart = new Date('2026-09-14T05:30:00.000Z');
    const apptEnd = new Date('2026-09-14T06:00:00.000Z');

    jest.spyOn(prisma.appointment, 'findMany').mockResolvedValue([
      {
        stylistId: mockStylistId1,
        startAt: apptStart,
        endAt: apptEnd,
      } as any,
    ]);

    const result = await service.getAvailableSlots(mockSalonId, mockService1.id, '2026-09-14');
    const slotTimes = result.availableSlots.map((s) => s.startTime);

    expect(slotTimes).toContain('10:30');
    expect(slotTimes).not.toContain('11:00'); // Blocked by active appointment!
    expect(slotTimes).toContain('11:30');
  });

  it('should handle multi-service duration summation correctly (30m + 15m = 45m)', async () => {
    jest.spyOn(prisma.salon, 'findUnique').mockResolvedValue(mockSalon as any);
    jest.spyOn(prisma.service, 'findMany').mockResolvedValue([mockService1, mockService2] as any);
    jest.spyOn(prisma.salonWorkingHours, 'findUnique').mockResolvedValue(mockSalonWorkingHours as any);
    jest.spyOn(prisma.stylist, 'findMany').mockResolvedValue([mockStylists[0]] as any);
    jest.spyOn(prisma.appointment, 'findMany').mockResolvedValue([]);

    const result = await service.getAvailableSlots(
      mockSalonId,
      [mockService1.id, mockService2.id],
      '2026-09-14',
    );

    expect(result.serviceDurationMinutes).toBe(45);
    const slot1000 = result.availableSlots.find((s) => s.startTime === '10:00');
    expect(slot1000).toBeDefined();
    expect(slot1000?.endTime).toBe('10:45');

    // With 45m duration and break at 13:00, 12:30 would end at 13:15, so 12:30 must be excluded
    const slotTimes = result.availableSlots.map((s) => s.startTime);
    expect(slotTimes).not.toContain('12:30');
    expect(slotTimes).toContain('12:15'); // 12:15 to 13:00 fits perfectly!
  });

  it('should allow custom-schedule stylists to operate outside salon hours independently', async () => {
    jest.spyOn(prisma.salon, 'findUnique').mockResolvedValue(mockSalon as any);
    jest.spyOn(prisma.service, 'findMany').mockResolvedValue([mockService1] as any);
    // Salon closed
    jest.spyOn(prisma.salonWorkingHours, 'findUnique').mockResolvedValue({
      salonId: mockSalonId,
      dayOfWeek: DayOfWeek.MONDAY,
      isClosed: true,
      startTime: '10:00',
      endTime: '20:00',
    } as any);
    // Only Priya (custom schedule 08:00 - 16:00)
    jest.spyOn(prisma.stylist, 'findMany').mockResolvedValue([mockStylists[1]] as any);
    jest.spyOn(prisma.appointment, 'findMany').mockResolvedValue([]);

    const result = await service.getAvailableSlots(mockSalonId, mockService1.id, '2026-09-14');
    expect(result.availableSlots.length).toBeGreaterThan(0);

    const slotTimes = result.availableSlots.map((s) => s.startTime);
    // Priya works starting from 08:00
    expect(slotTimes).toContain('08:00');
    expect(slotTimes).toContain('08:15');
  });
});
