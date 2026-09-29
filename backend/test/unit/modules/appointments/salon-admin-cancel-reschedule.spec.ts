import { Test, TestingModule } from '@nestjs/testing';
import { CancellationService } from '../../../../src/modules/salon-admin/appointments/cancellation/cancellation.service';
import { RescheduleService } from '../../../../src/modules/salon-admin/appointments/reschedule/reschedule.service';
import { WhatsAppActionHandlerService } from '../../../../src/modules/channels/whatsapp/services/whatsapp-action-handler.service';
import { PrismaService } from '../../../../src/database/prisma.service';
import { AvailabilityService } from '../../../../src/modules/salon-admin/availability/availability.service';
import { AvailabilityEngineService } from '../../../../src/modules/salon-admin/availability/availability-engine.service';
import { AppointmentEventsService } from '../../../../src/modules/salon-admin/appointments/events/appointment-events.service';
import { WhatsAppSenderService } from '../../../../src/modules/channels/whatsapp/services/whatsapp-sender.service';
import { WhatsAppService } from '../../../../src/modules/channels/whatsapp/whatsapp.service';
import { WhatsAppTemplateService } from '../../../../src/modules/channels/whatsapp/services/whatsapp-template.service';
import { AppointmentStatus, CancelledBy } from '@prisma/client';
import { DateTime } from 'luxon';

