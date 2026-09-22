import { Test, TestingModule } from '@nestjs/testing';
import { SalonsService } from './salons.service';
import { PrismaService } from '../../database/prisma.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { AvailabilityService } from '../availability/availability.service';
import { AvailabilityEngineService } from '../availability/availability-engine.service';
import { ConfigService } from '@nestjs/config';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { SalonClosureType, AppointmentStatus, DayOfWeek } from '@prisma/client';
import { DateTime } from 'luxon';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('Human-like Scenario Test Suite: Salon Closures & Emergency Holiday Management', () => {
  let salonsService: SalonsService;
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
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    appointment: {
      findMany: jest.fn(),
    },
    salonWorkingHours: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
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
  };

  const mockAppointmentsService = {
    updateStatus: jest.fn(),
    emitSalonEvent: jest.fn(),
    autoCompleteElapsedAppointments: jest.fn().mockResolvedValue(0),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalonsService,
        AvailabilityService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AppointmentsService, useValue: mockAppointmentsService },
        { provide: AvailabilityEngineService, useValue: mockAvailabilityEngineService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: WhatsAppService, useValue: mockWhatsAppService },
      ],
    }).compile();

    salonsService = module.get<SalonsService>(SalonsService);
    availabilityService = module.get<AvailabilityService>(AvailabilityService);
    appointmentsService = module.get<AppointmentsService>(AppointmentsService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  // =========================================================================
  // SCENARIO 1: PLANNED FESTIVAL HOLIDAY (DIWALI)
  // =========================================================================
  describe('Scenario 1: Planned Festival Holiday (Advance Date Blocking)', () => {
    it('S1.1: Should successfully create a planned Diwali holiday date range', async () => {
      const dto = {
        closureType: SalonClosureType.HOLIDAY,
        startDate: '2026-11-01',
        endDate: '2026-11-02',
        reason: 'Diwali Festival Holidays',
        autoCancelAppointments: true,
      };

      mockPrismaService.appointment.findMany.mockResolvedValue([]);
      mockPrismaService.salonClosure.create.mockResolvedValue({
        id: 'closure-diwali-101',
        salonId: mockSalonId,
        closureType: SalonClosureType.HOLIDAY,
        startDate: new Date('2026-11-01T00:00:00Z'),
        endDate: new Date('2026-11-02T00:00:00Z'),
        reason: dto.reason,
        affectedBookingsCount: 0,
        cancelledCount: 0,
      });

      const closure = await salonsService.createSalonClosure(mockSalonId, dto, mockAdminId);

      expect(closure.id).toBe('closure-diwali-101');
      expect(closure.reason).toBe('Diwali Festival Holidays');
      expect(mockPrismaService.salonClosure.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          salonId: mockSalonId,
          closureType: SalonClosureType.HOLIDAY,
          reason: 'Diwali Festival Holidays',
          createdByAdminId: mockAdminId,
        }),
      });
    });

    it('S1.2: AvailabilityService should intercept Diwali date and return STORE_CLOSED with zero slots', async () => {
      const holidayDateStr = '2026-11-01';

      mockPrismaService.salonClosure.findFirst.mockResolvedValue({
        id: 'closure-diwali-101',
        salonId: mockSalonId,
        closureType: SalonClosureType.HOLIDAY,
        startDate: new Date('2026-11-01T00:00:00.000Z'),
        endDate: new Date('2026-11-02T23:59:59.999Z'),
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
  // SCENARIO 2: EMERGENCY STORE CLOSURE & ZERO CUSTOMER PENALTY
  // =========================================================================
  describe('Scenario 2: Instant Emergency Store Closure (Sudden Power Cut)', () => {
    it('S2.1: Should auto-cancel active CONFIRMED & CHECKED_IN appointments with SALON_EMERGENCY reason category', async () => {
      const emergencyDto = {
        closureType: SalonClosureType.EMERGENCY_CLOSURE,
        startDate: '2026-10-10',
        endDate: '2026-10-10',
        reason: 'Sudden Transformer Explosion & Power Failure',
        autoCancelAppointments: true,
      };

      const mockActiveAppointments = [
        {
          id: 'appt-confirmed-101',
          appointmentNumber: 'APT-1001',
          customerName: 'Amit Shah',
          customerPhone: '919811122233',
          status: AppointmentStatus.CONFIRMED,
          startAt: new Date('2026-10-10T11:00:00.000Z'),
          endAt: new Date('2026-10-10T11:30:00.000Z'),
        },
        {
          id: 'appt-checkedin-102',
          appointmentNumber: 'APT-1002',
          customerName: 'Kavita Roy',
          customerPhone: '919844455566',
          status: AppointmentStatus.CHECKED_IN,
          startAt: new Date('2026-10-10T11:30:00.000Z'),
          endAt: new Date('2026-10-10T12:00:00.000Z'),
        },
      ];

      mockPrismaService.appointment.findMany.mockResolvedValue(mockActiveAppointments);
      mockPrismaService.salonClosure.create.mockResolvedValue({
        id: 'closure-emerg-202',
        salonId: mockSalonId,
        closureType: SalonClosureType.EMERGENCY_CLOSURE,
        startDate: new Date('2026-10-10T00:00:00Z'),
        endDate: new Date('2026-10-10T00:00:00Z'),
        reason: emergencyDto.reason,
        affectedBookingsCount: 2,
        cancelledCount: 2,
      });

      mockAppointmentsService.updateStatus.mockResolvedValue({ status: AppointmentStatus.CANCELLED });

      const closure = await salonsService.createSalonClosure(mockSalonId, emergencyDto, mockAdminId);

      expect(mockAppointmentsService.updateStatus).toHaveBeenCalledTimes(2);

      // Verify ZERO penalty reasonCategory = SALON_EMERGENCY
      expect(mockAppointmentsService.updateStatus).toHaveBeenNthCalledWith(
        1,
        mockSalonId,
        'appt-confirmed-101',
        {
          status: AppointmentStatus.CANCELLED,
          reason: 'Store Closure: Sudden Transformer Explosion & Power Failure',
          reasonCategory: 'SALON_EMERGENCY',
        },
      );

      expect(mockAppointmentsService.updateStatus).toHaveBeenNthCalledWith(
        2,
        mockSalonId,
        'appt-checkedin-102',
        {
          status: AppointmentStatus.CANCELLED,
          reason: 'Store Closure: Sudden Transformer Explosion & Power Failure',
          reasonCategory: 'SALON_EMERGENCY',
        },
      );

      expect(closure.cancelledCount).toBe(2);
    });

    it('S2.2: Verify IN_SERVICE (client in chair) appointments are NOT queried for cancellation', async () => {
      const emergencyDto = {
        closureType: SalonClosureType.EMERGENCY_CLOSURE,
        startDate: '2026-10-10',
        endDate: '2026-10-10',
        reason: 'Emergency Water Pipe Burst',
        autoCancelAppointments: true,
      };

      await salonsService.createSalonClosure(mockSalonId, emergencyDto, mockAdminId);

      // Verify findMany status filter explicitly excludes IN_SERVICE
      expect(mockPrismaService.appointment.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          status: {
            in: [
              AppointmentStatus.CONFIRMED,
              AppointmentStatus.CHECKED_IN,
              AppointmentStatus.PENDING_ACCEPTANCE,
              AppointmentStatus.PENDING_RESCHEDULE,
            ],
          },
        }),
        include: expect.anything(),
      });
    });
  });

  // =========================================================================
  // SCENARIO 3: PARTIAL-DAY STORE CLOSURE (CLOSING EARLY AT 14:00)
  // =========================================================================
  describe('Scenario 3: Partial-Day Store Closure (Closing Early at 14:00)', () => {
    it('S3.1: Should only cancel appointments falling inside partial-day window (14:00 - 18:00)', async () => {
      const partialDto = {
        closureType: SalonClosureType.PARTIAL_DAY,
        startDate: '2026-10-12',
        endDate: '2026-10-12',
        isPartialDay: true,
        startTime: '14:00',
        endTime: '18:00',
        reason: 'Store Renovation Work',
        autoCancelAppointments: true,
      };

      const mockAppointmentsOnDate = [
        {
          id: 'appt-morning',
          appointmentNumber: 'APT-MORN',
          startAt: new Date('2026-10-12T05:30:00.000Z'), // 11:00 AM IST (outside window)
          endAt: new Date('2026-10-12T06:00:00.000Z'),   // 11:30 AM IST
          status: AppointmentStatus.CONFIRMED,
        },
        {
          id: 'appt-afternoon',
          appointmentNumber: 'APT-AFT',
          startAt: new Date('2026-10-12T09:30:00.000Z'), // 15:00 PM IST (inside 14:00-18:00 window)
          endAt: new Date('2026-10-12T10:00:00.000Z'),   // 15:30 PM IST
          status: AppointmentStatus.CONFIRMED,
        },
      ];

      mockPrismaService.appointment.findMany.mockResolvedValue(mockAppointmentsOnDate);
      mockPrismaService.salonClosure.create.mockResolvedValue({
        id: 'closure-partial-303',
        salonId: mockSalonId,
        closureType: SalonClosureType.PARTIAL_DAY,
        startDate: new Date('2026-10-12T00:00:00Z'),
        endDate: new Date('2026-10-12T00:00:00Z'),
        isPartialDay: true,
        startTime: '14:00',
        endTime: '18:00',
        reason: partialDto.reason,
        affectedBookingsCount: 1,
        cancelledCount: 1,
      });

      mockAppointmentsService.updateStatus.mockResolvedValue({ status: AppointmentStatus.CANCELLED });

      const closure = await salonsService.createSalonClosure(mockSalonId, partialDto, mockAdminId);

      // Only 1 appointment (afternoon) should be cancelled! Morning appointment remains untouched!
      expect(mockAppointmentsService.updateStatus).toHaveBeenCalledTimes(1);
      expect(mockAppointmentsService.updateStatus).toHaveBeenCalledWith(
        mockSalonId,
        'appt-afternoon',
        expect.anything(),
      );
    });
  });

  // =========================================================================
  // SCENARIO 4: STORE REOPENING & DELETION
  // =========================================================================
  describe('Scenario 4: Store Reopening & Closure Deletion', () => {
    it('S4.1: Should delete store closure and emit SALON_CLOSURE_DELETED event', async () => {
      mockPrismaService.salonClosure.findFirst.mockResolvedValue({
        id: 'closure-diwali-101',
        salonId: mockSalonId,
      });
      mockPrismaService.salonClosure.delete.mockResolvedValue({ id: 'closure-diwali-101' });

      const result = await salonsService.deleteSalonClosure(mockSalonId, 'closure-diwali-101');

      expect(result.message).toContain('removed successfully');
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
      const invalidDto = {
        closureType: SalonClosureType.HOLIDAY,
        startDate: '2026-11-05',
        endDate: '2026-11-01',
        reason: 'Invalid Date Range',
      };

      await expect(salonsService.createSalonClosure(mockSalonId, invalidDto, mockAdminId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('S5.2: Should throw NotFoundException if salon does not exist', async () => {
      mockPrismaService.salon.findUnique.mockResolvedValue(null);

      const dto = {
        closureType: SalonClosureType.HOLIDAY,
        startDate: '2026-11-01',
        endDate: '2026-11-01',
        reason: 'Non-existent salon',
      };

      await expect(salonsService.createSalonClosure('invalid-salon-id', dto, mockAdminId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
