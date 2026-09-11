import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../database/prisma.service';
import { WhatsAppService } from './whatsapp.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { AvailabilityService } from '../availability/availability.service';
import { ConfigService } from '@nestjs/config';
import { ConversationState } from '@prisma/client';

describe('Smart WhatsApp Stale Button Fallbacks (Flow Matrix Tests)', () => {
  let whatsAppService: WhatsAppService;
  let prisma: PrismaService;

  let testSalon: any;
  const testCustomerPhone = '919999111122';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PrismaService,
        WhatsAppService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
        {
          provide: AvailabilityService,
          useValue: { getAvailableSlots: jest.fn() },
        },
        {
          provide: AppointmentsService,
          useValue: {
            updateStatus: jest.fn().mockResolvedValue(true),
            triggerSmartMoveUpBroadcast: jest.fn().mockResolvedValue(true),
            getAppointmentById: jest.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();

    whatsAppService = moduleRef.get<WhatsAppService>(WhatsAppService);
    prisma = moduleRef.get<PrismaService>(PrismaService);

    // Mock sendMetaMessage to capture payload sent to WhatsApp
    jest.spyOn(whatsAppService, 'sendMetaMessage').mockImplementation(async () => true as any);

    testSalon = await prisma.salon.findFirst({
      where: { status: 'ACTIVE' },
    });
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 1: Mid-Booking Flow Stale Button Tap
  // ---------------------------------------------------------------------------
  it('TC-STALE-001: User taps old button while mid-booking -> Sends "continue booking or start new"', async () => {
    if (!testSalon) return;

    // Set conversation state to active booking step (e.g. SELECT_SERVICE)
    await prisma.conversation.upsert({
      where: { salonId_customerPhone: { salonId: testSalon.id, customerPhone: testCustomerPhone } },
      update: { state: ConversationState.SELECT_SERVICE },
      create: {
        salonId: testSalon.id,
        customerPhone: testCustomerPhone,
        state: ConversationState.SELECT_SERVICE,
      },
    });

    const sendMetaSpy = jest.spyOn(whatsAppService, 'sendMetaMessage');
    sendMetaSpy.mockClear();

    // Customer taps an invalid/stale button for SELECT_SERVICE state (e.g., date_old_2026)
    const result = await whatsAppService.handleIncomingMessage(
      testSalon.id,
      testCustomerPhone,
      'date_old_2026',
      'date_old_2026',
    );

    expect(result.replyMessage).toContain('This option has expired. Would you like to continue your current booking or start a new one?');

    expect(sendMetaSpy).toHaveBeenCalled();
    const payload = sendMetaSpy.mock.calls[0][1];
    expect(payload.buttons).toEqual([
      { id: 'btn_book', title: '▶️ Continue Booking' },
      { id: 'btn_start', title: '📅 New Booking' },
    ]);
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 2: Idle / Completed / Post-Booking Stale Button Tap
  // ---------------------------------------------------------------------------
  it('TC-STALE-002: User taps old button after booking is done/idle -> Sends "check last booking or start new"', async () => {
    if (!testSalon) return;

    // Set conversation state to START (idle state)
    await prisma.conversation.upsert({
      where: { salonId_customerPhone: { salonId: testSalon.id, customerPhone: testCustomerPhone } },
      update: { state: ConversationState.START },
      create: {
        salonId: testSalon.id,
        customerPhone: testCustomerPhone,
        state: ConversationState.START,
      },
    });

    const sendMetaSpy = jest.spyOn(whatsAppService, 'sendMetaMessage');
    sendMetaSpy.mockClear();

    // Customer taps an old reminder button when NO active appointment exists
    const result = await whatsAppService.handleIncomingMessage(
      testSalon.id,
      testCustomerPhone,
      'remind_confirm',
      'remind_confirm',
    );

    expect(result.replyMessage).toContain('This option has expired. You can check your last booking or start a new one.');

    expect(sendMetaSpy).toHaveBeenCalled();
    const payload = sendMetaSpy.mock.calls[0][1];
    expect(payload.buttons).toEqual([
      { id: 'btn_book', title: '📋 Check Last Booking' },
      { id: 'btn_start', title: '📅 New Booking' },
    ]);
  });
});