describe('Salon Admin - Cancellation & Reschedule Workflows', () => {
  let cancellationService: CancellationService;
  let rescheduleService: RescheduleService;
  let whatsappActionHandler: WhatsAppActionHandlerService;
  let prisma: PrismaService;
  let eventsService: AppointmentEventsService;
  let whatsappSender: WhatsAppSenderService;
  let templateService: WhatsAppTemplateService;

  const mockSalonId = 'salon-test-123';
  const mockApptId = 'appt-test-456';
  const mockAdminId = 'admin-user-789';
  const mockCustomerPhone = '919876543210';
  const mockSalonUserId = 'su-test-111';

  beforeEach(async () => {
    const mockPrisma: any = {
      appointment: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      salon: {
        findUnique: jest.fn().mockResolvedValue({
          id: mockSalonId,
          name: 'Crown Salon',
          status: 'ACTIVE',
          timezone: 'Asia/Kolkata',
          whatsappAccount: { phoneNumberId: 'pn-123' },
          services: [],
          serviceCategories: [],
          stylists: [],
        }),
      },
      salonUser: {
        findUnique: jest.fn().mockResolvedValue({
          id: mockSalonUserId,
          yearlyNoShowCount: 0,
          isBookingBlocked: false,
          user: { phone: mockCustomerPhone, name: 'John Doe' },
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      service: {
        findFirst: jest.fn().mockResolvedValue({ id: 'srv-1', status: 'ACTIVE' }),
      },
      stylist: {
        findUnique: jest.fn().mockResolvedValue({ id: 'sty-1', status: 'ACTIVE', followsSalonSchedule: true }),
      },
      stylistService: {
        findFirst: jest.fn().mockResolvedValue({ id: 'ss-1' }),
      },
      stylistAbsence: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      salonWorkingHours: {
        findUnique: jest.fn().mockResolvedValue({ startTime: '09:00', endTime: '21:00', isClosed: false }),
      },
      stylistWorkingHours: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(async (cb) => {
        if (typeof cb === 'function') {
          return cb(mockPrisma);
        }
        return mockPrisma;
      }),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    };

    const mockEventsService: any = {
      emitSalonEvent: jest.fn(),
    };

    const mockSender: any = {
      sendMessage: jest.fn().mockResolvedValue({ success: true }),
      sendMetaMessage: jest.fn().mockResolvedValue({ success: true }),
      cleanPhone: jest.fn().mockImplementation((p: string) => p.replace(/\D/g, '')),
    };

    const mockAvailability: any = {
      getAvailableSlots: jest.fn().mockResolvedValue({
        date: '2026-09-30',
        salonTimezone: 'Asia/Kolkata',
        availableSlots: [
          { startTime: '15:00', endTime: '15:30' },
        ],
      }),
    };

    templateService = new WhatsAppTemplateService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CancellationService,
        RescheduleService,
        AvailabilityEngineService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AppointmentEventsService, useValue: mockEventsService },
        { provide: WhatsAppSenderService, useValue: mockSender },
        { provide: AvailabilityService, useValue: mockAvailability },
        { provide: WhatsAppService, useValue: mockSender },
        { provide: WhatsAppTemplateService, useValue: templateService },
      ],
    }).compile();

    cancellationService = module.get<CancellationService>(CancellationService);
    rescheduleService = module.get<RescheduleService>(RescheduleService);
    prisma = module.get<PrismaService>(PrismaService);
    eventsService = module.get<AppointmentEventsService>(AppointmentEventsService);
    whatsappSender = module.get<WhatsAppSenderService>(WhatsAppSenderService);

    // Instantiate WhatsAppActionHandlerService with mocks
    whatsappActionHandler = new WhatsAppActionHandlerService(
      prisma,
      whatsappSender,
      templateService,
      {
        getSession: jest.fn().mockResolvedValue(null),
        getOrCreateSession: jest.fn().mockResolvedValue({
          user: { id: 'u-1', phone: mockCustomerPhone, name: 'John Doe' },
          salonUser: { id: mockSalonUserId, isBookingBlocked: false, yearlyNoShowCount: 0 },
          conversation: { state: 'START', metadata: {} },
        }),
        determineLifecycleStage: jest.fn().mockReturnValue('ACTIVE_BOOKING'),
        isActionValidForLifecycle: jest.fn().mockReturnValue(true),
        getHistory: jest.fn().mockResolvedValue([]),
        saveHistory: jest.fn(),
        saveSession: jest.fn(),
        updateConversationState: jest.fn().mockResolvedValue({}),
      } as any, // session
      mockAvailability,
      {} as any, // quickCodeService
      { emitSalonEvent: jest.fn() } as any, // appointmentsService
      cancellationService,
      rescheduleService,
      whatsappSender as any,
    );
  });

  describe('1. Salon Admin Cancellation Scenarios & Actor Tracking', () => {
    it('Scenario 1A: Salon admin cancels WITHOUT penalty (applyPenalty: false) -> skips remaining time check, records NO strike, sets cancelledBy: SALON', async () => {
      // Slot is only 15 minutes away (< 90 minutes remaining)
      const soon = new Date(Date.now() + 15 * 60 * 1000);
      const mockAppt = {
        id: mockApptId,
        salonId: mockSalonId,
        status: AppointmentStatus.CONFIRMED,
        startAt: soon,
        endAt: new Date(soon.getTime() + 30 * 60 * 1000),
        salonUserId: mockCustomerPhone,
        salonUser: { id: mockSalonUserId, user: { phone: mockCustomerPhone, name: 'John Doe' } },
        service: { name: 'Haircut' },
        stylist: { name: 'Alice' },
      };

      jest.spyOn(prisma.appointment, 'findFirst').mockResolvedValue(mockAppt as any);
      jest.spyOn(prisma.appointment, 'findUnique').mockResolvedValue(mockAppt as any);

      (prisma.appointment.update as any) = jest.fn().mockImplementation(async ({ data }: any) => ({
        ...mockAppt,
        status: data.status,
        cancelledBy: data.cancelledBy,
        penaltyApplied: data.penaltyApplied,
        notes: data.notes,
      }));

      const result = await cancellationService.cancelBooking(mockSalonId, mockApptId, {
        source: 'ADMIN_DASHBOARD',
        fault: 'SALON',
        applyPenalty: false,
        reason: 'Client requested reschedule by phone without penalty',
        adminId: mockAdminId,
      });

      // Assertions
      expect(result.penaltyApplied).toBe(false);
      expect(result.status).toBe(AppointmentStatus.CANCELLED);
      // Ensure cancelledBy is marked SALON
      expect(prisma.appointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cancelledBy: CancelledBy.SALON,
            penaltyApplied: false,
          }),
        }),
      );
      // Ensure salonUser penalty strikes was NEVER touched
      expect(prisma.salonUser.update).not.toHaveBeenCalled();
      // Ensure events emitted
      expect(eventsService.emitSalonEvent).toHaveBeenCalledWith(
        mockSalonId,
        'BOOKING_CANCELLED',
        expect.anything(),
      );
    });

    it('Scenario 1B: Salon admin cancels WITH penalty (applyPenalty: true) -> skips remaining time check, records penalty strike, sets cancelledBy: SALON', async () => {
      // Slot is far in the future (> 90 mins)
      const future = new Date(Date.now() + 5 * 3600 * 1000);
      const mockAppt = {
        id: mockApptId,
        salonId: mockSalonId,
        status: AppointmentStatus.CONFIRMED,
        startAt: future,
        endAt: new Date(future.getTime() + 30 * 60 * 1000),
        salonUserId: mockCustomerPhone,
        salonUser: { id: mockSalonUserId, user: { phone: mockCustomerPhone, name: 'John Doe' } },
        service: { name: 'Haircut' },
        stylist: { name: 'Alice' },
      };

      jest.spyOn(prisma.appointment, 'findFirst').mockResolvedValue(mockAppt as any);
      jest.spyOn(prisma.appointment, 'findUnique').mockResolvedValue(mockAppt as any);

      (prisma.appointment.update as any) = jest.fn().mockImplementation(async ({ data }: any) => ({
        ...mockAppt,
        status: data.status,
        cancelledBy: data.cancelledBy,
        penaltyApplied: data.penaltyApplied,
        notes: data.notes,
      }));

      const result = await cancellationService.cancelBooking(mockSalonId, mockApptId, {
        source: 'ADMIN_DASHBOARD',
        fault: 'CLIENT',
        applyPenalty: true,
        reason: 'Customer repeatedly called to cancel at last moment',
        adminId: mockAdminId,
      });

      // Assertions
      expect(result.penaltyApplied).toBe(true);
      expect(result.penaltyCount).toBe(1);
      // Ensure cancelledBy is marked SALON
      expect(prisma.appointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cancelledBy: CancelledBy.SALON,
            penaltyApplied: true,
          }),
        }),
      );
      // Ensure strike was recorded on salonUser
      expect(prisma.salonUser.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ yearlyNoShowCount: 1 }),
        }),
      );
    });

    it('Scenario 1C: System cancels appointment automatically -> sets cancelledBy: SYSTEM', async () => {
      const soon = new Date(Date.now() + 50 * 60 * 1000);
      const mockAppt = {
        id: mockApptId,
        salonId: mockSalonId,
        status: AppointmentStatus.BOOKED,
        startAt: soon,
        endAt: new Date(soon.getTime() + 30 * 60 * 1000),
        salonUserId: mockCustomerPhone,
        salonUser: { id: mockSalonUserId, user: { phone: mockCustomerPhone, name: 'John Doe' } },
        service: { name: 'Haircut' },
        stylist: { name: 'Alice' },
      };

      jest.spyOn(prisma.appointment, 'findFirst').mockResolvedValue(mockAppt as any);
      jest.spyOn(prisma.appointment, 'findUnique').mockResolvedValue(mockAppt as any);

      (prisma.appointment.update as any) = jest.fn().mockImplementation(async ({ data }: any) => ({
        ...mockAppt,
        status: data.status,
        cancelledBy: data.cancelledBy,
        penaltyApplied: data.penaltyApplied,
      }));

      const result = await cancellationService.cancelBooking(mockSalonId, mockApptId, {
        source: 'SYSTEM_AUTO_CUTOFF',
        fault: 'CLIENT',
        reason: 'Unconfirmed 1 hour cutoff reached',
      });

      expect(result.status).toBe(AppointmentStatus.CANCELLED);
      expect(prisma.appointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cancelledBy: CancelledBy.SYSTEM,
          }),
        }),
      );
    });

    it('Scenario 1D: Client cancels with < 90m remaining but explicit noPenalty: true -> skips penalty and records NO strike', async () => {
      const soon = new Date(Date.now() + 25 * 60 * 1000); // 25 mins away (< 90m)
      const mockAppt = {
        id: mockApptId,
        salonId: mockSalonId,
        status: AppointmentStatus.CONFIRMED,
        startAt: soon,
        endAt: new Date(soon.getTime() + 30 * 60 * 1000),
        salonUserId: mockCustomerPhone,
        salonUser: { id: mockSalonUserId, user: { phone: mockCustomerPhone, name: 'John Doe' } },
        service: { name: 'Haircut' },
        stylist: { name: 'Alice' },
      };

      jest.spyOn(prisma.appointment, 'findFirst').mockResolvedValue(mockAppt as any);
      jest.spyOn(prisma.appointment, 'findUnique').mockResolvedValue(mockAppt as any);

      (prisma.appointment.update as any) = jest.fn().mockImplementation(async ({ data }: any) => ({
        ...mockAppt,
        status: data.status,
        penaltyApplied: data.penaltyApplied,
        notes: data.notes,
      }));

      const result = await cancellationService.cancelBooking(mockSalonId, mockApptId, {
        source: 'CUSTOMER_WHATSAPP',
        fault: 'CLIENT',
        noPenalty: true, // Explicit flag: bypass penalty!
        reason: 'Client requested cancellation with support approval',
      });

      expect(result.penaltyApplied).toBe(false);
      expect(prisma.salonUser.update).not.toHaveBeenCalled();
    });

    it('Scenario 1E: Client cancels with < 90m remaining without noPenalty flag -> penalty strike IS recorded', async () => {
      const soon = new Date(Date.now() + 45 * 60 * 1000); // 45 mins away (< 90m)
      const mockAppt = {
        id: mockApptId,
        salonId: mockSalonId,
        status: AppointmentStatus.CONFIRMED,
        startAt: soon,
        endAt: new Date(soon.getTime() + 30 * 60 * 1000),
        salonUserId: mockCustomerPhone,
        salonUser: { id: mockSalonUserId, user: { phone: mockCustomerPhone, name: 'John Doe' } },
        service: { name: 'Haircut' },
        stylist: { name: 'Alice' },
      };

      jest.spyOn(prisma.appointment, 'findFirst').mockResolvedValue(mockAppt as any);
      jest.spyOn(prisma.appointment, 'findUnique').mockResolvedValue(mockAppt as any);

      (prisma.appointment.update as any) = jest.fn().mockImplementation(async ({ data }: any) => ({
        ...mockAppt,
        status: data.status,
        penaltyApplied: data.penaltyApplied,
        notes: data.notes,
      }));

      const result = await cancellationService.cancelBooking(mockSalonId, mockApptId, {
        source: 'CUSTOMER_WHATSAPP',
        fault: 'CLIENT',
        reason: 'Customer cancelled late without noPenalty override',
      });

      expect(result.penaltyApplied).toBe(true);
      expect(result.penaltyCount).toBe(1);
      expect(prisma.salonUser.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ yearlyNoShowCount: 1 }),
        }),
      );
    });

    it('Scenario 1F: Idempotency fallback when appointment is already CANCELLED -> returns existing appointment without re-penalizing', async () => {
      const mockAppt = {
        id: mockApptId,
        salonId: mockSalonId,
        status: AppointmentStatus.CANCELLED,
        penaltyApplied: false,
        startAt: new Date(),
        salonUserId: mockCustomerPhone,
        salonUser: { id: mockSalonUserId, user: { phone: mockCustomerPhone, name: 'John Doe' } },
        service: { name: 'Haircut' },
        stylist: { name: 'Alice' },
      };

      jest.spyOn(prisma.appointment, 'findFirst').mockResolvedValue(mockAppt as any);
      jest.spyOn(prisma.appointment, 'findUnique').mockResolvedValue(mockAppt as any);

      const result = await cancellationService.cancelBooking(mockSalonId, mockApptId, {
        source: 'ADMIN_DASHBOARD',
        fault: 'SALON',
        reason: 'Redundant cancellation call',
      });

      expect(result.status).toBe(AppointmentStatus.CANCELLED);
      expect(result.penaltyApplied).toBe(false);
      // DB update must NOT be called again
      expect(prisma.appointment.update).not.toHaveBeenCalled();
    });

    it('Scenario 1G: State transition fallback when appointment is COMPLETED -> throws BadRequestException', async () => {
      const mockAppt = {
        id: mockApptId,
        salonId: mockSalonId,
        status: AppointmentStatus.COMPLETED,
        startAt: new Date(),
        salonUserId: mockCustomerPhone,
        salonUser: { id: mockSalonUserId, user: { phone: mockCustomerPhone, name: 'John Doe' } },
      };

      jest.spyOn(prisma.appointment, 'findFirst').mockResolvedValue(mockAppt as any);
      jest.spyOn(prisma.appointment, 'findUnique').mockResolvedValue(mockAppt as any);

      await expect(
        cancellationService.cancelBooking(mockSalonId, mockApptId, {
          source: 'ADMIN_DASHBOARD',
          fault: 'CLIENT',
          reason: 'Attempting to cancel completed visit',
        }),
      ).rejects.toThrow();
    });
  });

  describe('2. Salon Admin Reschedule Workflow', () => {
    it('Scenario 2A: Salon admin reschedules -> sets status PENDING_RESCHEDULE and notifies customer via WhatsApp with centralized template', async () => {
      const originalStart = new Date('2026-09-30T10:00:00.000Z');
      const mockAppt = {
        id: mockApptId,
        salonId: mockSalonId,
        status: AppointmentStatus.CONFIRMED,
        startAt: originalStart,
        endAt: new Date('2026-09-30T10:30:00.000Z'),
        appointmentDate: new Date('2026-09-30'),
        durationMinutes: 30,
        serviceId: 'srv-1',
        stylistId: 'sty-1',
        salonUserId: mockSalonUserId,
        salonUser: { id: mockSalonUserId, user: { phone: mockCustomerPhone, name: 'John Doe' } },
        stylist: { name: 'Alice' },
      };

      // findFirst returns mockAppt only when looking up appt by id, and null for overlap queries
      (prisma.appointment.findFirst as any) = jest.fn().mockImplementation(async ({ where }: any) => {
        if (where?.id === mockApptId) return mockAppt as any;
        return null;
      });
      jest.spyOn(prisma.appointment, 'findUnique').mockResolvedValue(mockAppt as any);

      (prisma.appointment.update as any) = jest.fn().mockImplementation(async ({ data }: any) => ({
        ...mockAppt,
        status: data.status,
        proposedStartAt: data.proposedStartAt,
        proposedEndAt: data.proposedEndAt,
        proposedByAdminId: data.proposedByAdminId,
      }));

      (rescheduleService as any).whatsappService = whatsappSender;

      const result = await rescheduleService.rescheduleAppointment(
        mockSalonId,
        mockApptId,
        {
          newDate: '2026-09-30',
          newStartTime: '15:00',
        },
        mockAdminId,
      );

      // Verify status is PENDING_RESCHEDULE (not CONFIRMED yet)
      expect(result.status).toBe(AppointmentStatus.PENDING_RESCHEDULE);
      expect(result.proposedStartAt).toBeDefined();

      // Verify WhatsApp proposal was sent to customer with interactive buttons generated by template
      expect(whatsappSender.sendMetaMessage).toHaveBeenCalledWith(
        mockCustomerPhone,
        expect.objectContaining({
          interactiveType: 'button',
          buttons: expect.arrayContaining([
            expect.objectContaining({ id: `propose_accept_${mockApptId}` }),
            expect.objectContaining({ id: `propose_decline_${mockApptId}` }),
          ]),
        }),
        'pn-123',
        mockSalonId,
      );
    });

    it('Scenario 2B: Customer ACCEPTS proposed reschedule -> status becomes CONFIRMED on new slot', async () => {
      const proposedStart = new Date('2026-09-30T15:00:00.000Z');
      const proposedEnd = new Date('2026-09-30T15:30:00.000Z');

      const mockAppt = {
        id: mockApptId,
        salonId: mockSalonId,
        status: AppointmentStatus.PENDING_RESCHEDULE,
        startAt: new Date('2026-09-30T10:00:00.000Z'),
        endAt: new Date('2026-09-30T10:30:00.000Z'),
        proposedStartAt: proposedStart,
        proposedEndAt: proposedEnd,
        proposedByAdminId: mockAdminId,
        stylist: { name: 'Alice' },
      };

      jest.spyOn(prisma.appointment, 'findUnique').mockResolvedValue(mockAppt as any);
      (prisma.appointment.findFirst as any) = jest.fn().mockImplementation(async ({ where }: any) => {
        if (where?.id === mockApptId) return mockAppt as any;
        return null;
      });

      (prisma.appointment.update as any) = jest.fn().mockResolvedValue({
        ...mockAppt,
        status: AppointmentStatus.CONFIRMED,
        startAt: proposedStart,
        endAt: proposedEnd,
      });

      const reply = await whatsappActionHandler.handleIncomingAction(
        mockSalonId,
        mockCustomerPhone,
        '',
        `propose_accept_${mockApptId}`,
        'pn-123',
      );

      expect(reply).toBeDefined();
      expect(reply.replyMessage).toContain('RESCHEDULE CONFIRMED');
      expect(prisma.appointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockApptId },
          data: expect.objectContaining({
            status: AppointmentStatus.CONFIRMED,
            startAt: proposedStart,
            endAt: proposedEnd,
            proposedStartAt: null,
            proposedEndAt: null,
          }),
        }),
      );
    });

    it('Scenario 2C: Customer DECLINES proposed reschedule -> status becomes CANCELLED without penalty, sets cancelledBy: USER', async () => {
      const mockAppt = {
        id: mockApptId,
        salonId: mockSalonId,
        status: AppointmentStatus.PENDING_RESCHEDULE,
        startAt: new Date('2026-09-30T10:00:00.000Z'),
        endAt: new Date('2026-09-30T10:30:00.000Z'),
        proposedStartAt: new Date('2026-09-30T15:00:00.000Z'),
        proposedEndAt: new Date('2026-09-30T15:30:00.000Z'),
        salonUser: { id: mockSalonUserId, user: { phone: mockCustomerPhone } },
      };

      jest.spyOn(prisma.appointment, 'findUnique').mockResolvedValue(mockAppt as any);
      (prisma.appointment.findFirst as any) = jest.fn().mockImplementation(async ({ where }: any) => {
        if (where?.id === mockApptId) return mockAppt as any;
        return null;
      });

      (prisma.appointment.update as any) = jest.fn().mockResolvedValue({
        ...mockAppt,
        status: AppointmentStatus.CANCELLED,
        cancelledBy: CancelledBy.USER,
        penaltyApplied: false,
        cancellationReason: 'DECLINED_SALON_RESCHEDULE',
      });

      const reply = await whatsappActionHandler.handleIncomingAction(
        mockSalonId,
        mockCustomerPhone,
        '',
        `propose_decline_${mockApptId}`,
        'pn-123',
      );

      expect(reply).toBeDefined();
      expect(reply.replyMessage).toContain('APPOINTMENT CANCELLED');
      expect(reply.replyMessage).toContain('No penalty');

      // Assert appointment was cancelled with zero penalty and cancelledBy: USER
      expect(prisma.appointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockApptId },
          data: expect.objectContaining({
            status: AppointmentStatus.CANCELLED,
            cancelledBy: CancelledBy.USER,
            cancellationReason: 'DECLINED_SALON_RESCHEDULE',
            penaltyApplied: false,
            proposedStartAt: null,
            proposedEndAt: null,
          }),
        }),
      );
    });

    it('Scenario 2D: Customer Reschedule Cutoff (<= 90m) -> blocked with buildRescheduleCutoffPassedPrompt and includes Cancel Booking button', async () => {
      const now = new Date();
      const in45m = new Date(now.getTime() + 45 * 60 * 1000);
      const mockAppt = {
        id: mockApptId,
        salonId: mockSalonId,
        status: AppointmentStatus.CONFIRMED,
        startAt: in45m,
        endAt: new Date(in45m.getTime() + 30 * 60 * 1000),
        appointmentDate: in45m,
        serviceId: 'srv-1',
        stylistId: 'sty-1',
        salonUser: { id: mockSalonUserId, user: { phone: mockCustomerPhone } },
      };

      jest.spyOn(prisma.appointment, 'findUnique').mockResolvedValue(mockAppt as any);
      (prisma.appointment.findFirst as any) = jest.fn().mockImplementation(async ({ where }: any) => {
        return mockAppt as any;
      });

      jest.spyOn(rescheduleService, 'validateRescheduleEligibility').mockResolvedValue({
        allowed: false,
        reason: 'Cutoff passed',
        hoursUntil: 0.75,
        cancelWindowHours: 1.5,
        appointment: mockAppt,
      });

      const reply = await whatsappActionHandler.handleIncomingAction(
        mockSalonId,
        mockCustomerPhone,
        '',
        'btn_reschedule',
        'pn-123',
      );

      expect(reply).toBeDefined();
      expect(reply.replyMessage).toContain('Reschedule Cutoff Passed');
      expect(reply.replyMessage).toContain('You cannot reschedule because the time cutoff has passed');

      expect(whatsappSender.sendMetaMessage).toHaveBeenCalledWith(
        mockCustomerPhone,
        expect.objectContaining({
          bodyText: expect.stringContaining('Reschedule Cutoff Passed'),
          buttons: expect.arrayContaining([
            expect.objectContaining({ title: '❌ Cancel Booking' }),
          ]),
        }),
        'pn-123',
        mockSalonId,
      );
    });

    it('Scenario 2E: Salon Admin Reschedule Validation -> proposing slot < 120m in future throws BadRequestException', async () => {
      const mockAppt = {
        id: mockApptId,
        salonId: mockSalonId,
        status: AppointmentStatus.CONFIRMED,
        startAt: new Date(),
        endAt: new Date(Date.now() + 30 * 60 * 1000),
        durationMinutes: 30,
        serviceId: 'srv-1',
        stylistId: 'sty-1',
        salonUserId: mockSalonUserId,
      };

      jest.spyOn(prisma.appointment, 'findFirst').mockResolvedValue(mockAppt as any);
      jest.spyOn(prisma.appointment, 'findUnique').mockResolvedValue(mockAppt as any);

      const nowLuxon = DateTime.now().setZone('Asia/Kolkata');
      const targetDate = nowLuxon.toISODate()!;
      const soonTime = nowLuxon.plus({ minutes: 30 }).toFormat('HH:mm');

      const availabilityService = (rescheduleService as any).availabilityService;
      jest.spyOn(availabilityService, 'getAvailableSlots').mockResolvedValue({
        date: targetDate,
        salonTimezone: 'Asia/Kolkata',
        availableSlots: [{ startTime: soonTime, endTime: '23:59' }],
      });

      await expect(
        rescheduleService.rescheduleAppointment(
          mockSalonId,
          mockApptId,
          { newDate: targetDate, newStartTime: soonTime },
          mockAdminId,
        ),
      ).rejects.toThrow('Proposed reschedule slot must be at least 2 hours in the future');
    });

    it('Scenario 2F: Stale Button Protection -> Customer clicks propose_accept when appointment is already CANCELLED -> returns expired notice', async () => {
      const mockCancelledAppt = {
        id: mockApptId,
        salonId: mockSalonId,
        status: AppointmentStatus.CANCELLED,
        startAt: new Date('2026-09-30T10:00:00.000Z'),
        endAt: new Date('2026-09-30T10:30:00.000Z'),
        proposedStartAt: null,
        proposedEndAt: null,
        salonUser: { id: mockSalonUserId, user: { phone: mockCustomerPhone } },
      };

      jest.spyOn(prisma.appointment, 'findUnique').mockResolvedValue(mockCancelledAppt as any);

      const reply = await whatsappActionHandler.handleIncomingAction(
        mockSalonId,
        mockCustomerPhone,
        '',
        `propose_accept_${mockApptId}`,
        'pn-123',
      );

      expect(reply).toBeDefined();
      expect(reply.replyMessage).toContain('Offer No Longer Available');
      expect(reply.replyMessage).toContain('reschedule proposal has expired');
    });

    it('Scenario 2G: Unresponsive Reschedule Proposal Expiry -> auto-cancels with 0 penalty, cancelledBy: SYSTEM, clears proposed fields, and sends buildRescheduleExpiredNotice', async () => {
      const mockPendingAppt = {
        id: mockApptId,
        salonId: mockSalonId,
        status: AppointmentStatus.PENDING_RESCHEDULE,
        startAt: new Date('2026-09-30T10:00:00.000Z'),
        endAt: new Date('2026-09-30T10:30:00.000Z'),
        proposedStartAt: new Date('2026-09-30T16:00:00.000Z'),
        proposedEndAt: new Date('2026-09-30T16:30:00.000Z'),
        proposedByAdminId: mockAdminId,
        salonUserId: mockSalonUserId,
        service: { name: 'Haircut', durationMinutes: 30, price: 50 },
        stylist: { id: 'sty-1', name: 'Vikram' },
        salonUser: { id: mockSalonUserId, yearlyNoShowCount: 0, user: { phone: mockCustomerPhone, name: 'Alice' } },
      };

      jest.spyOn(prisma.appointment, 'findFirst').mockResolvedValue(mockPendingAppt as any);
      jest.spyOn(prisma.appointment, 'findUnique').mockResolvedValue(mockPendingAppt as any);
      (prisma.appointment.update as any) = jest.fn().mockImplementation(async ({ data }: any) => ({
        ...mockPendingAppt,
        ...data,
      }));

      const cancelResult = await cancellationService.cancelBooking(mockSalonId, mockApptId, {
        source: 'SYSTEM_AUTO_CUTOFF',
        fault: 'SALON',
        noPenalty: true,
        reason: 'UNRESPONSIVE_RESCHEDULE_PROPOSAL_EXPIRED_60M',
        cancelledBy: CancelledBy.SYSTEM,
      });

      expect(cancelResult.status).toBe(AppointmentStatus.CANCELLED);
      expect(cancelResult.penaltyApplied).toBe(false);
      expect(cancelResult.penaltyCount).toBe(0);

      expect(prisma.appointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockApptId },
          data: expect.objectContaining({
            status: AppointmentStatus.CANCELLED,
            cancelledBy: CancelledBy.SYSTEM,
            penaltyApplied: false,
            proposedStartAt: null,
            proposedEndAt: null,
            proposedByAdminId: null,
          }),
        }),
      );

      // Verify that WhatsApp sent the expired proposal notice
      expect(whatsappSender.sendMetaMessage).toHaveBeenCalledWith(
        mockCustomerPhone,
        expect.objectContaining({
          bodyText: expect.stringContaining('Reschedule Offer Expired'),
        }),
        'pn-123',
        mockSalonId,
      );
    });
  });
});

