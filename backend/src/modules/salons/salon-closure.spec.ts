import { Test, TestingModule } from '@nestjs/testing';
import { SalonsService } from './salons.service';
import { PrismaService } from '../../database/prisma.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { AvailabilityService } from '../availability/availability.service';
import { AvailabilityEngineService } from '../availability/availability-engine.service';
import { ConfigService } from '@nestjs/config';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { SalonClosureType, AppointmentStatus } from '@prisma/client';
import { DateTime } from 'luxon';

describe('Salon Closures & Emergency Holiday Management Suite', () => {
  let salonsService: SalonsService;
  let availabilityService: AvailabilityService;
  let appointmentsService: AppointmentsService;
  let prismaService: PrismaService;

  const mockSalonId = 'salon-test-123';
  const mockAdminId = 'admin-test-456';

  const mockPrismaService = {
    salonClosure: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    appointment: {
      findMany: jest.fn(),
    },
    salonWorkingHours: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    salon: {
      findUnique: jest.fn().mockResolvedValue({
        id: mockSalonId,
        status: 'ACTIVE',
        timezone: 'Asia/Kolkata',
        maxAdvanceDays: 365,
      }),
    },
    service: {
      findMany: jest.fn().mockResolvedValue([{ id: 'service-1', durationMinutes: 30 }]),
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
  };

  const mockAppointmentsService = {
    updateStatus: jest.fn(),
    emitSalonEvent: jest.fn(),
  };

  const mockAvailabilityEngineService = {
    parseTimeStringToMinutes: jest.fn(),
    formatMinutesToTime: jest.fn(),
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

  describe('1. Store Closures List & Fetching', () => {
    it('should fetch active and upcoming store closures for a salon', async () => {
      const mockClosures = [
        {
          id: 'closure-1',
          salonId: mockSalonId,
          closureType: SalonClosureType.HOLIDAY,
          startDate: new Date('2026-11-01T00:00:00.000Z'),
          endDate: new Date('2026-11-01T23:59:59.999Z'),
          reason: 'Diwali Festival Holiday',
          cancelledCount: 0,
          createdAt: new Date(),
        },
      ];

      mockPrismaService.salonClosure.findMany.mockResolvedValue(mockClosures);

      const result = await salonsService.getSalonClosures(mockSalonId);
      expect(result).toHaveLength(1);
      expect(result[0].reason).toBe('Diwali Festival Holiday');
      expect(mockPrismaService.salonClosure.findMany).toHaveBeenCalledWith({
        where: { salonId: mockSalonId },
        orderBy: { startDate: 'desc' },
        include: {
          createdByAdmin: {
            select: { id: true, name: true, email: true },
          },
        },
      });
    });
  });

  describe('2. Emergency Store Closure & Zero Customer Penalty Cancellation', () => {
    it('should create emergency closure and auto-cancel conflicting active appointments zero-penalty', async () => {
      const dto = {
        closureType: SalonClosureType.EMERGENCY_CLOSURE,
        startDate: '2026-10-15',
        endDate: '2026-10-15',
        reason: 'Sudden Power Outage & Grid Maintenance',
        autoCancelAppointments: true,
      };

      const mockConflictingAppointments = [
        {
          id: 'appt-1',
          customerName: 'Rahul Kumar',
          customerPhone: '919876543210',
          status: AppointmentStatus.CONFIRMED,
          startAt: new Date('2026-10-15T14:00:00.000Z'),
          endAt: new Date('2026-10-15T14:30:00.000Z'),
        },
        {
          id: 'appt-2',
          customerName: 'Priya Sharma',
          customerPhone: '919876543211',
          status: AppointmentStatus.CHECKED_IN,
          startAt: new Date('2026-10-15T15:00:00.000Z'),
          endAt: new Date('2026-10-15T15:30:00.000Z'),
        },
      ];

      mockPrismaService.appointment.findMany.mockResolvedValue(mockConflictingAppointments);
      mockPrismaService.salonClosure.create.mockResolvedValue({
        id: 'closure-emerg-1',
        salonId: mockSalonId,
        closureType: dto.closureType,
        startDate: new Date('2026-10-15T00:00:00.000Z'),
        endDate: new Date('2026-10-15T23:59:59.999Z'),
        reason: dto.reason,
        cancelledCount: 2,
        affectedBookingsCount: 2,
        createdByAdminId: mockAdminId,
      });

      mockAppointmentsService.updateStatus.mockResolvedValue({ status: AppointmentStatus.CANCELLED });

      const result = await salonsService.createSalonClosure(mockSalonId, dto, mockAdminId);

      expect(mockPrismaService.appointment.findMany).toHaveBeenCalled();
      expect(mockAppointmentsService.updateStatus).toHaveBeenCalledTimes(2);

      // Verify zero penalty reason category was passed
      expect(mockAppointmentsService.updateStatus).toHaveBeenNthCalledWith(
        1,
        mockSalonId,
        'appt-1',
        {
          status: AppointmentStatus.CANCELLED,
          reason: 'Store Closure: Sudden Power Outage & Grid Maintenance',
          reasonCategory: 'SALON_EMERGENCY',
        },
      );

      expect(result.cancelledCount).toBe(2);
    });
  });

  describe('3. Availability Engine Interception for Closed Dates', () => {
    it('should return STORE_CLOSED and zero available slots when date falls on store closure', async () => {
      const tomorrow = DateTime.now().setZone('Asia/Kolkata').plus({ days: 1 });
      const tomorrowStr = tomorrow.toFormat('yyyy-MM-dd');

      mockPrismaService.salon.findUnique.mockResolvedValue({
        id: mockSalonId,
        status: 'ACTIVE',
        timezone: 'Asia/Kolkata',
        maxAdvanceDays: 365,
      });

      mockPrismaService.salonClosure.findFirst.mockResolvedValue({
        id: 'closure-diwali',
        salonId: mockSalonId,
        closureType: SalonClosureType.HOLIDAY,
        startDate: tomorrow.startOf('day').toJSDate(),
        endDate: tomorrow.endOf('day').toJSDate(),
        reason: 'Diwali Store Holiday',
      });

      const availability = await availabilityService.getAvailableSlots(
        mockSalonId,
        'service-1',
        tomorrowStr,
      );

      expect(availability.status).toBe('STORE_CLOSED');
      expect(availability.statusReason).toContain('Diwali Store Holiday');
      expect(availability.availableSlots).toEqual([]);
    });
  });

  describe('4. Store Reopening & Closure Deletion', () => {
    it('should delete a store closure and reopen booking calendar', async () => {
      mockPrismaService.salonClosure.findFirst.mockResolvedValue({
        id: 'closure-1',
        salonId: mockSalonId,
      });
      mockPrismaService.salonClosure.delete.mockResolvedValue({ id: 'closure-1' });

      const res = await salonsService.deleteSalonClosure(mockSalonId, 'closure-1');
      expect(res.message).toContain('removed successfully');
      expect(mockPrismaService.salonClosure.delete).toHaveBeenCalledWith({
        where: { id: 'closure-1' },
      });
    });
  });
});
