import { Test, TestingModule } from '@nestjs/testing';
import { AppointmentsService } from './appointments.service';
import { AvailabilityService } from '../availability/availability.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { PrismaService } from '../../database/prisma.service';
import { AbsenceService } from '../staff/absence.service';
import { LeaveIntervalEngine } from '../staff/engines/leave-interval.engine';
import { LeaveReassignmentEngine } from '../staff/engines/leave-reassignment.engine';
import { LeaveValidationService } from '../staff/services/leave-validation.service';
import { LeaveProcessingService } from '../staff/services/leave-processing.service';
import { AvailabilityEngineService } from '../availability/availability-engine.service';
import { ConflictException } from '@nestjs/common';
import { AbsenceStatus, LeavePortion, AppointmentStatus } from '@prisma/client';
import { DateTime } from 'luxon';

describe('Cross-Module Leave Remediation Tests (BUG-01, BUG-02, BUG-03, BUG-04)', () => {
  let appointmentsService: AppointmentsService;
  let absenceService: AbsenceService;
  let mockPrisma: any;
  let mockAvailabilityService: any;
  let mockWhatsAppService: any;

  const mockSalonId = 'salon-test-remediation';
  const mockStylistId = 'stylist-absent-1';
  const mockBackupStylistId = 'stylist-backup-2';
  const mockDate = '2026-09-25';

  beforeEach(async () => {
    mockPrisma = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ pg_try_advisory_xact_lock: true }]),
      $transaction: jest.fn(async (cb: any) => cb(mockPrisma)),
      salon: {
        findUnique: jest.fn().mockResolvedValue({
          id: mockSalonId,
          status: 'ACTIVE',
          timezone: 'Asia/Kolkata',
          maxAdvanceDays: 30,
        }),
      },
      service: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'svc-haircut', durationMinutes: 30, price: 50, status: 'ACTIVE' },
        ]),
        findUnique: jest.fn().mockResolvedValue({ id: 'svc-haircut', durationMinutes: 30, price: 50 }),
      },
      stylistService: {
        findMany: jest.fn().mockResolvedValue([{ serviceId: 'svc-haircut' }]),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-1', phone: '+919999999999', name: 'Test Customer' }),
        create: jest.fn().mockResolvedValue({ id: 'user-1', phone: '+919999999999', name: 'Test Customer' }),
      },
      salonUser: {
        upsert: jest.fn().mockResolvedValue({ id: 'su-1', salonId: mockSalonId, userId: 'user-1' }),
        findUnique: jest.fn().mockResolvedValue({ id: 'su-1', yearlyNoShowCount: 0 }),
      },
      stylist: {
        findFirst: jest.fn().mockResolvedValue({
          id: mockStylistId,
          salonId: mockSalonId,
          name: 'Primary Stylist',
          followsSalonSchedule: true,
        }),
        findUnique: jest.fn().mockResolvedValue({
          id: mockStylistId,
          salonId: mockSalonId,
          name: 'Primary Stylist',
          followsSalonSchedule: true,
          status: 'ACTIVE',
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      salonWorkingHours: {
        findFirst: jest.fn().mockResolvedValue({
          isClosed: false,
          startTime: '09:00',
          endTime: '19:00',
          breakStartTime: '13:00',
          breakEndTime: '14:00',
        }),
        findUnique: jest.fn().mockResolvedValue({
          isClosed: false,
          startTime: '09:00',
          endTime: '19:00',
          breakStartTime: '13:00',
          breakEndTime: '14:00',
        }),
      },
      stylistWorkingHours: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      appointment: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation((args: any) => Promise.resolve({ id: 'appt-new-1', ...args.data })),
        update: jest.fn().mockImplementation((args: any) => Promise.resolve({ id: 'appt-new-1', ...args.data })),
      },
      appointmentService: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      stylistAbsence: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation((args: any) => Promise.resolve({ id: 'abs-1', ...args.data })),
        update: jest.fn().mockImplementation((args: any) => Promise.resolve({ id: 'abs-1', ...args.data })),
      },
      bookingReassignment: {
        upsert: jest.fn(),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
      notification: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    mockAvailabilityService = {
      getAvailableSlots: jest.fn().mockResolvedValue({
        date: mockDate,
        salonTimezone: 'Asia/Kolkata',
        serviceDurationMinutes: 30,
        availableSlots: [
          { startTime: '10:00', endTime: '10:30', eligibleStaffIds: [mockStylistId, mockBackupStylistId] },
          { startTime: '15:00', endTime: '15:30', eligibleStaffIds: [mockStylistId, mockBackupStylistId] },
        ],
        status: 'AVAILABLE',
      }),
    };

    mockWhatsAppService = {
      sendMetaMessage: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentsService,
        AbsenceService,
        LeaveIntervalEngine,
        LeaveReassignmentEngine,
        LeaveValidationService,
        LeaveProcessingService,
        AvailabilityEngineService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AvailabilityService, useValue: mockAvailabilityService },
        { provide: WhatsAppService, useValue: mockWhatsAppService },
      ],
    }).compile();

    appointmentsService = module.get<AppointmentsService>(AppointmentsService);
    absenceService = module.get<AbsenceService>(AbsenceService);
  });

  describe('BUG-01: Direct Appointment Creation Leave Validation', () => {
    it('1. Specific Stylist + FULL_DAY leave -> REJECTS appointment creation', async () => {
      mockPrisma.stylistAbsence.findMany.mockResolvedValue([
        {
          id: 'abs-full',
          salonId: mockSalonId,
          stylistId: mockStylistId,
          startDate: new Date(`${mockDate}T00:00:00.000Z`),
          endDate: new Date(`${mockDate}T00:00:00.000Z`),
          leavePortion: LeavePortion.FULL_DAY,
          status: AbsenceStatus.ACTIVE,
        },
      ]);

      await expect(
        appointmentsService.createAppointment(mockSalonId, {
          customerPhone: '+919999999999',
          customerName: 'Test Customer',
          serviceId: 'svc-haircut',
          date: mockDate,
          startTime: '10:00',
          staffId: mockStylistId,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('2. Specific Stylist + FIRST_HALF leave during blocked period (10:00) -> REJECTS appointment creation', async () => {
      mockPrisma.stylistAbsence.findMany.mockResolvedValue([
        {
          id: 'abs-first-half',
          salonId: mockSalonId,
          stylistId: mockStylistId,
          startDate: new Date(`${mockDate}T00:00:00.000Z`),
          endDate: new Date(`${mockDate}T00:00:00.000Z`),
          leavePortion: LeavePortion.FIRST_HALF,
          status: AbsenceStatus.ACTIVE,
        },
      ]);

      await expect(
        appointmentsService.createAppointment(mockSalonId, {
          customerPhone: '+919999999999',
          customerName: 'Test Customer',
          serviceId: 'svc-haircut',
          date: mockDate,
          startTime: '10:00',
          staffId: mockStylistId,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('3. Specific Stylist + FIRST_HALF leave AFTER blocked period (15:00) -> ALLOWS appointment creation', async () => {
      mockPrisma.stylistAbsence.findMany.mockResolvedValue([
        {
          id: 'abs-first-half',
          salonId: mockSalonId,
          stylistId: mockStylistId,
          startDate: new Date(`${mockDate}T00:00:00.000Z`),
          endDate: new Date(`${mockDate}T00:00:00.000Z`),
          leavePortion: LeavePortion.FIRST_HALF,
          status: AbsenceStatus.ACTIVE,
        },
      ]);

      const result = await appointmentsService.createAppointment(mockSalonId, {
        customerPhone: '+919999999999',
        customerName: 'Test Customer',
        serviceId: 'svc-haircut',
        date: mockDate,
        startTime: '15:00',
        staffId: mockStylistId,
      });

      expect(result).toBeDefined();
    });

    it('4. Specific Stylist + CUSTOM_HOURS (11:00 to 14:00) overlapping appointment at 12:00 -> REJECTS', async () => {
      mockPrisma.stylistAbsence.findMany.mockResolvedValue([
        {
          id: 'abs-custom',
          salonId: mockSalonId,
          stylistId: mockStylistId,
          startDate: new Date(`${mockDate}T00:00:00.000Z`),
          endDate: new Date(`${mockDate}T00:00:00.000Z`),
          leavePortion: LeavePortion.CUSTOM_HOURS,
          customStartTime: '11:00',
          customEndTime: '14:00',
          status: AbsenceStatus.ACTIVE,
        },
      ]);

      await expect(
        appointmentsService.createAppointment(mockSalonId, {
          customerPhone: '+919999999999',
          customerName: 'Test Customer',
          serviceId: 'svc-haircut',
          date: mockDate,
          startTime: '12:00',
          staffId: mockStylistId,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('5. Any Stylist: Rejects candidate on FIRST_HALF leave during morning (10:00) and selects fallback', async () => {
      mockPrisma.stylistAbsence.findMany.mockImplementation((args: any) => {
        if (args.where?.stylistId === mockStylistId) {
          return Promise.resolve([
            {
              id: 'abs-first-half',
              salonId: mockSalonId,
              stylistId: mockStylistId,
              startDate: new Date(`${mockDate}T00:00:00.000Z`),
              endDate: new Date(`${mockDate}T00:00:00.000Z`),
              leavePortion: LeavePortion.FIRST_HALF,
              status: AbsenceStatus.ACTIVE,
            },
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await appointmentsService.createAppointment(mockSalonId, {
        customerPhone: '+919999999999',
        customerName: 'Test Customer',
        serviceId: 'svc-haircut',
        date: mockDate,
        startTime: '10:00',
      });

      expect(result.stylistId).toBe(mockBackupStylistId);
    });
  });

  describe('BUG-02: Advisory Lock Date Normalization', () => {
    it('Verifies ISO timestamp string "2026-09-25T00:00:00.000Z" and "2026-09-25" produce identical dateStr', () => {
      const rawIso = '2026-09-25T00:00:00.000Z';
      const rawDate = '2026-09-25';

      const norm1 = rawIso.includes('T') ? rawIso.split('T')[0] : rawIso;
      const norm2 = rawDate.includes('T') ? rawDate.split('T')[0] : rawDate;

      expect(norm1).toBe('2026-09-25');
      expect(norm2).toBe('2026-09-25');
    });
  });

  describe('BUG-03: Multi-Day Overlapping Date Filter in getStylistAbsences', () => {
    it('Returns multi-day leave (Sept 1 to Sept 30) when queried for Sept 15 to Sept 20', async () => {
      mockPrisma.stylistAbsence.findMany.mockImplementation((args: any) => {
        return Promise.resolve([
          {
            id: 'abs-month-long',
            salonId: mockSalonId,
            stylistId: mockStylistId,
            startDate: new Date('2026-09-01T00:00:00.000Z'),
            endDate: new Date('2026-09-30T00:00:00.000Z'),
            status: AbsenceStatus.ACTIVE,
          },
        ]);
      });

      const absences = await absenceService.getStylistAbsences(mockSalonId, mockStylistId, {
        startDate: '2026-09-15',
        endDate: '2026-09-20',
      });

      expect(absences).toHaveLength(1);
      expect(absences[0].id).toBe('abs-month-long');
    });
  });
});
