import { Test, TestingModule } from '@nestjs/testing';
import { CancellationService } from '../../../../src/modules/salon-admin/appointments/cancellation/cancellation.service';
import { RescheduleService } from '../../../../src/modules/salon-admin/appointments/reschedule/reschedule.service';
import { WhatsAppTemplateService } from '../../../../src/modules/channels/whatsapp/services/whatsapp-template.service';
import { PrismaService } from '../../../../src/database/prisma.service';
import { AppointmentEventsService } from '../../../../src/modules/salon-admin/appointments/events/appointment-events.service';
import { AppointmentModifierService } from '../../../../src/modules/salon-admin/appointments/modifier/appointment-modifier.service';
import { AvailabilityService } from '../../../../src/modules/salon-admin/availability/availability.service';
import { AvailabilityEngineService } from '../../../../src/modules/salon-admin/availability/availability-engine.service';
import { WhatsAppSenderService } from '../../../../src/modules/channels/whatsapp/services/whatsapp-sender.service';
import { WhatsAppService } from '../../../../src/modules/channels/whatsapp/whatsapp.service';
import { AppointmentStatus, BookingSource, WhatsAppMessageDirection } from '@prisma/client';
import { WhatsAppButtonId } from '../../../../src/modules/channels/whatsapp/services/whatsapp-sender.service';

