import { AppointmentStatus, CancelledBy } from '@prisma/client';
import { AppointmentModifierService } from '../../../../src/modules/salon-admin/appointments/modifier/appointment-modifier.service';
import { AppointmentNextActionService } from '../../../../src/modules/salon-admin/appointments/next-action/appointment-next-action.service';
import { AppointmentActionType } from '../../../../src/common/constants/booking-policy.constants';

describe('AppointmentModifierService (Sole Database Writer)', () => {
  let modifierService: AppointmentModifierService;
  let mockPrisma: any;
  let mockRedis: any;
  let mockEvents: any;
  let nextActionService: AppointmentNextActionService;

  beforeEach(() => {
    mockPrisma = {
      appointment: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    mockRedis = {
      setAlarm: jest.fn().mockResolvedValue('OK'),
      clearAlarm: jest.fn().mockResolvedValue(1),
    };
    mockEvents = {
      emitSalonEvent: jest.fn(),
    };
    nextActionService = new AppointmentNextActionService();

    modifierService = new AppointmentModifierService(
      mockPrisma,
      nextActionService,
      mockEvents,
      mockRedis,
    );
  });

  it('modifyStatus should validate transition, update DB with nextAction, arm Redis, and emit event on CONFIRMED', async () => {
    const futureStart = new Date(Date.now() + 4 * 60 * 60 * 1000);
    const futureEnd = new Date(Date.now() + 5 * 60 * 60 * 1000);
    const mockAppt = {
      id: 'appt-1',
      salonId: 'salon-1',
      status: AppointmentStatus.BOOKED,
      startAt: futureStart,
      endAt: futureEnd,
    };

    mockPrisma.appointment.findFirst.mockResolvedValue(mockAppt);
    mockPrisma.appointment.update.mockResolvedValue({
      ...mockAppt,
      status: AppointmentStatus.CONFIRMED,
    });

    const result = await modifierService.modifyStatus('salon-1', 'appt-1', {
      status: AppointmentStatus.CONFIRMED,
    });

    expect(result.status).toBe(AppointmentStatus.CONFIRMED);
    expect(mockPrisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'appt-1' },
        data: expect.objectContaining({
          status: AppointmentStatus.CONFIRMED,
          nextActionType: AppointmentActionType.ARRIVAL_15M,
          nextActionAt: expect.any(Date),
        }),
      }),
    );
    expect(mockRedis.setAlarm).toHaveBeenCalledWith(
      'appt-1',
      AppointmentActionType.ARRIVAL_15M,
      expect.any(Number),
    );
    expect(mockEvents.emitSalonEvent).toHaveBeenCalledWith(
      'salon-1',
      'STATUS_UPDATED',
      expect.anything(),
    );
  });

  it('modifyStatus should write cancellation metadata, nullify nextAction, clear Redis, and emit event on CANCELLED', async () => {
    const mockAppt = {
      id: 'appt-2',
      salonId: 'salon-1',
      status: AppointmentStatus.CONFIRMED,
      startAt: new Date(),
      endAt: new Date(),
    };

    mockPrisma.appointment.findFirst.mockResolvedValue(mockAppt);
    mockPrisma.appointment.update.mockResolvedValue({
      ...mockAppt,
      status: AppointmentStatus.CANCELLED,
    });

    const result = await modifierService.modifyStatus('salon-1', 'appt-2', {
      status: AppointmentStatus.CANCELLED,
      cancellationReason: 'CLIENT_MISTAKE',
      cancelledBy: CancelledBy.USER,
      penaltyApplied: false,
    });

    expect(result.status).toBe(AppointmentStatus.CANCELLED);
    expect(mockPrisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'appt-2' },
        data: expect.objectContaining({
          status: AppointmentStatus.CANCELLED,
          nextActionAt: null,
          nextActionType: null,
          cancellationReason: 'CLIENT_MISTAKE',
          cancelledBy: CancelledBy.USER,
          penaltyApplied: false,
        }),
      }),
    );
    expect(mockRedis.clearAlarm).toHaveBeenCalledWith('appt-2');
    expect(mockEvents.emitSalonEvent).toHaveBeenCalledWith(
      'salon-1',
      'STATUS_UPDATED',
      expect.anything(),
    );
  });

  it('modifyStatus should throw BadRequestException on invalid status jump', async () => {
    const mockAppt = {
      id: 'appt-3',
      salonId: 'salon-1',
      status: AppointmentStatus.CANCELLED, // Terminal state
      startAt: new Date(),
      endAt: new Date(),
    };

    mockPrisma.appointment.findFirst.mockResolvedValue(mockAppt);

    await expect(
      modifierService.modifyStatus('salon-1', 'appt-3', {
        status: AppointmentStatus.CONFIRMED,
      }),
    ).rejects.toThrow('Cannot transition appointment status from CANCELLED to CONFIRMED');
  });

  it('syncAlarm should recalculate nextAction and arm Redis when active', async () => {
    const futureStart = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const mockAppt = {
      id: 'appt-sync-1',
      status: AppointmentStatus.BOOKED,
      startAt: futureStart,
      endAt: new Date(futureStart.getTime() + 30 * 60 * 1000),
      reminder2hSentAt: null,
    };

    mockPrisma.appointment.findUnique.mockResolvedValue(mockAppt);
    mockPrisma.appointment.update.mockResolvedValue(mockAppt);

    const result = await modifierService.syncAlarm('appt-sync-1');

    expect(result.nextActionType).toBe(AppointmentActionType.REMINDER_2H);
    expect(mockPrisma.appointment.update).toHaveBeenCalledWith({
      where: { id: 'appt-sync-1' },
      data: {
        nextActionAt: expect.any(Date),
        nextActionType: AppointmentActionType.REMINDER_2H,
      },
    });
    expect(mockRedis.setAlarm).toHaveBeenCalledWith(
      'appt-sync-1',
      AppointmentActionType.REMINDER_2H,
      expect.any(Number),
    );
  });

  it('modifyStatus should advance nextAction to CUTOFF_60M in both DB and Redis when 2h reminder is marked sent', async () => {
    const futureStart = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const futureEnd = new Date(futureStart.getTime() + 45 * 60 * 1000);
    const mockAppt = {
      id: 'appt-2h-1',
      salonId: 'salon-1',
      status: AppointmentStatus.BOOKED,
      startAt: futureStart,
      endAt: futureEnd,
      reminder2hSentAt: null,
    };

    mockPrisma.appointment.findFirst.mockResolvedValue(mockAppt);
    mockPrisma.appointment.update.mockResolvedValue({
      ...mockAppt,
      reminder2hSentAt: new Date(),
    });

    await modifierService.modifyStatus('salon-1', 'appt-2h-1', {
      status: AppointmentStatus.BOOKED,
      reminder2hSentAt: new Date(),
      skipTransitionValidation: true,
    });

    expect(mockPrisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'appt-2h-1' },
        data: expect.objectContaining({
          status: AppointmentStatus.BOOKED,
          nextActionType: AppointmentActionType.CUTOFF_60M,
          nextActionAt: expect.any(Date),
        }),
      }),
    );
    expect(mockRedis.setAlarm).toHaveBeenCalledWith(
      'appt-2h-1',
      AppointmentActionType.CUTOFF_60M,
      expect.any(Number),
    );
  });

  it('modifyStatus should advance nextAction to CUTOFF_10M in both DB and Redis when 15m arrival alert is marked sent', async () => {
    const futureStart = new Date(Date.now() + 15 * 60 * 1000);
    const futureEnd = new Date(futureStart.getTime() + 45 * 60 * 1000);
    const mockAppt = {
      id: 'appt-15m-1',
      salonId: 'salon-1',
      status: AppointmentStatus.CONFIRMED,
      startAt: futureStart,
      endAt: futureEnd,
      reminder10mSentAt: null,
      clientEtaStatus: null,
    };

    mockPrisma.appointment.findFirst.mockResolvedValue(mockAppt);
    mockPrisma.appointment.update.mockResolvedValue({
      ...mockAppt,
      reminder10mSentAt: new Date(),
    });

    await modifierService.modifyStatus('salon-1', 'appt-15m-1', {
      status: AppointmentStatus.CONFIRMED,
      reminder10mSentAt: new Date(),
      skipTransitionValidation: true,
    });

    expect(mockPrisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'appt-15m-1' },
        data: expect.objectContaining({
          status: AppointmentStatus.CONFIRMED,
          nextActionType: AppointmentActionType.CUTOFF_10M,
          nextActionAt: expect.any(Date),
        }),
      }),
    );
    expect(mockRedis.setAlarm).toHaveBeenCalledWith(
      'appt-15m-1',
      AppointmentActionType.CUTOFF_10M,
      expect.any(Number),
    );
  });

  it('modifyStatus should disarm cutoff alarm and schedule AUTO_COMPLETE at endAt when customer responds with ETA', async () => {
    const futureStart = new Date(Date.now() + 10 * 60 * 1000);
    const futureEnd = new Date(futureStart.getTime() + 45 * 60 * 1000);
    const mockAppt = {
      id: 'appt-eta-1',
      salonId: 'salon-1',
      status: AppointmentStatus.CONFIRMED,
      startAt: futureStart,
      endAt: futureEnd,
      reminder10mSentAt: new Date(),
      clientEtaStatus: null,
    };

    mockPrisma.appointment.findFirst.mockResolvedValue(mockAppt);
    mockPrisma.appointment.update.mockResolvedValue({
      ...mockAppt,
      clientEtaStatus: 'ON_THE_WAY',
    });

    await modifierService.modifyStatus('salon-1', 'appt-eta-1', {
      status: AppointmentStatus.CONFIRMED,
      clientEtaStatus: 'ON_THE_WAY' as any,
      skipTransitionValidation: true,
    });

    expect(mockPrisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'appt-eta-1' },
        data: expect.objectContaining({
          status: AppointmentStatus.CONFIRMED,
          clientEtaStatus: 'ON_THE_WAY',
          nextActionType: AppointmentActionType.AUTO_COMPLETE,
          nextActionAt: futureEnd,
        }),
      }),
    );
    expect(mockRedis.setAlarm).toHaveBeenCalledWith(
      'appt-eta-1',
      AppointmentActionType.AUTO_COMPLETE,
      futureEnd.getTime(),
    );
  });

  it('modifyStatus should set CUTOFF_60M in both DB and Redis when reschedule proposal is made', async () => {
    const futureStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const futureEnd = new Date(futureStart.getTime() + 45 * 60 * 1000);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const mockAppt = {
      id: 'appt-reschedule-prop-1',
      salonId: 'salon-1',
      status: AppointmentStatus.CONFIRMED,
      startAt: futureStart,
      endAt: futureEnd,
    };

    mockPrisma.appointment.findFirst.mockResolvedValue(mockAppt);
    mockPrisma.appointment.update.mockResolvedValue({
      ...mockAppt,
      status: AppointmentStatus.PENDING_RESCHEDULE,
      expiresAt,
    });

    await modifierService.modifyStatus('salon-1', 'appt-reschedule-prop-1', {
      status: AppointmentStatus.PENDING_RESCHEDULE,
      proposedStartAt: futureStart,
      proposedEndAt: futureEnd,
      expiresAt,
      skipTransitionValidation: true,
    });

    expect(mockPrisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'appt-reschedule-prop-1' },
        data: expect.objectContaining({
          status: AppointmentStatus.PENDING_RESCHEDULE,
          nextActionType: AppointmentActionType.CUTOFF_60M,
          nextActionAt: expiresAt,
        }),
      }),
    );
    expect(mockRedis.setAlarm).toHaveBeenCalledWith(
      'appt-reschedule-prop-1',
      AppointmentActionType.CUTOFF_60M,
      expiresAt.getTime(),
    );
  });

  it('complete lifecycle: BOOKED(REMINDER_2H) -> reminder sent(CUTOFF_60M) -> user confirm under 60m(CONFIRMED + ARRIVAL_15M in DB & Redis)', async () => {
    const futureStart = new Date(Date.now() + 5 * 60 * 60 * 1000); // 5 hours in future
    const futureEnd = new Date(futureStart.getTime() + 45 * 60 * 1000);
    const expected2hTime = new Date(futureStart.getTime() - 120 * 60 * 1000);
    const expected60mTime = new Date(futureStart.getTime() - 60 * 60 * 1000);
    const expected15mTime = new Date(futureStart.getTime() - 15 * 60 * 1000);

    // 1. Initial State: BOOKED (>2h)
    let apptRecord: any = {
      id: 'appt-flow-1',
      salonId: 'salon-1',
      status: AppointmentStatus.BOOKED,
      startAt: futureStart,
      endAt: futureEnd,
      reminder2hSentAt: null,
      reminder10mSentAt: null,
      clientEtaStatus: null,
    };

    mockPrisma.appointment.findUnique.mockResolvedValue(apptRecord);
    mockPrisma.appointment.update.mockImplementation(async ({ data }: any) => {
      apptRecord = { ...apptRecord, ...data };
      return apptRecord;
    });

    const initialAlarm = await modifierService.syncAlarm('appt-flow-1');
    expect(initialAlarm.nextActionType).toBe(AppointmentActionType.REMINDER_2H);
    expect(initialAlarm.nextActionAt?.getTime()).toBe(expected2hTime.getTime());
    expect(mockRedis.setAlarm).toHaveBeenCalledWith(
      'appt-flow-1',
      AppointmentActionType.REMINDER_2H,
      expected2hTime.getTime(),
    );

    // 2. 2h reminder fires -> reminder2hSentAt is set -> advances to CUTOFF_60M
    mockPrisma.appointment.findFirst.mockResolvedValue(apptRecord);
    await modifierService.modifyStatus('salon-1', 'appt-flow-1', {
      status: AppointmentStatus.BOOKED,
      reminder2hSentAt: new Date(),
      skipTransitionValidation: true,
    });

    expect(mockPrisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'appt-flow-1' },
        data: expect.objectContaining({
          status: AppointmentStatus.BOOKED,
          nextActionType: AppointmentActionType.CUTOFF_60M,
          nextActionAt: expected60mTime,
        }),
      }),
    );
    expect(mockRedis.setAlarm).toHaveBeenCalledWith(
      'appt-flow-1',
      AppointmentActionType.CUTOFF_60M,
      expected60mTime.getTime(),
    );

    // 3. Customer clicks "Confirm Booking" under the 60m window -> transitions to CONFIRMED + advances to ARRIVAL_15M
    mockPrisma.appointment.findFirst.mockResolvedValue(apptRecord);
    await modifierService.modifyStatus('salon-1', 'appt-flow-1', {
      status: AppointmentStatus.CONFIRMED,
    });

    expect(mockPrisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'appt-flow-1' },
        data: expect.objectContaining({
          status: AppointmentStatus.CONFIRMED,
          nextActionType: AppointmentActionType.ARRIVAL_15M,
          nextActionAt: expected15mTime,
        }),
      }),
    );
    // Redis alarm must now be set to ARRIVAL_15M (overriding CUTOFF_60M)
    expect(mockRedis.setAlarm).toHaveBeenCalledWith(
      'appt-flow-1',
      AppointmentActionType.ARRIVAL_15M,
      expected15mTime.getTime(),
    );
  });
});

