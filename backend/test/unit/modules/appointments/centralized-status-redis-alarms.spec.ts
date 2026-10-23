import { Test, TestingModule } from '@nestjs/testing';
import { AppointmentStatusService } from '../../../../src/modules/salon-admin/appointments/status/appointment-status.service';
import { RemindersService } from '../../../../src/modules/salon-admin/appointments/reminders/reminders.service';
import { PrismaService } from '../../../../src/database/prisma.service';
import { RedisService } from '../../../../src/database/redis.service';
import { AppointmentEventsService } from '../../../../src/modules/salon-admin/appointments/events/appointment-events.service';
import { WhatsAppService } from '../../../../src/modules/channels/whatsapp/whatsapp.service';
import { WhatsAppTemplateService } from '../../../../src/modules/channels/whatsapp/services/whatsapp-template.service';
import { AppointmentsService } from '../../../../src/modules/salon-admin/appointments/appointments.service';
import { AppointmentStatus, ClientEtaStatus } from '@prisma/client';
import {
  AppointmentActionType,
  APPOINTMENT_ACTION_TIMING_MINS,
  getActionLeadMs,
} from '../../../../src/common/constants/booking-policy.constants';

describe('Centralized Status & Redis Alarm Engine (Unit Tests)', () => {
  let statusService: AppointmentStatusService;
  let remindersService: RemindersService;

  const mockPrisma = {
    appointment: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
    salon: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    salonUser: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockRedis = {
    setAlarm: jest.fn().mockResolvedValue(undefined),
    clearAlarm: jest.fn().mockResolvedValue(undefined),
    popDueAlarms: jest.fn().mockResolvedValue([]),
  };

  const mockEvents = {
    emitSalonEvent: jest.fn(),
  };

  const mockWhatsApp = {
    sendMetaMessage: jest.fn().mockResolvedValue(true),
  };

  const mockAppointmentsService = {
    cancelBooking: jest.fn().mockResolvedValue({}),
    autoCompleteElapsedAppointments: jest.fn().mockResolvedValue(0),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentStatusService,
        RemindersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
        { provide: AppointmentEventsService, useValue: mockEvents },
        { provide: WhatsAppService, useValue: mockWhatsApp },
        { provide: AppointmentsService, useValue: mockAppointmentsService },
        { provide: WhatsAppTemplateService, useValue: new WhatsAppTemplateService() },
      ],
    }).compile();

    statusService = module.get<AppointmentStatusService>(AppointmentStatusService);
    remindersService = module.get<RemindersService>(RemindersService);
  });

  describe('1. calculateNextAction (State Matrix Logic with Clean Enums)', () => {
    const baseStart = new Date(Date.now() + 5 * 60 * 60 * 1000); // 5 hours in future
    const baseEnd = new Date(baseStart.getTime() + 45 * 60 * 1000);

    it('should schedule REMINDER_2H at startAt - 120m for BOOKED appointment', () => {
      const next = statusService.calculateNextAction({
        status: AppointmentStatus.BOOKED,
        startAt: baseStart,
        endAt: baseEnd,
      });

      expect(next.nextActionType).toBe(AppointmentActionType.REMINDER_2H);
      expect(next.nextActionAt?.getTime()).toBe(baseStart.getTime() - getActionLeadMs(AppointmentActionType.REMINDER_2H));
    });

    it('should schedule CUTOFF_60M at startAt - 60m once 2h reminder is sent', () => {
      const next = statusService.calculateNextAction({
        status: AppointmentStatus.BOOKED,
        startAt: baseStart,
        endAt: baseEnd,
        reminder2hSentAt: new Date(),
      });

      expect(next.nextActionType).toBe(AppointmentActionType.CUTOFF_60M);
      expect(next.nextActionAt?.getTime()).toBe(baseStart.getTime() - getActionLeadMs(AppointmentActionType.CUTOFF_60M));
    });

    it('should schedule ARRIVAL_15M at startAt - 15m for CONFIRMED appointment', () => {
      const next = statusService.calculateNextAction({
        status: AppointmentStatus.CONFIRMED,
        startAt: baseStart,
        endAt: baseEnd,
      });

      expect(next.nextActionType).toBe(AppointmentActionType.ARRIVAL_15M);
      expect(next.nextActionAt?.getTime()).toBe(baseStart.getTime() - getActionLeadMs(AppointmentActionType.ARRIVAL_15M));
    });

    it('should schedule CUTOFF_10M (10-minute response cutoff) after 15m alert if customer has not responded', () => {
      const reminderSent = new Date(Date.now() - 2 * 60 * 1000); // sent 2 mins ago
      const next = statusService.calculateNextAction({
        status: AppointmentStatus.CONFIRMED,
        startAt: baseStart,
        endAt: baseEnd,
        reminder10mSentAt: reminderSent,
        clientEtaStatus: null, // No customer response yet
      });

      expect(next.nextActionType).toBe(AppointmentActionType.CUTOFF_10M);
      expect(next.nextActionAt?.getTime()).toBe(reminderSent.getTime() + getActionLeadMs(AppointmentActionType.CUTOFF_10M));
    });

    it('should schedule AUTO_COMPLETE at endAt once customer responds with ETA (e.g. ON_THE_WAY)', () => {
      const reminderSent = new Date(Date.now() - 5 * 60 * 1000);
      const next = statusService.calculateNextAction({
        status: AppointmentStatus.CONFIRMED,
        startAt: baseStart,
        endAt: baseEnd,
        reminder10mSentAt: reminderSent,
        clientEtaStatus: ClientEtaStatus.ON_THE_WAY, // Customer responded!
      });

      expect(next.nextActionType).toBe(AppointmentActionType.AUTO_COMPLETE);
      expect(next.nextActionAt?.getTime()).toBe(baseEnd.getTime());
    });

    it('should schedule AUTO_COMPLETE at endAt for CHECKED_IN or SEATED_IN_CHAIR', () => {
      const nextCheckedIn = statusService.calculateNextAction({
        status: AppointmentStatus.CHECKED_IN,
        startAt: baseStart,
        endAt: baseEnd,
      });
      expect(nextCheckedIn.nextActionType).toBe(AppointmentActionType.AUTO_COMPLETE);
      expect(nextCheckedIn.nextActionAt?.getTime()).toBe(baseEnd.getTime());

      const nextSeated = statusService.calculateNextAction({
        status: AppointmentStatus.SEATED_IN_CHAIR,
        startAt: baseStart,
        endAt: baseEnd,
      });
      expect(nextSeated.nextActionType).toBe(AppointmentActionType.AUTO_COMPLETE);
    });

    it('should return NONE with null timestamp for terminal statuses (CANCELLED, COMPLETED, REJECTED)', () => {
      const cancelled = statusService.calculateNextAction({
        status: AppointmentStatus.CANCELLED,
        startAt: baseStart,
        endAt: baseEnd,
      });
      expect(cancelled.nextActionType).toBe(AppointmentActionType.NONE);
      expect(cancelled.nextActionAt).toBeNull();

      const completed = statusService.calculateNextAction({
        status: AppointmentStatus.COMPLETED,
        startAt: baseStart,
        endAt: baseEnd,
      });
      expect(completed.nextActionType).toBe(AppointmentActionType.NONE);
      expect(completed.nextActionAt).toBeNull();
    });
  });

  describe('2. syncAppointmentAlarm (DB & Redis Synchronization)', () => {
    it('should update PostgreSQL and arm Redis when active alarm is calculated', async () => {
      const startAt = new Date(Date.now() + 4 * 60 * 60 * 1000);
      const endAt = new Date(startAt.getTime() + 30 * 60 * 1000);

      mockPrisma.appointment.findUnique.mockResolvedValue({
        id: 'appt-123',
        status: AppointmentStatus.BOOKED,
        startAt,
        endAt,
        reminder2hSentAt: null,
        reminder10mSentAt: null,
        clientEtaStatus: null,
      });

      mockPrisma.appointment.update.mockResolvedValue({});

      const result = await statusService.syncAppointmentAlarm('appt-123');

      expect(result.nextActionType).toBe(AppointmentActionType.REMINDER_2H);
      expect(mockPrisma.appointment.update).toHaveBeenCalledWith({
        where: { id: 'appt-123' },
        data: {
          nextActionAt: expect.any(Date),
          nextActionType: AppointmentActionType.REMINDER_2H,
        },
      });
      expect(mockRedis.setAlarm).toHaveBeenCalledWith(
        'appt-123',
        AppointmentActionType.REMINDER_2H,
        expect.any(Number),
      );
    });

    it('should clear Redis alarm and nullify DB columns when appointment is cancelled', async () => {
      mockPrisma.appointment.findUnique.mockResolvedValue({
        id: 'appt-cancelled',
        status: AppointmentStatus.CANCELLED,
        startAt: new Date(),
        endAt: new Date(),
        clientEtaStatus: null,
      });

      mockPrisma.appointment.update.mockResolvedValue({});

      const result = await statusService.syncAppointmentAlarm('appt-cancelled');

      expect(result.nextActionType).toBe(AppointmentActionType.NONE);
      expect(mockPrisma.appointment.update).toHaveBeenCalledWith({
        where: { id: 'appt-cancelled' },
        data: {
          nextActionAt: null,
          nextActionType: null,
        },
      });
      expect(mockRedis.clearAlarm).toHaveBeenCalledWith('appt-cancelled');
    });
  });

  describe('3. RemindersService (Redis Alarm Worker Consumer)', () => {
    it('should do ZERO database queries when no alarms are popped from Redis', async () => {
      mockRedis.popDueAlarms.mockResolvedValue([]);

      const result = await remindersService.processReminders();

      expect(result.stage1).toBe(0);
      expect(result.stage2).toBe(0);
      expect(mockPrisma.salon.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.appointment.findMany).not.toHaveBeenCalled();
    });

    it('should execute REMINDER_2H alarm and queue CUTOFF_60M into Redis', async () => {
      mockRedis.popDueAlarms.mockResolvedValue([`appt-pop-1:${AppointmentActionType.REMINDER_2H}`]);

      let mockAppt = {
        id: 'appt-pop-1',
        status: AppointmentStatus.BOOKED,
        startAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        endAt: new Date(Date.now() + 2.5 * 60 * 60 * 1000),
        reminder2hSentAt: null as Date | null,
        reminder10mSentAt: null,
        clientEtaStatus: null,
        salon: {
          id: 'salon-1',
          name: 'Glamour Salon',
          timezone: 'Asia/Kolkata',
          whatsappAccount: { phoneNumberId: 'phone-id-1' },
        },
        salonUser: {
          user: { phone: '+919999999999', name: 'John Doe' },
        },
        stylist: { name: 'Alex' },
        service: { name: 'Haircut' },
      };

      mockPrisma.appointment.findUnique.mockImplementation(() => Promise.resolve({ ...mockAppt }));
      mockPrisma.appointment.update.mockImplementation(({ data }: any) => {
        mockAppt = { ...mockAppt, ...data };
        return Promise.resolve(mockAppt);
      });

      const result = await remindersService.processReminders();

      expect(result.stage1).toBe(1);
      expect(mockWhatsApp.sendMetaMessage).toHaveBeenCalled();
      expect(mockPrisma.appointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'appt-pop-1' },
          data: { reminder2hSentAt: expect.any(Date) },
        }),
      );
      // Automatically scheduled next alarm: CUTOFF_60M
      expect(mockRedis.setAlarm).toHaveBeenCalledWith(
        'appt-pop-1',
        AppointmentActionType.CUTOFF_60M,
        expect.any(Number),
      );
    });

    it('should execute CUTOFF_10M (10-minute cutoff) and auto-cancel unconfirmed client', async () => {
      mockRedis.popDueAlarms.mockResolvedValue([`appt-pop-2:${AppointmentActionType.CUTOFF_10M}`]);

      const mockAppt = {
        id: 'appt-pop-2',
        status: AppointmentStatus.CONFIRMED,
        startAt: new Date(),
        endAt: new Date(Date.now() + 30 * 60 * 1000),
        reminder10mSentAt: new Date(Date.now() - 11 * 60 * 1000),
        clientEtaStatus: null, // Never responded!
        salon: {
          id: 'salon-1',
          name: 'Glamour Salon',
          timezone: 'Asia/Kolkata',
          whatsappAccount: { phoneNumberId: 'phone-id-1' },
        },
        salonUser: { user: { phone: '+919999999999', name: 'Ghost Client' } },
      };

      mockPrisma.appointment.findUnique.mockResolvedValue(mockAppt);

      const result = await remindersService.processReminders();

      expect(result.stage4).toBe(1);
      expect(mockAppointmentsService.cancelBooking).toHaveBeenCalledWith(
        'salon-1',
        'appt-pop-2',
        expect.objectContaining({
          source: 'SYSTEM_AUTO_CUTOFF',
          reason: 'GHOSTED_15M_ALERT',
        }),
      );
    });
  });

  describe('4. Centralized Status Gateway (applyStatusChange & Cancellation Architecture)', () => {
    it('applyStatusChange should update DB, calculate nextAction, and clear Redis alarm on CANCELLED', async () => {
      const mockAppt = {
        id: 'appt-cancel-test',
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

      const formatted = await statusService.applyStatusChange('salon-1', 'appt-cancel-test', {
        status: AppointmentStatus.CANCELLED,
        cancellationReason: 'CLIENT_MISTAKE',
      });

      expect(formatted.status).toBe(AppointmentStatus.CANCELLED);
      expect(mockPrisma.appointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'appt-cancel-test' },
          data: expect.objectContaining({
            status: AppointmentStatus.CANCELLED,
            nextActionAt: null,
            nextActionType: null,
            cancellationReason: 'CLIENT_MISTAKE',
          }),
        }),
      );
      expect(mockRedis.clearAlarm).toHaveBeenCalledWith('appt-cancel-test');
    });

    it('applyStatusChange should update DB, calculate nextAction, and arm Redis on CONFIRMED', async () => {
      const futureStart = new Date(Date.now() + 4 * 60 * 60 * 1000);
      const futureEnd = new Date(Date.now() + 5 * 60 * 60 * 1000);
      const mockAppt = {
        id: 'appt-confirm-test',
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

      const formatted = await statusService.applyStatusChange('salon-1', 'appt-confirm-test', {
        status: AppointmentStatus.CONFIRMED,
      });

      expect(formatted.status).toBe(AppointmentStatus.CONFIRMED);
      expect(mockPrisma.appointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'appt-confirm-test' },
          data: expect.objectContaining({
            status: AppointmentStatus.CONFIRMED,
            nextActionType: AppointmentActionType.ARRIVAL_15M,
            nextActionAt: expect.any(Date),
          }),
        }),
      );
      expect(mockRedis.setAlarm).toHaveBeenCalledWith(
        'appt-confirm-test',
        AppointmentActionType.ARRIVAL_15M,
        expect.any(Number),
      );
    });
  });
});