describe('Quick Booking Penalty & Reschedule Restrictions', () => {
  let cancellationService: CancellationService;
  let rescheduleService: RescheduleService;
  let templateService: WhatsAppTemplateService;
  let mockPrisma: any;
  let mockModifierService: any;

  beforeEach(async () => {
    mockPrisma = {
      salon: {
        findUnique: jest.fn().mockResolvedValue({ id: 'salon-1', name: 'Test Salon', whatsappAccount: null }),
      },
      appointment: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      salonUser: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
      },
    };

    mockModifierService = {
      getAppointment: jest.fn().mockImplementation(async (sId, aId) => mockPrisma.appointment.findUnique({ where: { id: aId } })),
      modifyStatus: jest.fn().mockImplementation(async (sId, aId, data) => ({
        id: aId,
        status: data.status,
        cancelledBy: data.cancelledBy,
        penaltyApplied: data.penaltyApplied,
      })),
      syncAlarm: jest.fn().mockResolvedValue(null),
    };

    templateService = new WhatsAppTemplateService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CancellationService,
        RescheduleService,
        AvailabilityEngineService,
        { provide: AppointmentModifierService, useValue: mockModifierService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AppointmentEventsService, useValue: { emitSalonEvent: jest.fn() } },
        { provide: WhatsAppSenderService, useValue: { sendMetaMessage: jest.fn().mockResolvedValue(true) } },
        { provide: AvailabilityService, useValue: { findAvailableDates: jest.fn().mockResolvedValue([]) } },
        { provide: WhatsAppService, useValue: { sendMetaMessage: jest.fn().mockResolvedValue(true) } },
        { provide: WhatsAppTemplateService, useValue: templateService },
      ],
    }).compile();

    cancellationService = module.get<CancellationService>(CancellationService);
    rescheduleService = module.get<RescheduleService>(RescheduleService);
  });

  describe('1. Quick Booking Cancellation Penalty', () => {
    it('applies a penalty strike when cancelling a confirmed quick booking (<90m remaining)', async () => {
      const now = new Date();
      const in10Minutes = new Date(now.getTime() + 10 * 60 * 1000);

      const mockAppt = {
        id: 'appt-quick-1',
        salonId: 'salon-1',
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.QUICK_BOOK,
        bookingType: 'QUICK',
        startAt: in10Minutes,
        endAt: new Date(in10Minutes.getTime() + 30 * 60 * 1000),
        salonUserId: 'su-1',
        salonUser: { id: 'su-1', yearlyNoShowCount: 0, isBookingBlocked: false },
        service: { name: 'Hair' },
        stylist: { name: 'Stylist' },
      };

      mockPrisma.appointment.findUnique.mockResolvedValue(mockAppt);
      mockPrisma.salonUser.findUnique.mockResolvedValue({ id: 'su-1', yearlyNoShowCount: 0, isBookingBlocked: false });
      mockPrisma.salonUser.update.mockResolvedValue({ id: 'su-1', yearlyNoShowCount: 1, isBookingBlocked: false });

      const penaltyCheck = await cancellationService.checkCancellationPenalty('salon-1', 'appt-quick-1');
      expect(penaltyCheck.willIncurPenalty).toBe(true);

      const cancelResult = await cancellationService.cancelBooking('salon-1', 'appt-quick-1', {
        source: 'CUSTOMER_WHATSAPP',
        fault: 'CLIENT',
        reason: 'Customer cancelled quick booking',
      });

      expect(cancelResult.penaltyApplied).toBe(true);
      expect(cancelResult.penaltyCount).toBe(1);
      expect(mockPrisma.salonUser.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'su-1' },
          data: expect.objectContaining({ yearlyNoShowCount: 1 }),
        }),
      );
    });
  });

  describe('2. Quick Booking Reschedule Restriction', () => {
    it('disallows reschedule eligibility for Quick Bookings', async () => {
      const mockAppt = {
        id: 'appt-quick-2',
        salonId: 'salon-1',
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.QUICK_BOOK,
        bookingType: 'QUICK',
        startAt: new Date(Date.now() + 10 * 60 * 1000),
        endAt: new Date(Date.now() + 40 * 60 * 1000),
        salonUserId: 'su-1',
        service: { name: 'Hair' },
        stylist: { name: 'Stylist' },
      };

      mockPrisma.appointment.findUnique.mockResolvedValue(mockAppt);

      const eligibility = await rescheduleService.validateRescheduleEligibility('salon-1', 'appt-quick-2');
      expect(eligibility.allowed).toBe(false);
      expect(eligibility.reason).toContain('Rescheduling is only permitted up to 90 minutes');
    });
  });

  describe('3. WhatsApp Welcome Message Buttons for Quick Booking', () => {
    it('does NOT include Reschedule button for confirmed Quick Bookings', () => {
      const activeAppt = {
        id: 'appt-quick-3',
        status: AppointmentStatus.CONFIRMED,
        source: 'QUICK_BOOK',
        bookingType: 'QUICK',
        startAt: new Date(),
        clientEtaStatus: null,
      };

      const salon = { name: 'Test Salon', timezone: 'Asia/Kolkata' };
      const welcome = templateService.buildWelcomeMessage(salon, activeAppt);

      const buttonIds = welcome.buttons.map((b: any) => b.id);
      expect(buttonIds).not.toContain(WhatsAppButtonId.RESCHEDULE);
      expect(buttonIds).toContain(WhatsAppButtonId.ADD_SERVICE);
      expect(buttonIds).toContain(WhatsAppButtonId.ETA_ON_THE_WAY);
      expect(buttonIds).toContain(WhatsAppButtonId.CANCEL_APPT);
    });

    it('does NOT include Reschedule button when appointment is CHECKED_IN', () => {
      const activeAppt = {
        id: 'appt-quick-4',
        status: AppointmentStatus.CHECKED_IN,
        source: 'QUICK_BOOK',
        bookingType: 'QUICK',
        startAt: new Date(),
        clientEtaStatus: 'ARRIVED',
      };

      const salon = { name: 'Test Salon', timezone: 'Asia/Kolkata' };
      const welcome = templateService.buildWelcomeMessage(salon, activeAppt);

      const buttonIds = welcome.buttons.map((b: any) => b.id);
      expect(buttonIds).not.toContain(WhatsAppButtonId.RESCHEDULE);
      expect(buttonIds).toContain(WhatsAppButtonId.ADD_SERVICE);
      expect(buttonIds).toContain(WhatsAppButtonId.INFO);
      expect(buttonIds).toContain(WhatsAppButtonId.CANCEL_APPT);
    });
  });

  describe('4. Directions & Info Context-Aware Buttons', () => {
    it('shows Check Booking and Main Menu when customer has an active booking', () => {
      const salon = { name: 'dbtech', address: 'Indore, MP' };
      const infoMsg = templateService.buildSalonInfoMessage(salon, true);

      const buttonIds = infoMsg.buttons.map((b: any) => b.id);
      expect(buttonIds).not.toContain(WhatsAppButtonId.BOOK);
      expect(buttonIds).toContain(WhatsAppButtonId.CHECK_LAST_BOOKING);
      expect(buttonIds).toContain(WhatsAppButtonId.START);
    });

    it('shows Book Slot and Main Menu when customer has NO active booking', () => {
      const salon = { name: 'dbtech', address: 'Indore, MP' };
      const infoMsg = templateService.buildSalonInfoMessage(salon, false);

      const buttonIds = infoMsg.buttons.map((b: any) => b.id);
      expect(buttonIds).toContain(WhatsAppButtonId.BOOK);
      expect(buttonIds).not.toContain(WhatsAppButtonId.CHECK_LAST_BOOKING);
      expect(buttonIds).toContain(WhatsAppButtonId.START);
    });
  });
});
