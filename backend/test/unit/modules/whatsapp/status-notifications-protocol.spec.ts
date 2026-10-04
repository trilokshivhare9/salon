import { Test, TestingModule } from '@nestjs/testing';
import { WhatsAppSenderService, WhatsAppButtonId } from '../../../../src/modules/channels/whatsapp/services/whatsapp-sender.service';
import { WhatsAppTemplateService } from '../../../../src/modules/channels/whatsapp/services/whatsapp-template.service';
import { AppointmentStatusService } from '../../../../src/modules/salon-admin/appointments/status/appointment-status.service';
import { PrismaService } from '../../../../src/database/prisma.service';
import { WhatsAppService } from '../../../../src/modules/channels/whatsapp/whatsapp.service';
import { AppointmentStatus } from '@prisma/client';

import { ConfigService } from '@nestjs/config';

describe('WhatsApp Lifecycle Notifications Protocol Defense (SEATED_IN_CHAIR & COMPLETED)', () => {
  let senderService: WhatsAppSenderService;
  let templateService: WhatsAppTemplateService;
  let statusService: AppointmentStatusService;
  let prisma: PrismaService;
  let whatsAppService: WhatsAppService;

  beforeAll(async () => {
    const mockPrisma = {
      appointment: {
        findFirst: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      whatsAppLog: {
        create: jest.fn().mockResolvedValue({}),
      },
      salonUser: {
        update: jest.fn().mockResolvedValue({}),
      },
      salon: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'salon-123',
          name: 'Developer Bazaar Salon',
          timezone: 'Asia/Kolkata',
          whatsappAccount: { phoneNumberId: '1344691785393273' },
        }),
      },
      whatsAppAccount: {
        findFirst: jest.fn().mockResolvedValue({
          accessToken: 'mock-access-token',
          phoneNumberId: '1344691785393273',
          isActive: true,
        }),
      },
      salonWhatsAppAccount: {
        findUnique: jest.fn().mockResolvedValue({
          accessToken: 'mock-access-token',
          phoneNumberId: '1344691785393273',
        }),
      },
    };

    const mockWhatsAppService = {
      sendMetaMessage: jest.fn().mockResolvedValue(true),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppSenderService,
        WhatsAppTemplateService,
        AppointmentStatusService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: WhatsAppService, useValue: mockWhatsAppService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'WHATSAPP_ACCESS_TOKEN') return 'default-token';
              if (key === 'WHATSAPP_PHONE_NUMBER_ID') return '1344691785393273';
              return null;
            }),
          },
        },
      ],
    }).compile();

    senderService = moduleRef.get<WhatsAppSenderService>(WhatsAppSenderService);
    templateService = moduleRef.get<WhatsAppTemplateService>(WhatsAppTemplateService);
    statusService = moduleRef.get<AppointmentStatusService>(AppointmentStatusService);
    prisma = moduleRef.get<PrismaService>(PrismaService);
    whatsAppService = moduleRef.get<WhatsAppService>(WhatsAppService);
  });

  describe('1. WhatsAppSenderService Protocol Defense Guard', () => {
    it('should sanitize duplicate button IDs to prevent Meta Graph API #131009 error', async () => {
      let interceptedPayload: any = null;
      // Mock global fetch to inspect request body sent to Meta
      const originalFetch = global.fetch;
      global.fetch = jest.fn(async (url: any, init: any) => {
        interceptedPayload = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ messages: [{ id: 'wamid.test123' }] }),
        } as any;
      });

      try {
        const payloadWithDuplicates = {
          bodyText: 'Thank you for your visit!',
          interactiveType: 'button' as const,
          buttons: [
            { id: 'btn_start', title: '⭐ Great Service!' },
            { id: 'btn_start', title: '📅 Book Next Visit' },
            { id: 'btn_start', title: '🏠 Main Menu' },
          ],
        };

        const result = await senderService.sendMetaMessage(
          '919876543210',
          payloadWithDuplicates,
          '1344691785393273',
          'test-salon-id',
        );

        expect(result).toBe(true);
        expect(interceptedPayload).toBeDefined();
        expect(interceptedPayload.interactive.type).toBe('button');
        
        const buttons = interceptedPayload.interactive.action.buttons;
        expect(buttons).toHaveLength(3);
        // All IDs must be strictly unique
        const ids = buttons.map((b: any) => b.reply.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(3);
        expect(ids[0]).toBe('btn_start');
        expect(ids[1]).toBe('btn_start_2');
        expect(ids[2]).toBe('btn_start_3');
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('should clamp button titles to max 20 chars and buttons array to max 3', async () => {
      let interceptedPayload: any = null;
      const originalFetch = global.fetch;
      global.fetch = jest.fn(async (url: any, init: any) => {
        interceptedPayload = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ messages: [{ id: 'wamid.test456' }] }),
        } as any;
      });

      try {
        const payloadWithLongTitleAndExcessButtons = {
          bodyText: 'Test clamping',
          interactiveType: 'button' as const,
          buttons: [
            { id: 'btn_1', title: 'This Title Is Way Too Long For WhatsApp Button' },
            { id: 'btn_2', title: 'Short Title' },
            { id: 'btn_3', title: 'Third Button' },
            { id: 'btn_4', title: 'Fourth Discarded Button' },
          ],
        };

        await senderService.sendMetaMessage(
          '919876543210',
          payloadWithLongTitleAndExcessButtons,
          '1344691785393273',
          'test-salon-id',
        );

        const buttons = interceptedPayload.interactive.action.buttons;
        expect(buttons).toHaveLength(3);
        expect(buttons[0].reply.title.length).toBeLessThanOrEqual(20);
        expect(buttons[0].reply.title).toBe('This Title Is Way To');
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('2. WhatsAppTemplateService Lifecycle Templates', () => {
    it('should generate buildSeatedInChairReply with valid interactive structure', () => {
      const reply = templateService.buildSeatedInChairReply(
        'Royal Salon',
        'Sarah Jenkins',
        'Hair Styling & Beard Trim',
      );

      expect(reply.bodyText).toContain('YOU\'RE IN THE CHAIR!');
      expect(reply.bodyText).toContain('Sarah Jenkins');
      expect(reply.bodyText).toContain('Royal Salon');
      expect(reply.interactiveType).toBe('button');
      expect(reply.buttons).toHaveLength(1);
      expect(reply.buttons[0].id).toBe(WhatsAppButtonId.START);
      expect(reply.buttons[0].title.length).toBeLessThanOrEqual(20);
    });

    it('should generate buildCompletedReceiptReply with unique button IDs and titles <= 20 chars', () => {
      const receipt = templateService.buildCompletedReceiptReply({
        salonName: 'Royal Salon',
        serviceName: 'Executive Haircut',
        stylistName: 'Alex',
        price: 500,
        customerName: 'Rahul',
      });

      expect(receipt.bodyText).toContain('THANK YOU FOR VISITING ROYAL SALON!');
      expect(receipt.bodyText).toContain('Executive Haircut');
      expect(receipt.bodyText).toContain('₹500');
      expect(receipt.interactiveType).toBe('button');
      expect(receipt.buttons).toHaveLength(3);

      // Verify all button IDs are unique
      const ids = receipt.buttons.map((b) => b.id);
      expect(new Set(ids).size).toBe(3);
      expect(ids).toContain(WhatsAppButtonId.FEEDBACK_GREAT);
      expect(ids).toContain(WhatsAppButtonId.BOOK);
      expect(ids).toContain(WhatsAppButtonId.START);

      // Verify button title lengths
      for (const btn of receipt.buttons) {
        expect(btn.title.length).toBeLessThanOrEqual(20);
      }
    });

    it('should generate buildFeedbackThanksReply with valid structure', () => {
      const reply = templateService.buildFeedbackThanksReply(
        'Royal Salon',
        'https://maps.google.com/review',
      );

      expect(reply.bodyText).toContain('THANK YOU FOR YOUR FEEDBACK!');
      expect(reply.bodyText).toContain('https://maps.google.com/review');
      expect(reply.buttons).toHaveLength(2);
      expect(reply.buttons[0].id).toBe(WhatsAppButtonId.BOOK);
      expect(reply.buttons[1].id).toBe(WhatsAppButtonId.START);
    });
  });

  describe('3. AppointmentStatusService Transition Notifications', () => {
    const baseMockAppointment = {
      id: 'appt-123',
      salonId: 'salon-123',
      appointmentNumber: 'APT-1001',
      status: AppointmentStatus.CHECKED_IN,
      startAt: new Date(Date.now() + 3600000),
      endAt: new Date(Date.now() + 7200000),
      price: 450,
      serviceNameSnapshot: 'Fade Cut',
      stylist: { name: 'Vikram' },
      salon: {
        id: 'salon-123',
        name: 'Developer Bazaar Salon',
        timezone: 'Asia/Kolkata',
        whatsappAccount: { phoneNumberId: '1344691785393273' },
      },
      salonUser: {
        id: 'su-123',
        penaltyStrikes: 0,
        user: { name: 'Trilok', phone: '919876543210' },
      },
    };

    it('should send WhatsApp notification when transitioned to SEATED_IN_CHAIR', async () => {
      (prisma.appointment.findFirst as jest.Mock).mockResolvedValue(baseMockAppointment);
      (prisma.appointment.update as jest.Mock).mockResolvedValue({
        ...baseMockAppointment,
        status: AppointmentStatus.SEATED_IN_CHAIR,
      });

      await statusService.updateAppointmentStatus(
        'salon-123',
        'appt-123',
        { status: AppointmentStatus.SEATED_IN_CHAIR },
      );

      expect(whatsAppService.sendMetaMessage).toHaveBeenCalledWith(
        '919876543210',
        expect.objectContaining({
          bodyText: expect.stringContaining("YOU'RE IN THE CHAIR!"),
          interactiveType: 'button',
        }),
        '1344691785393273',
        'salon-123',
      );
    });

    it('should send WhatsApp completed receipt notification when transitioned to COMPLETED', async () => {
      const seatedAppointment = {
        ...baseMockAppointment,
        status: AppointmentStatus.SEATED_IN_CHAIR,
      };
      (prisma.appointment.findFirst as jest.Mock).mockResolvedValue(seatedAppointment);
      (prisma.appointment.update as jest.Mock).mockResolvedValue({
        ...seatedAppointment,
        status: AppointmentStatus.COMPLETED,
      });

      await statusService.updateAppointmentStatus(
        'salon-123',
        'appt-123',
        { status: AppointmentStatus.COMPLETED },
      );

      expect(whatsAppService.sendMetaMessage).toHaveBeenCalledWith(
        '919876543210',
        expect.objectContaining({
          bodyText: expect.stringContaining('THANK YOU FOR VISITING'),
          interactiveType: 'button',
          buttons: expect.arrayContaining([
            expect.objectContaining({ id: WhatsAppButtonId.FEEDBACK_GREAT }),
            expect.objectContaining({ id: WhatsAppButtonId.BOOK }),
            expect.objectContaining({ id: WhatsAppButtonId.START }),
          ]),
        }),
        '1344691785393273',
        'salon-123',
      );
    });
  });
});
