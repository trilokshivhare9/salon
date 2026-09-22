import { Test, TestingModule } from '@nestjs/testing';
import { SalonsService } from './salons.service';
import { PrismaService } from '../../database/prisma.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { AvailabilityService } from '../availability/availability.service';
import { AvailabilityEngineService } from '../availability/availability-engine.service';
import { ConfigService } from '@nestjs/config';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { SalonClosureType, AppointmentStatus } from '@prisma/client';

describe('Production Suite: Salon Closures, Quick Bookings & Auto Service Completion', () => {
  let salonsService: SalonsService;
  let appointmentsService: AppointmentsService;
  let prismaService: PrismaService;

  const mockSalonId = 'salon-prod-001';
  const mockAdminId = 'admin-owner-001';

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
      update: jest.fn(),
    },
    salonWorkingHours: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    salon: {
      findUnique: jest.fn().mockResolvedValue(mockSalon),
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
    autoCompleteElapsedAppointments: jest.fn().mockResolvedValue(0),
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
    appointmentsService = module.get<AppointmentsService>(AppointmentsService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  describe('1. Past Checked-In Quick Booking Protection During Emergency Closure', () => {
    it('should silently auto-complete past checked-in bookings (endAt <= now) and NOT send WhatsApp cancellation', async () => {
      const todayStr = new Date().toISOString().split('T')[0];
      const dto = {
        closureType: SalonClosureType.EMERGENCY_CLOSURE,
        startDate: todayStr,
        endDate: todayStr,
        reason: 'Sudden Power Grid Failure',
        autoCancelAppointments: true,
      };

      // Past checked-in appointment (3:15 PM visit that ended at 3:45 PM)
      const pastCheckedInAppt = {
        id: 'appt-past-315pm',
        appointmentNumber: 'SAL-818869',
        customerName: 'Trilok Shivhare',
        status: AppointmentStatus.CHECKED_IN,
        startAt: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3 hours ago
        endAt: new Date(Date.now() - 2 * 60 * 60 * 1000),   // 2 hours ago
      };

      // Future appointment (6:00 PM visit)
      const futureAppt = {
        id: 'appt-future-600pm',
        appointmentNumber: 'SAL-999000',
        customerName: 'Rahul Verma',
        status: AppointmentStatus.CONFIRMED,
        startAt: new Date(Date.now() + 1 * 60 * 60 * 1000), // 1 hour in future
        endAt: new Date(Date.now() + 2 * 60 * 60 * 1000),   // 2 hours in future
      };

      mockPrismaService.appointment.findMany.mockResolvedValue([pastCheckedInAppt, futureAppt]);
      mockPrismaService.appointment.update.mockResolvedValue({ ...pastCheckedInAppt, status: AppointmentStatus.COMPLETED });
      mockPrismaService.salonClosure.create.mockResolvedValue({
        id: 'closure-emerg-999',
        salonId: mockSalonId,
        closureType: dto.closureType,
        startDate: new Date(),
        endDate: new Date(),
        reason: dto.reason,
        affectedBookingsCount: 2,
        cancelledCount: 1,
      });

      mockAppointmentsService.updateStatus.mockResolvedValue({ status: AppointmentStatus.CANCELLED });

      const closure = await salonsService.createSalonClosure(mockSalonId, dto, mockAdminId);

      // Past appt should be silently updated to COMPLETED in database
      expect(mockPrismaService.appointment.update).toHaveBeenCalledWith({
        where: { id: 'appt-past-315pm' },
        data: { status: AppointmentStatus.COMPLETED, notes: 'Auto-completed upon store closure' },
      });

      // updateStatus (which sends WhatsApp cancellation notice) should ONLY be called for futureAppt!
      expect(mockAppointmentsService.updateStatus).toHaveBeenCalledTimes(1);
      expect(mockAppointmentsService.updateStatus).toHaveBeenCalledWith(
        mockSalonId,
        'appt-future-600pm',
        {
          status: AppointmentStatus.CANCELLED,
          reason: 'Store Closure: Sudden Power Grid Failure',
          reasonCategory: 'SALON_EMERGENCY',
        },
      );

      expect(closure.cancelledCount).toBe(1);
    });
  });

  describe('2. Strict Status Exclusions for Auto-Completion', () => {
    it('autoCompleteElapsedAppointments should ONLY target CHECKED_IN or IN_SERVICE and exclude CANCELLED/CONFIRMED(un-checked-in)', async () => {
      // Create actual AppointmentsService instance with real prisma mock
      const realAppointmentsService = new AppointmentsService(
        prismaService,
        null as any,
        mockAvailabilityEngineService as any,
        null as any,
      );

      const pastTime = new Date(Date.now() - 1 * 60 * 60 * 1000);

      mockPrismaService.appointment.findMany.mockResolvedValue([
        { id: 'appt-checked-in', salonId: mockSalonId, appointmentNumber: 'APT-1', status: AppointmentStatus.CHECKED_IN, endAt: pastTime },
      ]);
      mockPrismaService.appointment.update.mockResolvedValue({ id: 'appt-checked-in', status: AppointmentStatus.COMPLETED });

      const completedCount = await realAppointmentsService.autoCompleteElapsedAppointments(mockSalonId);

      expect(mockPrismaService.appointment.findMany).toHaveBeenCalledWith({
        where: {
          salonId: mockSalonId,
          status: { in: [AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_SERVICE] },
          endAt: { lte: expect.any(Date) },
        },
        select: expect.anything(),
      });

      expect(completedCount).toBe(1);
    });
  });
});
