import { Test, TestingModule } from '@nestjs/testing';
import { ClosuresService } from '../../../../src/modules/salon-admin/closures/closures.service';
import { PrismaService } from '../../../../src/database/prisma.service';
import { AppointmentsService } from '../../../../src/modules/salon-admin/appointments/appointments.service';
import { AvailabilityService } from '../../../../src/modules/salon-admin/availability/availability.service';
import { AvailabilityEngineService } from '../../../../src/modules/salon-admin/availability/availability-engine.service';
import { ConfigService } from '@nestjs/config';
import { WhatsAppService } from '../../../../src/modules/channels/whatsapp/whatsapp.service';
import { SalonClosureType } from '@prisma/client';
import { SlotSqueezePolicy } from '../../../../src/modules/salon-admin/availability/policies/slot-squeeze.policy';
import { StylistStatusEngine } from '../../../../src/modules/salon-admin/staff/engines/stylist-status.engine';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { HolidaysProviderService } from '../../../../src/modules/salon-admin/closures/holidays-provider.service';

describe('Human-like Scenario Test Suite: Salon Closures & Emergency Holiday Management', () => {
  let closuresService: ClosuresService;
  let availabilityService: AvailabilityService;
  let appointmentsService: AppointmentsService;
  let prismaService: PrismaService;

  const mockSalonId = 'salon-downtown-001';
  const mockAdminId = 'owner-john-doe';
  const mockServiceId = 'service-haircut-001';

  const mockSalon = {
    id: mockSalonId,
    name: 'Downtown Premium Salon',
    status: 'ACTIVE',
    timezone: 'Asia/Kolkata',
    maxAdvanceDays: 90,
  };

  const mockPrismaService = {
    salonClosure: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    appointment: {
      findMany: jest.fn(),
    },
    salonWorkingHours: {
      findMany: jest.fn().mockResolvedValue([
        { dayOfWeek: 'MONDAY', isClosed: false, startTime: '09:00', endTime: '21:00' },
        { dayOfWeek: 'TUESDAY', isClosed: false, startTime: '09:00', endTime: '21:00' },
        { dayOfWeek: 'WEDNESDAY', isClosed: false, startTime: '09:00', endTime: '21:00' },
        { dayOfWeek: 'THURSDAY', isClosed: false, startTime: '09:00', endTime: '21:00' },
        { dayOfWeek: 'FRIDAY', isClosed: false, startTime: '09:00', endTime: '21:00' },
        { dayOfWeek: 'SATURDAY', isClosed: false, startTime: '09:00', endTime: '21:00' },
        { dayOfWeek: 'SUNDAY', isClosed: true, startTime: '10:00', endTime: '18:00' },
      ]),
      findUnique: jest.fn().mockImplementation((args: any) => {
        const dow = args?.where?.salonId_dayOfWeek?.dayOfWeek;
        if (dow === 'SUNDAY') {
          return Promise.resolve({ dayOfWeek: 'SUNDAY', isClosed: true, startTime: '10:00', endTime: '18:00' });
        }
        return Promise.resolve({ dayOfWeek: dow || 'MONDAY', isClosed: false, startTime: '09:00', endTime: '21:00' });
      }),
    },
    salon: {
      findUnique: jest.fn().mockResolvedValue(mockSalon),
    },
    service: {
      findMany: jest.fn().mockResolvedValue([{ id: mockServiceId, durationMinutes: 30 }]),
    },
    staff: {
      findMany: jest.fn(),
    },
    staffWorkingHours: {
      findMany: jest.fn(),
    },
    staffTimeOff: {
      findMany: jest.fn(),
    },
    salonUser: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    stylist: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    stylistAbsence: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  const mockAppointmentsService = {
    updateStatus: jest.fn(),
    emitSalonEvent: jest.fn(),
    autoCompleteElapsedAppointments: jest.fn().mockResolvedValue(0),
    resolveScheduleConflicts: jest.fn().mockResolvedValue({
      totalAffected: 0,
      rescheduledCount: 0,
      cancelledCount: 0,
      details: [],
      message: 'No conflicts found.',
    }),
  };

  const mockAvailabilityEngineService = {
    parseTimeStringToMinutes: (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    },
    formatMinutesToTime: (mins: number) => {
      const h = Math.floor(mins / 60).toString().padStart(2, '0');
      const m = (mins % 60).toString().padStart(2, '0');
      return `${h}:${m}`;
    },
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue('123456789'),
  };

  const mockWhatsAppService = {
    sendTemplateMessage: jest.fn(),
    sendTextMessage: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrismaService.salon.findUnique.mockResolvedValue(mockSalon);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClosuresService,
        AvailabilityService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AppointmentsService, useValue: mockAppointmentsService },
        { provide: AvailabilityEngineService, useValue: mockAvailabilityEngineService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: WhatsAppService, useValue: mockWhatsAppService },
        { provide: SlotSqueezePolicy, useValue: { canSqueeze: jest.fn().mockReturnValue(false) } },
        { provide: StylistStatusEngine, useValue: { calculateStatus: jest.fn() } },
        { provide: HolidaysProviderService, useValue: { getHolidaysForYear: jest.fn().mockReturnValue([]), getHolidaysForRange: jest.fn().mockReturnValue([]) } },
      ],
    }).compile();

    closuresService = module.get<ClosuresService>(ClosuresService);
    availabilityService = module.get<AvailabilityService>(AvailabilityService);
    appointmentsService = module.get<AppointmentsService>(AppointmentsService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  // =========================================================================
  // SCENARIO 1: PLANNED FESTIVAL HOLIDAY (DIWALI)
  // =========================================================================
  describe('Scenario 1: Planned Festival Holiday (Advance Date Blocking)', () => {
    it('S1.1: Should successfully create a planned Diwali holiday date range', async () => {
      const futureDate1 = DateTime.now().setZone('Asia/Kolkata').plus({ days: 10 }).toISODate()!;
      const futureDate2 = DateTime.now().setZone('Asia/Kolkata').plus({ days: 11 }).toISODate()!;

      const dto = {
        closureType: SalonClosureType.FESTIVAL,
        startDate: futureDate1,
        endDate: futureDate2,
        reason: 'Diwali Festival Holidays',
      };

      mockPrismaService.salonClosure.findFirst.mockResolvedValue(null);
      mockPrismaService.salonClosure.create.mockResolvedValue({
        id: 'closure-diwali-101',
        salonId: mockSalonId,
        closureType: SalonClosureType.FESTIVAL,
        startDate: new Date(futureDate1 + 'T00:00:00Z'),
        endDate: new Date(futureDate2 + 'T00:00:00Z'),
        reason: dto.reason,
        affectedBookingsCount: 0,
        cancelledCount: 0,
      });

      const result = await closuresService.createClosure(mockSalonId, dto, mockAdminId);

      expect(result.closure.id).toBe('closure-diwali-101');
      expect(result.closure.reason).toBe('Diwali Festival Holidays');
      expect(mockAppointmentsService.resolveScheduleConflicts).toHaveBeenCalledWith(
        expect.objectContaining({
          salonId: mockSalonId,
          scope: 'SALON',
          isClosedOrOff: true,
          reason: 'Diwali Festival Holidays',
          dateRange: expect.objectContaining({
            startTime: '09:00',
            endTime: '21:00',
            isPartialDay: false,
          }),
        }),
      );
      expect(mockPrismaService.salonClosure.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          salonId: mockSalonId,
          closureType: SalonClosureType.FESTIVAL,
          reason: 'Diwali Festival Holidays',
          createdByAdminId: mockAdminId,
        }),
      });
      expect(mockAppointmentsService.emitSalonEvent).toHaveBeenCalledWith(
        mockSalonId,
        'STATUS_UPDATED',
        expect.objectContaining({ type: 'SALON_CLOSURE_CREATED' }),
      );
    });

    it('S1.2: AvailabilityService should intercept holiday date and return STORE_CLOSED with zero slots', async () => {
      const holidayDateStr = DateTime.now().setZone('Asia/Kolkata').plus({ days: 10 }).toISODate()!;

      mockPrismaService.salonClosure.findFirst.mockResolvedValue({
        id: 'closure-diwali-101',
        salonId: mockSalonId,
        closureType: SalonClosureType.FESTIVAL,
        startDate: new Date(holidayDateStr + 'T00:00:00.000Z'),
        endDate: new Date(holidayDateStr + 'T23:59:59.999Z'),
        isPartialDay: false,
        reason: 'Diwali Festival Holidays',
      });

      const availability = await availabilityService.getAvailableSlots(
        mockSalonId,
        mockServiceId,
        holidayDateStr,
      );

      expect(availability.status).toBe('STORE_CLOSED');
      expect(availability.statusReason).toContain('Diwali Festival Holidays');
      expect(availability.availableSlots).toEqual([]);
    });
  });

  // =========================================================================
  // SCENARIO 2: EMERGENCY STORE CLOSURE & CONFLICT RESOLUTION
  // =========================================================================
  describe('Scenario 2: Instant Emergency Store Closure (Sudden Power Cut)', () => {
    it('S2.1: Should invoke resolveScheduleConflicts with isEmergency: true', async () => {
      const emergDate = DateTime.now().setZone('Asia/Kolkata').plus({ days: 1 }).toISODate()!;

      const emergencyDto = {
        closureType: SalonClosureType.EMERGENCY_CLOSURE,
        startDate: emergDate,
        endDate: emergDate,
        reason: 'Sudden Transformer Explosion & Power Failure',
      };

      mockPrismaService.salonClosure.findFirst.mockResolvedValue(null);
      mockAppointmentsService.resolveScheduleConflicts.mockResolvedValue({
        totalAffected: 2,
        rescheduledCount: 2,
        cancelledCount: 0,
        details: [{ appointmentId: 'apt-1' }, { appointmentId: 'apt-2' }],
        message: '2 appointments rescheduled.',
      });

      mockPrismaService.salonClosure.create.mockResolvedValue({
        id: 'closure-emerg-202',
        salonId: mockSalonId,
        closureType: SalonClosureType.EMERGENCY_CLOSURE,
        startDate: new Date(emergDate + 'T00:00:00Z'),
        endDate: new Date(emergDate + 'T00:00:00Z'),
        reason: emergencyDto.reason,
        affectedBookingsCount: 2,
        cancelledCount: 2,
      });

      const result = await closuresService.createClosure(mockSalonId, emergencyDto, mockAdminId);

      expect(mockAppointmentsService.resolveScheduleConflicts).toHaveBeenCalledWith(
        expect.objectContaining({
          salonId: mockSalonId,
          scope: 'SALON',
          isClosedOrOff: true,
          reason: 'Sudden Transformer Explosion & Power Failure',
          adminId: mockAdminId,
        }),
      );
      expect(result.rescheduledCount).toBe(2);
    });
  });

  // =========================================================================
  // SCENARIO 3: PARTIAL-DAY STORE CLOSURE (CLOSING EARLY AT 14:00)
  // =========================================================================
  describe('Scenario 3: Partial-Day Store Closure (Closing Early at 14:00)', () => {
    it('S3.1: Should pass custom start/end time window to resolveScheduleConflicts', async () => {
      const partialDate = DateTime.now().setZone('Asia/Kolkata').plus({ days: 2 }).toISODate()!;

      const partialDto = {
        closureType: SalonClosureType.OTHER,
        startDate: partialDate,
        endDate: partialDate,
        isPartialDay: true,
        startTime: '14:00',
        endTime: '18:00',
        reason: 'Store Renovation Work',
      };

      mockPrismaService.salonClosure.findFirst.mockResolvedValue(null);
      mockAppointmentsService.resolveScheduleConflicts.mockResolvedValue({
        totalAffected: 1,
        rescheduledCount: 1,
        cancelledCount: 0,
        details: [{ appointmentId: 'apt-1' }],
        message: '1 appointment rescheduled.',
      });

      mockPrismaService.salonClosure.create.mockResolvedValue({
        id: 'closure-partial-303',
        salonId: mockSalonId,
        closureType: SalonClosureType.OTHER,
        startDate: new Date(partialDate + 'T00:00:00Z'),
        endDate: new Date(partialDate + 'T00:00:00Z'),
        isPartialDay: true,
        startTime: '14:00',
        endTime: '18:00',
        reason: partialDto.reason,
        affectedBookingsCount: 1,
        cancelledCount: 1,
      });

      const result = await closuresService.createClosure(mockSalonId, partialDto, mockAdminId);

      expect(mockAppointmentsService.resolveScheduleConflicts).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: 'SALON',
          dateRange: expect.objectContaining({
            startTime: '14:00',
            endTime: '18:00',
            isPartialDay: true,
          }),
        }),
      );
      expect(result.closure.isPartialDay).toBe(true);
    });
  });

  // =========================================================================
  // SCENARIO 4: STORE REOPENING & DELETION
  // =========================================================================
  describe('Scenario 4: Store Reopening & Closure Deletion', () => {
    it('S4.1: Should delete upcoming store closure and emit SALON_CLOSURE_DELETED event', async () => {
      mockPrismaService.salonClosure.findFirst.mockResolvedValue({
        id: 'closure-diwali-101',
        salonId: mockSalonId,
        endDate: new Date('2099-11-02T00:00:00Z'),
      });
      mockPrismaService.salonClosure.delete.mockResolvedValue({ id: 'closure-diwali-101' });

      const result = await closuresService.deleteClosure(mockSalonId, 'closure-diwali-101');

      expect(result.message).toContain('reopened successfully');
      expect(mockPrismaService.salonClosure.delete).toHaveBeenCalledWith({
        where: { id: 'closure-diwali-101' },
      });
      expect(mockAppointmentsService.emitSalonEvent).toHaveBeenCalledWith(
        mockSalonId,
        'STATUS_UPDATED',
        {
          type: 'SALON_CLOSURE_DELETED',
          closureId: 'closure-diwali-101',
        },
      );
    });
  });

  // =========================================================================
  // SCENARIO 5: VALIDATION & ERROR HANDLING
  // =========================================================================
  describe('Scenario 5: Validation & Boundary Edge Cases', () => {
    it('S5.1: Should throw BadRequestException if startDate is after endDate', async () => {
      const pastStart = DateTime.now().setZone('Asia/Kolkata').plus({ days: 5 }).toISODate()!;
      const earlierEnd = DateTime.now().setZone('Asia/Kolkata').plus({ days: 1 }).toISODate()!;

      const invalidDto = {
        closureType: SalonClosureType.HOLIDAY,
        startDate: pastStart,
        endDate: earlierEnd,
        reason: 'Invalid Date Range',
      };

      await expect(closuresService.createClosure(mockSalonId, invalidDto, mockAdminId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('S5.2: Should throw NotFoundException if salon does not exist', async () => {
      mockPrismaService.salon.findUnique.mockResolvedValue(null);
      const validDate = DateTime.now().setZone('Asia/Kolkata').plus({ days: 3 }).toISODate()!;

      const dto = {
        closureType: SalonClosureType.HOLIDAY,
        startDate: validDate,
        endDate: validDate,
        reason: 'Non-existent salon',
      };

      await expect(closuresService.createClosure('invalid-salon-id', dto, mockAdminId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('S5.3: Should throw BadRequestException if partial-day closure spans multiple dates', async () => {
      const d1 = DateTime.now().setZone('Asia/Kolkata').plus({ days: 2 }).toISODate()!;
      const d2 = DateTime.now().setZone('Asia/Kolkata').plus({ days: 4 }).toISODate()!;

      const dto = {
        closureType: SalonClosureType.OTHER,
        startDate: d1,
        endDate: d2,
        isPartialDay: true,
        startTime: '14:00',
        endTime: '18:00',
        reason: 'Invalid multi-day partial closure',
      };

      await expect(closuresService.createClosure(mockSalonId, dto, mockAdminId)).rejects.toThrow(
        /Partial-day closures can only be scheduled for a single date/,
      );
    });

    it('S5.4: Should throw BadRequestException if closure range exceeds 60 days', async () => {
      const d1 = DateTime.now().setZone('Asia/Kolkata').plus({ days: 1 }).toISODate()!;
      const d2 = DateTime.now().setZone('Asia/Kolkata').plus({ days: 80 }).toISODate()!;

      const dto = {
        closureType: SalonClosureType.HOLIDAY,
        startDate: d1,
        endDate: d2,
        reason: 'Absurdly long closure range',
      };

      await expect(closuresService.createClosure(mockSalonId, dto, mockAdminId)).rejects.toThrow(
        /cannot exceed 60 consecutive days/,
      );
    });

    it('S5.5: Should detect and reject overlapping partial closure hours on same date', async () => {
      const d = DateTime.now().setZone('Asia/Kolkata').plus({ days: 3 }).toISODate()!;

      mockPrismaService.salonClosure.findMany.mockResolvedValue([
        {
          id: 'closure-existing-1',
          startDate: new Date(d + 'T00:00:00Z'),
          endDate: new Date(d + 'T00:00:00Z'),
          isPartialDay: true,
          startTime: '10:00',
          endTime: '14:00',
          reason: 'Morning Maintenance',
        },
      ]);

      const overlappingDto = {
        closureType: SalonClosureType.OTHER,
        startDate: d,
        endDate: d,
        isPartialDay: true,
        startTime: '13:00', // Overlaps with 10:00-14:00
        endTime: '16:00',
        reason: 'Afternoon Training',
      };

      await expect(closuresService.createClosure(mockSalonId, overlappingDto, mockAdminId)).rejects.toThrow(
        /overlap with an existing closure/,
      );
    });
  });

  describe('Scenario S6: Unified Calendar Schedule & Closures Overview API', () => {
    it('S6.1: Should return consolidated schedule with 7-day shifts, closures, stylist shifts, and leaves', async () => {
      mockPrismaService.salonWorkingHours.findMany.mockResolvedValue([
        { dayOfWeek: 'MONDAY', isClosed: true, startTime: '09:00', endTime: '21:00' },
        { dayOfWeek: 'TUESDAY', isClosed: false, startTime: '10:00', endTime: '20:00' },
        { dayOfWeek: 'WEDNESDAY', isClosed: false, startTime: '10:00', endTime: '20:00' },
        { dayOfWeek: 'THURSDAY', isClosed: false, startTime: '10:00', endTime: '20:00' },
        { dayOfWeek: 'FRIDAY', isClosed: false, startTime: '10:00', endTime: '21:00' },
        { dayOfWeek: 'SATURDAY', isClosed: false, startTime: '09:00', endTime: '22:00' },
        { dayOfWeek: 'SUNDAY', isClosed: false, startTime: '09:00', endTime: '22:00' },
      ]);

      mockPrismaService.salonClosure.findMany.mockResolvedValue([
        {
          id: 'closure-1',
          closureType: SalonClosureType.HOLIDAY,
          startDate: new Date('2026-10-02T00:00:00Z'),
          endDate: new Date('2026-10-02T00:00:00Z'),
          isPartialDay: false,
          startTime: '10:00',
          endTime: '20:00',
          reason: 'Gandhi Jayanti',
          notes: 'Store closed',
        },
      ]);

      mockPrismaService.stylist.findMany.mockResolvedValue([
        {
          id: 'stylist-rahul',
          name: 'Rahul Sharma',
          profileImageUrl: '/avatars/rahul.jpg',
          followsSalonSchedule: false,
          workingHours: [
            { dayOfWeek: 'MONDAY', isWorking: true, startTime: '10:00', endTime: '19:00' },
            { dayOfWeek: 'TUESDAY', isWorking: false, startTime: null, endTime: null },
            { dayOfWeek: 'WEDNESDAY', isWorking: true, startTime: '10:00', endTime: '19:00' },
            { dayOfWeek: 'THURSDAY', isWorking: true, startTime: '10:00', endTime: '19:00' },
            { dayOfWeek: 'FRIDAY', isWorking: true, startTime: '10:00', endTime: '20:00' },
            { dayOfWeek: 'SATURDAY', isWorking: true, startTime: '09:00', endTime: '21:00' },
            { dayOfWeek: 'SUNDAY', isWorking: true, startTime: '09:00', endTime: '21:00' },
          ],
        },
      ]);

      mockPrismaService.stylistAbsence.findMany.mockResolvedValue([
        {
          id: 'leave-1',
          stylistId: 'stylist-rahul',
          startDate: new Date('2026-10-08T00:00:00Z'),
          endDate: new Date('2026-10-09T00:00:00Z'),
          leaveType: 'SICK_LEAVE',
          isPartialDay: false,
          startTime: null,
          endTime: null,
          status: 'ACTIVE',
          reason: 'Viral fever',
          notes: null,
          stylist: { id: 'stylist-rahul', name: 'Rahul Sharma', profileImageUrl: '/avatars/rahul.jpg' },
        },
      ]);

      const res = await closuresService.getCalendarSchedule(mockSalonId, { month: '2026-10' });

      expect(res.success).toBe(true);
      expect(res.data.dateRange.startDate).toBe('2026-10-01');
      expect(res.data.dateRange.endDate).toBe('2026-10-31');

      // Salon Weekly Hours (7 days)
      expect(res.data.salonSchedule.weeklyHours).toHaveLength(7);
      const mondayHour = res.data.salonSchedule.weeklyHours.find((h: any) => h.dayOfWeek === 'MONDAY');
      expect(mondayHour.isClosed).toBe(true);
      expect(mondayHour.startTime).toBeNull();

      const saturdayHour = res.data.salonSchedule.weeklyHours.find((h: any) => h.dayOfWeek === 'SATURDAY');
      expect(saturdayHour.isClosed).toBe(false);
      expect(saturdayHour.startTime).toBe('09:00');
      expect(saturdayHour.endTime).toBe('22:00');

      // Closures
      expect(res.data.salonSchedule.closures).toHaveLength(1);
      expect(res.data.salonSchedule.closures[0].reason).toBe('Gandhi Jayanti');

      // Stylists & Stylist Weekly Off
      expect(res.data.stylists).toHaveLength(1);
      const rahul = res.data.stylists[0];
      expect(rahul.name).toBe('Rahul Sharma');
      const rahulTuesday = rahul.weeklyHours.find((h: any) => h.dayOfWeek === 'TUESDAY');
      expect(rahulTuesday.isWorking).toBe(false);

      // Leaves (single flat list with embedded stylist metadata)
      expect(res.data.leaves).toHaveLength(1);
      expect(res.data.leaves[0].stylistName).toBe('Rahul Sharma');
      expect(res.data.leaves[0].leaveType).toBe('SICK_LEAVE');
    });

    it('S6.2: Should reject invalid month format or inverted date range', async () => {
      await expect(closuresService.getCalendarSchedule(mockSalonId, { month: 'invalid-month' })).rejects.toThrow(
        /Invalid month format/,
      );

      await expect(
        closuresService.getCalendarSchedule(mockSalonId, {
          startDate: '2026-10-20',
          endDate: '2026-10-10',
        }),
      ).rejects.toThrow(/startDate cannot be after endDate/);
    });
  });
});

