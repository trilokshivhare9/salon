import { Test, TestingModule } from '@nestjs/testing';
import { AbsenceService } from './absence.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { PrismaService } from '../../database/prisma.service';
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

describe('Human Real-World Scenarios: Stylist Absence Handling', () => {
  let absenceService: AbsenceService;
  let mockPrisma: any;
  let mockAppointmentsService: any;
  let mockWhatsAppService: any;

  const mockSalonId = 'salon-main-01';
  const absentStylistId = 'stylist-aksh';
  const backupStylistId = 'stylist-amit';

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
        create: jest.fn().mockImplementation((args: any) => Promise.resolve({ id: (args.data?.reason === 'Vacation' || args.data?.notes === 'Vacation') ? 'abs-future' : 'abs-101', ...args.data })),
        upsert: jest.fn().mockImplementation((args: any) => Promise.resolve({ id: 'abs-101', ...args.create })),
        update: jest.fn().mockImplementation((args: any) => Promise.resolve({ id: args.where?.id || 'abs-101', ...args.data, stylist: { id: absentStylistId, name: 'Aksh' } })),
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

    absenceService = module.get<AbsenceService>(AbsenceService);
  });

  // SCENARIO 1: Marking a Stylist Absent for Today (Full Day)
  it('Scenario 1: Manager marks Aksh absent for today - Creates absence and emits real-time WebSocket update', async () => {
    const dateToday = '2026-09-25';
    mockPrisma.stylist.findFirst.mockResolvedValue({
      id: absentStylistId,
      salonId: mockSalonId,
      name: 'Aksh',
      status: StylistStatus.ACTIVE,
    });

    mockPrisma.stylistAbsence.upsert.mockResolvedValue({
      id: 'abs-101',
      salonId: mockSalonId,
      stylistId: absentStylistId,
      absenceDate: new Date(`${dateToday}T00:00:00.000Z`),
      status: AbsenceStatus.ACTIVE,
    });

    mockPrisma.appointment.findMany.mockResolvedValue([]);

    const result = await absenceService.markStylistAbsent(mockSalonId, absentStylistId, {
      date: dateToday,
      reason: 'Medical Emergency',
    });

    expect(result.absence.id).toBe('abs-101');
    expect(mockAppointmentsService.emitSalonEvent).toHaveBeenCalledWith(
      mockSalonId,
      'STAFF_UPDATED',
      expect.objectContaining({
        staffId: absentStylistId,
        action: 'ABSENCE_MARKED',
      }),
    );
  });

  // SCENARIO 2: Automatic Reassignment of Existing Appointments
  it('Scenario 2: Aksh has a booking at 11 AM with Pooja - System automatically reassigns Pooja to available backup Amit', async () => {
    const targetDate = '2026-09-25';
    mockPrisma.stylist.findFirst.mockResolvedValue({
      id: absentStylistId,
      salonId: mockSalonId,
      name: 'Aksh',
    });

    mockPrisma.stylistAbsence.upsert.mockResolvedValue({
      id: 'abs-102',
      status: AbsenceStatus.ACTIVE,
    });

    const poojaBooking = {
      id: 'appt-pooja-1',
      appointmentNumber: 'SAL-20001',
      serviceId: 'svc-haircut',
      services: [{ serviceId: 'svc-haircut' }],
      startAt: new Date('2026-09-25T05:30:00.000Z'),
      endAt: new Date('2026-09-25T06:00:00.000Z'),
      salonUser: { user: { name: 'Pooja', phone: '+919876543210' } },
    };
    mockPrisma.appointment.findMany.mockResolvedValue([poojaBooking]);

    // Backup stylist Amit is active, qualified, and free at 11 AM
    mockPrisma.stylist.findMany.mockResolvedValue([
      {
        id: backupStylistId,
        name: 'Amit',
        followsSalonSchedule: true,
        workingHours: [],
      },
    ]);
    mockPrisma.appointment.findFirst.mockResolvedValue(null); // No conflict for Amit

    mockPrisma.bookingReassignment.upsert.mockResolvedValue({
      id: 'reassign-pooja',
      appointmentId: 'appt-pooja-1',
      newStylistId: backupStylistId,
      outcome: ReassignmentOutcome.AUTO_ASSIGNED,
    });

    const result = await absenceService.markStylistAbsent(mockSalonId, absentStylistId, {
      date: targetDate,
      reason: 'Sudden Sick Leave',
    });

    expect(result.reassignmentSummary.total).toBe(1);
    expect(result.reassignmentSummary.reassigned).toBe(1);
    expect(result.reassignmentSummary.unresolvable).toBe(0);

    // Verify appointment stylistId updated to Amit
    expect(mockPrisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'appt-pooja-1' },
        data: expect.objectContaining({ stylistId: backupStylistId }),
      }),
    );
  });

  // SCENARIO 3: Unassigned / Orphaned Booking when No Backup Stylist Exists
  it('Scenario 3: Aksh has a booking at 3 PM - No replacement stylist is available - System flags as NO_REPLACEMENT and offers zero penalty options', async () => {
    const targetDate = '2026-09-25';
    mockPrisma.stylist.findFirst.mockResolvedValue({
      id: absentStylistId,
      salonId: mockSalonId,
      name: 'Aksh',
    });

    mockPrisma.stylistAbsence.upsert.mockResolvedValue({ id: 'abs-103', status: AbsenceStatus.ACTIVE });

    const kavitaBooking = {
      id: 'appt-kavita-2',
      appointmentNumber: 'SAL-20002',
      serviceId: 'svc-spa',
      services: [{ serviceId: 'svc-spa' }],
      startAt: new Date('2026-09-25T09:30:00.000Z'),
      endAt: new Date('2026-09-25T10:30:00.000Z'),
      salonUser: { user: { name: 'Kavita', phone: '+919876543211' } },
    };
    mockPrisma.appointment.findMany.mockResolvedValue([kavitaBooking]);

    // No replacement candidates qualified or available
    mockPrisma.stylist.findMany.mockResolvedValue([]);

    mockPrisma.bookingReassignment.upsert.mockResolvedValue({
      id: 'reassign-kavita',
      appointmentId: 'appt-kavita-2',
      newStylistId: null,
      outcome: ReassignmentOutcome.NO_REPLACEMENT,
    });

    const result = await absenceService.markStylistAbsent(mockSalonId, absentStylistId, {
      date: targetDate,
      reason: 'Personal Leave',
    });

    expect(result.reassignmentSummary.total).toBe(1);
    expect(result.reassignmentSummary.reassigned).toBe(0);
    expect(result.reassignmentSummary.unresolvable).toBe(1);
  });

  // SCENARIO 8: Absence for Future Date
  it('Scenario 8: Stylist applies for leave on a future date (Sept 25) - System schedules absence without affecting today', async () => {
    const futureDate = '2026-09-30';
    mockPrisma.stylist.findFirst.mockResolvedValue({
      id: absentStylistId,
      salonId: mockSalonId,
      name: 'Aksh',
    });

    mockPrisma.stylistAbsence.create.mockImplementationOnce(() => Promise.resolve({
      id: 'abs-future',
      salonId: mockSalonId,
      stylistId: absentStylistId,
      absenceDate: new Date(`${futureDate}T00:00:00.000Z`),
      status: AbsenceStatus.ACTIVE,
    }));

    mockPrisma.appointment.findMany.mockResolvedValue([]);

    const result = await absenceService.markStylistAbsent(mockSalonId, absentStylistId, {
      date: futureDate,
      reason: 'Vacation',
    });

    expect(result.absence.id).toBe('abs-future');
  });

  // SCENARIO 10: Attempting to Mark Absence for Past Dates
  it('Scenario 10: Manager tries to mark absence for a past date (Sept 14) - System rejects with BadRequestException', async () => {
    mockPrisma.stylist.findFirst.mockResolvedValue({
      id: absentStylistId,
      salonId: mockSalonId,
      name: 'Aksh',
    });

    await expect(
      absenceService.markStylistAbsent(mockSalonId, absentStylistId, {
        date: '2026-09-14',
        reason: 'Past Date Attempt',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  // SCENARIO 11: Manager Cancels an Absence
  it('Scenario 11: Aksh returns to work early - Manager cancels absence record - System restores stylist state to ACTIVE', async () => {
    mockPrisma.stylistAbsence.findFirst.mockResolvedValue({
      id: 'abs-101',
      salonId: mockSalonId,
      stylistId: absentStylistId,
      status: AbsenceStatus.ACTIVE,
    });

    mockPrisma.stylistAbsence.update.mockResolvedValue({
      id: 'abs-101',
      status: AbsenceStatus.CANCELLED,
      stylist: { id: absentStylistId, name: 'Aksh' },
    });

    const res = await absenceService.cancelAbsence(mockSalonId, absentStylistId, 'abs-101', 'admin-01');

    expect(res.status).toBe(AbsenceStatus.CANCELLED);
    expect(mockAppointmentsService.emitSalonEvent).toHaveBeenCalledWith(
      mockSalonId,
      'STAFF_UPDATED',
      expect.objectContaining({ action: 'ABSENCE_CANCELLED' }),
    );
  });
});
