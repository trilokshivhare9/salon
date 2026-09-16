import { Test, TestingModule } from '@nestjs/testing';
import { AbsenceService } from './absence.service';
import { PrismaService } from '../../database/prisma.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import {
  AbsenceStatus,
  ReassignmentOutcome,
  AppointmentStatus,
  StylistStatus,
} from '@prisma/client';

import { LeaveIntervalEngine } from './engines/leave-interval.engine';
import { LeaveReassignmentEngine } from './engines/leave-reassignment.engine';
import { LeaveValidationService } from './services/leave-validation.service';
import { LeaveProcessingService } from './services/leave-processing.service';

describe('AbsenceService - Stylist Absence & Reassignment', () => {
  let service: AbsenceService;
  let mockPrisma: any;
  let mockAppointmentsService: any;
  let mockWhatsAppService: any;

  const mockSalonId = 'salon-test-123';
  const mockStylistId = 'stylist-absent-1';
  const mockReplacementStylistId = 'stylist-replacement-2';

  beforeEach(async () => {
    mockPrisma = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn(async (cb: any) => cb(mockPrisma)),
      stylist: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      salon: {
        findUnique: jest.fn().mockResolvedValue({
          id: mockSalonId,
          timezone: 'Asia/Kolkata',
          name: 'Glamour Salon',
        }),
      },
      salonWorkingHours: {
        findFirst: jest.fn().mockResolvedValue({
          isClosed: false,
          startTime: '09:00',
          endTime: '20:00',
          breakStartTime: '13:00',
          breakEndTime: '14:00',
        }),
      },
      stylistWorkingHours: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      stylistAbsence: {
        create: jest.fn().mockImplementation((args: any) => Promise.resolve({ id: 'absence-mock-123', ...args.data })),
        upsert: jest.fn().mockImplementation((args: any) => Promise.resolve({ id: 'absence-mock-123', ...args.create })),
        update: jest.fn().mockImplementation((args: any) => Promise.resolve({ id: 'absence-mock-123', ...args.data })),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      appointment: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      bookingReassignment: {
        upsert: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
      notification: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    mockAppointmentsService = {
      emitSalonEvent: jest.fn(),
      updateStatus: jest.fn(),
    };

    mockWhatsAppService = {
      sendMetaMessage: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AbsenceService,
        LeaveIntervalEngine,
        LeaveReassignmentEngine,
        LeaveValidationService,
        LeaveProcessingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AppointmentsService, useValue: mockAppointmentsService },
        { provide: WhatsAppService, useValue: mockWhatsAppService },
      ],
    }).compile();

    service = module.get<AbsenceService>(AbsenceService);
  });

  describe('Validation & Isolation', () => {
    it('T3: should reject past dates with BadRequestException', async () => {
      mockPrisma.stylist.findFirst.mockResolvedValue({
        id: mockStylistId,
        salonId: mockSalonId,
        name: 'Rahul',
      });

      await expect(
        service.markStylistAbsent(mockSalonId, mockStylistId, {
          date: '2020-01-01',
          reason: 'Sick',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('T4: should throw NotFoundException if stylist belongs to another salon', async () => {
      mockPrisma.stylist.findFirst.mockResolvedValue(null);

      await expect(
        service.markStylistAbsent(mockSalonId, 'foreign-stylist', {
          date: '2026-09-20',
          reason: 'Sick',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('Absence Creation & Reassignment Scenarios', () => {
    const futureDate = '2026-09-25';

    beforeEach(() => {
      mockPrisma.stylist.findFirst.mockResolvedValue({
        id: mockStylistId,
        salonId: mockSalonId,
        name: 'Rahul Sharma',
      });

      mockPrisma.stylistAbsence.upsert.mockResolvedValue({
        id: 'absence-abc-1',
        salonId: mockSalonId,
        stylistId: mockStylistId,
        absenceDate: new Date(`${futureDate}T00:00:00.000Z`),
        status: AbsenceStatus.ACTIVE,
      });

      mockPrisma.stylistAbsence.update.mockImplementation((args: any) => ({
        id: args.where.id,
        ...args.data,
        stylist: { id: mockStylistId, name: 'Rahul Sharma' },
      }));
    });

    it('T5: should handle stylist with 0 affected bookings cleanly', async () => {
      mockPrisma.appointment.findMany.mockResolvedValue([]);

      const result = await service.markStylistAbsent(mockSalonId, mockStylistId, {
        date: futureDate,
        reason: 'Personal Leave',
      });

      expect(result.reassignmentSummary.total).toBe(0);
      expect(result.reassignmentSummary.reassigned).toBe(0);
      expect(result.reassignmentSummary.unresolvable).toBe(0);
      expect(mockAppointmentsService.emitSalonEvent).toHaveBeenCalledWith(
        mockSalonId,
        'STAFF_UPDATED',
        expect.objectContaining({ staffId: mockStylistId, action: 'ABSENCE_MARKED' }),
      );
    });

    it('T6: should reassign booking when replacement candidate is available', async () => {
      const mockBooking = {
        id: 'appt-1',
        appointmentNumber: 'SAL-100001',
        serviceId: 'svc-haircut',
        services: [{ serviceId: 'svc-haircut' }],
        startAt: new Date('2026-09-25T05:30:00.000Z'), // 11:00 AM IST
        endAt: new Date('2026-09-25T06:00:00.000Z'),   // 11:30 AM IST
        salonUser: { user: { name: 'Pooja', phone: '+919876543210' } },
      };

      mockPrisma.appointment.findMany.mockResolvedValue([mockBooking]);

      // Replacement candidate exists and has no conflict
      mockPrisma.stylist.findMany.mockResolvedValue([
        {
          id: mockReplacementStylistId,
          name: 'Amit Patel',
          followsSalonSchedule: true,
          workingHours: [],
        },
      ]);
      mockPrisma.appointment.findFirst.mockResolvedValue(null); // No conflict

      mockPrisma.bookingReassignment.upsert.mockResolvedValue({
        id: 'reassign-1',
        appointmentId: 'appt-1',
        newStylistId: mockReplacementStylistId,
        outcome: ReassignmentOutcome.AUTO_ASSIGNED,
      });

      const result = await service.markStylistAbsent(mockSalonId, mockStylistId, {
        date: futureDate,
        reason: 'Fever',
      });

      expect(result.reassignmentSummary.total).toBe(1);
      expect(result.reassignmentSummary.reassigned).toBe(1);
      expect(result.reassignmentSummary.unresolvable).toBe(0);

      expect(mockPrisma.appointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'appt-1' },
          data: expect.objectContaining({ stylistId: mockReplacementStylistId }),
        }),
      );
    });

    it('T7: should record outcome as NO_REPLACEMENT when no candidate fits', async () => {
      const mockBooking = {
        id: 'appt-2',
        appointmentNumber: 'SAL-100002',
        serviceId: 'svc-spa',
        services: [{ serviceId: 'svc-spa' }],
        startAt: new Date('2026-09-25T07:00:00.000Z'),
        endAt: new Date('2026-09-25T08:00:00.000Z'),
        salonUser: { user: { name: 'Kavita', phone: '+919876543211' } },
      };

      mockPrisma.appointment.findMany.mockResolvedValue([mockBooking]);
      // No replacement candidates qualified or available
      mockPrisma.stylist.findMany.mockResolvedValue([]);

      mockPrisma.bookingReassignment.upsert.mockResolvedValue({
        id: 'reassign-2',
        appointmentId: 'appt-2',
        newStylistId: null,
        outcome: ReassignmentOutcome.NO_REPLACEMENT,
      });

      const result = await service.markStylistAbsent(mockSalonId, mockStylistId, {
        date: futureDate,
        reason: 'Emergency',
      });

      expect(result.reassignmentSummary.total).toBe(1);
      expect(result.reassignmentSummary.reassigned).toBe(0);
      expect(result.reassignmentSummary.unresolvable).toBe(1);
    });
  });

  describe('Absence Cancellation', () => {
    it('T14: should set absence status to CANCELLED and emit event', async () => {
      mockPrisma.stylistAbsence.findFirst.mockResolvedValue({
        id: 'abs-1',
        salonId: mockSalonId,
        stylistId: mockStylistId,
        status: AbsenceStatus.ACTIVE,
      });

      mockPrisma.stylistAbsence.update.mockResolvedValue({
        id: 'abs-1',
        status: AbsenceStatus.CANCELLED,
        stylist: { id: mockStylistId, name: 'Rahul' },
      });

      const res = await service.cancelAbsence(mockSalonId, mockStylistId, 'abs-1', 'admin-1');

      expect(res.status).toBe(AbsenceStatus.CANCELLED);
      expect(mockAppointmentsService.emitSalonEvent).toHaveBeenCalledWith(
        mockSalonId,
        'STAFF_UPDATED',
        expect.objectContaining({ action: 'ABSENCE_CANCELLED' }),
      );
    });

    it('T15: should handle full ISO date strings and use stylist: lock key', async () => {
      mockPrisma.stylist.findFirst.mockResolvedValue({ id: mockStylistId, name: 'Rahul' });
      mockPrisma.stylistAbsence.upsert.mockResolvedValue({
        id: 'abs-iso',
        status: AbsenceStatus.ACTIVE,
        affectedBookingsCount: 0,
        reassignedCount: 0,
        unresolvableCount: 0,
      });
      mockPrisma.stylistAbsence.update.mockResolvedValue({
        id: 'abs-iso',
        status: AbsenceStatus.ACTIVE,
        affectedBookingsCount: 0,
        reassignedCount: 0,
        unresolvableCount: 0,
      });
      mockPrisma.appointment.findMany.mockResolvedValue([]);

      const isoDate = '2026-10-15T14:30:00.000Z';
      const res = await service.markStylistAbsent(mockSalonId, mockStylistId, {
        date: isoDate,
        reason: 'ISO Date Test',
      });

      expect(res.absence.id).toBe('abs-iso');
      // Verify advisory lock was called with stylist: key convention
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock($1::integer, $2::integer)',
        expect.any(Number),
        expect.any(Number),
      );
    });
  });
});
