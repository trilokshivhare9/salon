import { AppointmentStatus, ClientEtaStatus } from '@prisma/client';
import { AppointmentNextActionService } from '../../../../src/modules/salon-admin/appointments/next-action/appointment-next-action.service';
import { AppointmentActionType } from '../../../../src/common/constants/booking-policy.constants';

describe('AppointmentNextActionService (Pure Calculation Engine)', () => {
  let service: AppointmentNextActionService;

  beforeEach(() => {
    service = new AppointmentNextActionService();
  });

  it('should calculate REMINDER_2H at startAt - 120m for BOOKED status', () => {
    const futureStart = new Date(Date.now() + 3 * 60 * 60 * 1000); // 3 hours from now
    const futureEnd = new Date(futureStart.getTime() + 30 * 60 * 1000);

    const result = service.calculateNextAction({
      status: AppointmentStatus.BOOKED,
      startAt: futureStart,
      endAt: futureEnd,
      reminder2hSentAt: null,
    });

    expect(result.nextActionType).toBe(AppointmentActionType.REMINDER_2H);
    expect(result.nextActionAt).toEqual(new Date(futureStart.getTime() - 2 * 60 * 60 * 1000));
  });

  it('should calculate CUTOFF_60M at startAt - 60m once 2h reminder is sent', () => {
    const futureStart = new Date(Date.now() + 90 * 60 * 1000); // 90 min from now
    const futureEnd = new Date(futureStart.getTime() + 30 * 60 * 1000);

    const result = service.calculateNextAction({
      status: AppointmentStatus.BOOKED,
      startAt: futureStart,
      endAt: futureEnd,
      reminder2hSentAt: new Date(Date.now() - 30 * 60 * 1000),
    });

    expect(result.nextActionType).toBe(AppointmentActionType.CUTOFF_60M);
    expect(result.nextActionAt).toEqual(new Date(futureStart.getTime() - 60 * 60 * 1000));
  });

  it('should calculate ARRIVAL_15M at startAt - 15m for CONFIRMED status', () => {
    const futureStart = new Date(Date.now() + 45 * 60 * 1000);
    const futureEnd = new Date(futureStart.getTime() + 30 * 60 * 1000);

    const result = service.calculateNextAction({
      status: AppointmentStatus.CONFIRMED,
      startAt: futureStart,
      endAt: futureEnd,
      reminder10mSentAt: null,
    });

    expect(result.nextActionType).toBe(AppointmentActionType.ARRIVAL_15M);
    expect(result.nextActionAt).toEqual(new Date(futureStart.getTime() - 15 * 60 * 1000));
  });

  it('should calculate CUTOFF_10M (10m after 15m alert) if client has not responded', () => {
    const futureStart = new Date(Date.now() + 10 * 60 * 1000);
    const futureEnd = new Date(futureStart.getTime() + 30 * 60 * 1000);
    const alertSentTime = new Date(Date.now() - 5 * 60 * 1000);

    const result = service.calculateNextAction({
      status: AppointmentStatus.CONFIRMED,
      startAt: futureStart,
      endAt: futureEnd,
      reminder10mSentAt: alertSentTime,
      clientEtaStatus: null, // No response
    });

    expect(result.nextActionType).toBe(AppointmentActionType.CUTOFF_10M);
    expect(result.nextActionAt).toEqual(new Date(alertSentTime.getTime() + 10 * 60 * 1000));
  });

  it('should calculate AUTO_COMPLETE at endAt once customer responds with ETA', () => {
    const futureStart = new Date(Date.now() + 10 * 60 * 1000);
    const futureEnd = new Date(futureStart.getTime() + 30 * 60 * 1000);

    const result = service.calculateNextAction({
      status: AppointmentStatus.CONFIRMED,
      startAt: futureStart,
      endAt: futureEnd,
      reminder10mSentAt: new Date(Date.now() - 5 * 60 * 1000),
      clientEtaStatus: ClientEtaStatus.ON_THE_WAY,
    });

    expect(result.nextActionType).toBe(AppointmentActionType.AUTO_COMPLETE);
    expect(result.nextActionAt).toEqual(futureEnd);
  });

  it('should calculate AUTO_COMPLETE at endAt for CHECKED_IN or SEATED_IN_CHAIR', () => {
    const futureEnd = new Date(Date.now() + 45 * 60 * 1000);

    const result = service.calculateNextAction({
      status: AppointmentStatus.SEATED_IN_CHAIR,
      startAt: new Date(),
      endAt: futureEnd,
    });

    expect(result.nextActionType).toBe(AppointmentActionType.AUTO_COMPLETE);
    expect(result.nextActionAt).toEqual(futureEnd);
  });

  it('should return NONE with null timestamp for terminal statuses', () => {
    const resultCancelled = service.calculateNextAction({
      status: AppointmentStatus.CANCELLED,
      startAt: new Date(),
      endAt: new Date(),
    });
    expect(resultCancelled.nextActionType).toBe(AppointmentActionType.NONE);
    expect(resultCancelled.nextActionAt).toBeNull();

    const resultCompleted = service.calculateNextAction({
      status: AppointmentStatus.COMPLETED,
      startAt: new Date(),
      endAt: new Date(),
    });
    expect(resultCompleted.nextActionType).toBe(AppointmentActionType.NONE);
    expect(resultCompleted.nextActionAt).toBeNull();
  });

  it('should calculate CUTOFF_60M for PENDING_RESCHEDULE within 60-minute proposal response window', () => {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const result = service.calculateNextAction({
      status: AppointmentStatus.PENDING_RESCHEDULE,
      startAt: new Date(),
      endAt: new Date(),
      expiresAt,
    });
    expect(result.nextActionType).toBe(AppointmentActionType.CUTOFF_60M);
    expect(result.nextActionAt).toEqual(expiresAt);
  });

  it('should calculate AUTO_COMPLETE at endAt for quick booking confirmed by salon when remaining time is < 15 min', () => {
    // Booking starts in 10 minutes (less than 15 minutes away!)
    const nearStart = new Date(Date.now() + 10 * 60 * 1000);
    const nearEnd = new Date(nearStart.getTime() + 30 * 60 * 1000);

    const result = service.calculateNextAction({
      status: AppointmentStatus.CONFIRMED,
      startAt: nearStart,
      endAt: nearEnd,
      reminder10mSentAt: null,
      clientEtaStatus: null,
    });

    // Must skip 15m reminder and advance straight to AUTO_COMPLETE at endAt
    expect(result.nextActionType).toBe(AppointmentActionType.AUTO_COMPLETE);
    expect(result.nextActionAt).toEqual(nearEnd);
  });

  it('should calculate AUTO_COMPLETE at endAt for early CHECKED_IN even if booked hours in advance', () => {
    // Booking starts in 3 hours, but customer arrived early and salon checked them in
    const futureStart = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const futureEnd = new Date(futureStart.getTime() + 45 * 60 * 1000);

    const result = service.calculateNextAction({
      status: AppointmentStatus.CHECKED_IN,
      startAt: futureStart,
      endAt: futureEnd,
    });

    expect(result.nextActionType).toBe(AppointmentActionType.AUTO_COMPLETE);
    expect(result.nextActionAt).toEqual(futureEnd);
  });

  it('should calculate 5-minute auto-decline cutoff for PENDING_ACCEPTANCE quick booking', () => {
    const nearStart = new Date(Date.now() + 10 * 60 * 1000);
    const nearEnd = new Date(nearStart.getTime() + 30 * 60 * 1000);

    const result = service.calculateNextAction({
      status: AppointmentStatus.PENDING_ACCEPTANCE,
      startAt: nearStart,
      endAt: nearEnd,
    });

    expect(result.nextActionType).toBe(AppointmentActionType.CUTOFF_60M);
    expect(result.nextActionAt).toBeDefined();
    // Due within ~5 minutes
    const diffMs = result.nextActionAt!.getTime() - Date.now();
    expect(diffMs).toBeLessThanOrEqual(5 * 60 * 1000 + 50);
  });
});

