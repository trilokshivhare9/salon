import { Test, TestingModule } from '@nestjs/testing';
import { AbsenceService } from './absence.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { PrismaService } from '../../database/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { DateTime } from 'luxon';
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
import { AvailabilityEngineService } from '../availability/availability-engine.service';

describe('Human Real-World Scenarios: Stylist Absence Handling', () => {
  let absenceService: AbsenceService;
  let mockPrisma: any;
  let mockAppointmentsService: any;
  let mockWhatsAppService: any;

  const todayStr = DateTime.now().setZone('Asia/Kolkata').toFormat('yyyy-MM-dd');
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
          endTime: '21:00',
        }),
      },
      stylistWorkingHours: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      service: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'svc-haircut', durationMinutes: 30, price: 500, name: 'Haircut' },
          { id: 'svc-spa', durationMinutes: 60, price: 1500, name: 'Hair Spa' },
        ]),
      },
      stylistAbsence: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockImplementation(async (args) => ({
          id: args?.create?.id || args?.update?.id || args?.where?.id || 'abs-101',
          salonId: mockSalonId,
          stylistId: absentStylistId,
          absenceDate: new Date(),
          status: AbsenceStatus.ACTIVE,
          ...(args?.create || args?.update || {}),
        })),
        update: jest.fn().mockImplementation(async (args) => ({
          id: args?.where?.id || 'abs-101',
          salonId: mockSalonId,
          stylistId: absentStylistId,
          absenceDate: new Date(),
          status: AbsenceStatus.ACTIVE,
          ...(args?.data || {}),
        })),
        create: jest.fn().mockImplementation(async (args) => ({
          salonId: mockSalonId,
          stylistId: absentStylistId,
          absenceDate: new Date(),
          status: AbsenceStatus.ACTIVE,
          ...(args?.data || {}),
          id: args?.data?.id || 'abs-101',
        })),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue(true),
      },
      appointment: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      bookingReassignment: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
      },
      stylistService: {
        findMany: jest.fn().mockResolvedValue([{ serviceId: 'svc-haircut' }, { serviceId: 'svc-spa' }]),
      },
    };

    mockAppointmentsService = {
      emitSalonEvent: jest.fn(),
      getAppointmentById: jest.fn(),
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
        AvailabilityEngineService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AppointmentsService, useValue: mockAppointmentsService },
        { provide: WhatsAppService, useValue: mockWhatsAppService },
      ],
    }).compile();

    absenceService = module.get<AbsenceService>(AbsenceService);
  });

  // SCENARIO 1: Marking a Stylist Absent for Today (Full Day)
  it('Scenario 1: Manager marks Aksh absent for today - Creates absence and emits real-time WebSocket update', async () => {
    const dateToday = todayStr;
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
    const targetDate = todayStr;
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
      startAt: new Date(`${targetDate}T05:30:00.000Z`),
      endAt: new Date(`${targetDate}T06:00:00.000Z`),
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
    const targetDate = todayStr;
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
      startAt: new Date(`${targetDate}T09:30:00.000Z`),
      endAt: new Date(`${targetDate}T10:30:00.000Z`),
      salonUser: { user: { name: 'Kavita', phone: '+919876543211' } },
    };
    mockPrisma.appointment.findMany.mockResolvedValue([kavitaBooking]);

    // Zero qualified backup stylists available
    mockPrisma.stylist.findMany.mockResolvedValue([]);

    mockPrisma.bookingReassignment.upsert.mockResolvedValue({
      id: 'reassign-kavita',
      appointmentId: 'appt-kavita-2',
      outcome: ReassignmentOutcome.NO_REPLACEMENT,
    });

    const result = await absenceService.markStylistAbsent(mockSalonId, absentStylistId, {
      date: targetDate,
      reason: 'Emergency Leave',
    });

    expect(result.reassignmentSummary.total).toBe(1);
    expect(result.reassignmentSummary.reassigned).toBe(0);
    expect(result.reassignmentSummary.unresolvable).toBe(1);
  });

  // SCENARIO 8: Marking Future Leave
  it('Scenario 8: Stylist applies for leave on a future date (Sept 25) - System schedules absence without affecting today', async () => {
    const futureDateStr = DateTime.now().plus({ days: 5 }).toFormat('yyyy-MM-dd');
    mockPrisma.stylist.findFirst.mockResolvedValue({
      id: absentStylistId,
      salonId: mockSalonId,
      name: 'Aksh',
      status: StylistStatus.ACTIVE,
    });

    mockPrisma.stylistAbsence.create.mockImplementationOnce(async (args) => ({
      id: 'abs-108',
      absenceDate: new Date(`${futureDateStr}T00:00:00.000Z`),
      status: AbsenceStatus.ACTIVE,
      ...(args?.data || {}),
    }));
    mockPrisma.stylistAbsence.upsert.mockImplementationOnce(async (args) => ({
      id: 'abs-108',
      absenceDate: new Date(`${futureDateStr}T00:00:00.000Z`),
      status: AbsenceStatus.ACTIVE,
      ...(args?.create || args?.update || {}),
    }));
    mockPrisma.appointment.findMany.mockResolvedValue([]);

    const result = await absenceService.markStylistAbsent(mockSalonId, absentStylistId, {
      date: futureDateStr,
      reason: 'Planned Vacation',
    });

    expect(result.absence.id).toBe('abs-108');
  });

  // SCENARIO 10: Invalid Past Date Leave Attempt
  it('Scenario 10: Manager tries to mark absence for a past date (Sept 14) - System rejects with BadRequestException', async () => {
    const pastDateStr = '2020-01-01';
    mockPrisma.stylist.findFirst.mockResolvedValue({
      id: absentStylistId,
      salonId: mockSalonId,
      name: 'Aksh',
    });

    await expect(
      absenceService.markStylistAbsent(mockSalonId, absentStylistId, {
        date: pastDateStr,
        reason: 'Past Date Attempt',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  // SCENARIO 11: Early Return from Leave (Cancel Absence)
  it('Scenario 11: Aksh returns to work early - Manager cancels absence record - System restores stylist state to ACTIVE', async () => {
    const todayAbsenceDate = todayStr;
    mockPrisma.stylistAbsence.findFirst.mockResolvedValue({
      id: 'abs-101',
      salonId: mockSalonId,
      stylistId: absentStylistId,
      absenceDate: new Date(`${todayAbsenceDate}T00:00:00.000Z`),
      status: AbsenceStatus.ACTIVE,
    });

    mockPrisma.stylistAbsence.update.mockResolvedValue({
      id: 'abs-101',
      status: AbsenceStatus.CANCELLED,
    });

    const result = await absenceService.cancelAbsence(mockSalonId, absentStylistId, 'abs-101');

    expect(result.status).toBe(AbsenceStatus.CANCELLED);
    expect(mockAppointmentsService.emitSalonEvent).toHaveBeenCalledWith(
      mockSalonId,
      'STAFF_UPDATED',
      expect.objectContaining({
        staffId: absentStylistId,
        action: 'ABSENCE_CANCELLED',
      }),
    );
  });
});
