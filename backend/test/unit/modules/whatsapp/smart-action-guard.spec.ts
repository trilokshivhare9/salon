import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../../src/database/prisma.service';
import { WhatsAppService } from '../../../../src/modules/channels/whatsapp/whatsapp.service';
import { WhatsAppTemplateService } from '../../../../src/modules/channels/whatsapp/services/whatsapp-template.service';
import { AppointmentsService } from '../../../../src/modules/salon-admin/appointments/appointments.service';
import { AvailabilityService } from '../../../../src/modules/salon-admin/availability/availability.service';
import { ConfigService } from '@nestjs/config';
import { AppointmentStatus, BookingSource, ConversationState } from '@prisma/client';
import { QuickCodeService } from '../../../../src/modules/salon-admin/quick-booking/quick-code.service';

describe('Smart Action Guard & Lifecycle Intelligence (Edge Case Audits)', () => {
  let whatsAppService: WhatsAppService;
  let templateService: WhatsAppTemplateService;
  let prisma: PrismaService;

  let testSalon: any;
  let testUser: any;
  let salonUser: any;
  let testService: any;
  let testStylist: any;
  const testPhone = '919988776655';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PrismaService,
        WhatsAppService,
        WhatsAppTemplateService,
        {
          provide: QuickCodeService,
          useValue: {
            verifyCode: jest.fn(),
            getOrCreateTodayCode: jest.fn(),
          },
        },
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
            updateEtaStatus: jest.fn().mockResolvedValue(true),
            triggerSmartMoveUpBroadcast: jest.fn().mockResolvedValue(true),
            getAppointmentById: jest.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();

    whatsAppService = moduleRef.get<WhatsAppService>(WhatsAppService);
    templateService = moduleRef.get<WhatsAppTemplateService>(WhatsAppTemplateService);
    prisma = moduleRef.get<PrismaService>(PrismaService);

    jest.spyOn(whatsAppService, 'sendMetaMessage').mockImplementation(async () => true as any);

    testSalon = await prisma.salon.findFirst({
      where: { status: 'ACTIVE' },
      include: { services: true, stylists: true },
    });

    if (testSalon) {
      testService = testSalon.services?.[0];
      testStylist = testSalon.stylists?.[0];

      testUser = await prisma.user.upsert({
        where: { phone: testPhone },
        update: {},
        create: {
          phone: testPhone,
          name: 'Audit Client',
        },
      });

      salonUser = await prisma.salonUser.upsert({
        where: { salonId_userId: { salonId: testSalon.id, userId: testUser.id } },
        update: {},
        create: {
          salonId: testSalon.id,
          userId: testUser.id,
        },
      });
    }
  });

  afterAll(async () => {
    if (testSalon && testUser) {
      await prisma.appointment.deleteMany({
        where: { salonId: testSalon.id, salonUserId: salonUser?.id },
      });
      await prisma.conversation.deleteMany({
        where: { salonId: testSalon.id, customerPhone: testPhone },
      });
    }
  });

  // ---------------------------------------------------------------------------
  // EDGE CASE 1: Tapping remind_confirm on Auto-Canceled Appointment
  // ---------------------------------------------------------------------------
  it('EC-1: Tapping remind_confirm on Auto-Canceled appointment gives clear cancellation reason & offers New Booking (NEVER Continue Booking)', async () => {
    if (!testSalon || !testUser || !salonUser) return;

    // Create an auto-canceled appointment
    const canceledAppt = await prisma.appointment.create({
      data: {
        appointmentNumber: `AUDIT-CANCEL-${Date.now()}`,
        salonId: testSalon.id,
        salonUserId: salonUser.id,
        stylistId: testStylist?.id || null,
        serviceId: testService?.id || null,
        serviceNameSnapshot: testService?.name || 'Haircut',
        durationMinutes: 30,
        price: 350,
        status: AppointmentStatus.CANCELLED,
        cancellationReason: 'GHOSTED_2H_REMINDER',
        cancelledBy: 'SYSTEM',
        startAt: new Date(Date.now() + 3600000),
        endAt: new Date(Date.now() + 5400000),
        appointmentDate: new Date(),
        source: BookingSource.WHATSAPP,
      },
    });

    // Conversation state set to START
    await prisma.conversation.upsert({
      where: { salonId_customerPhone: { salonId: testSalon.id, customerPhone: testPhone } },
      update: { state: ConversationState.START, activeAppointmentId: canceledAppt.id },
      create: {
        salonId: testSalon.id,
        customerPhone: testPhone,
        state: ConversationState.START,
        activeAppointmentId: canceledAppt.id,
      },
    });

    const sendMetaSpy = jest.spyOn(whatsAppService, 'sendMetaMessage');
    sendMetaSpy.mockClear();

    const result = await whatsAppService.handleIncomingMessage(
      testSalon.id,
      testPhone,
      'remind_confirm',
      'remind_confirm',
    );

    expect(result.replyMessage).toContain('APPOINTMENT ALREADY CANCELED');
    expect(result.replyMessage).toContain('automatically canceled');
    expect(result.replyMessage).not.toContain('Continue Booking');

    expect(sendMetaSpy).toHaveBeenCalled();
    const payload = sendMetaSpy.mock.calls[0][1];
    expect(payload.buttons).toEqual([
      { id: 'btn_book_now', title: '📅 Book New Slot' },
      { id: 'btn_start', title: '🏠 Main Menu' },
    ]);
  });

  // ---------------------------------------------------------------------------
  // EDGE CASE 2: Tapping remind_confirm on Completed Appointment
  // ---------------------------------------------------------------------------
  it('EC-2: Tapping remind_confirm on Completed appointment gives friendly visit completed notice', async () => {
    if (!testSalon || !testUser || !salonUser) return;

    const completedAppt = await prisma.appointment.create({
      data: {
        appointmentNumber: `AUDIT-COMP-${Date.now()}`,
        salonId: testSalon.id,
        salonUserId: salonUser.id,
        stylistId: testStylist?.id || null,
        serviceId: testService?.id || null,
        serviceNameSnapshot: testService?.name || 'Haircut',
        durationMinutes: 30,
        price: 350,
        status: AppointmentStatus.COMPLETED,
        startAt: new Date(Date.now() - 3600000),
        endAt: new Date(Date.now() - 1800000),
        appointmentDate: new Date(),
        source: BookingSource.WHATSAPP,
      },
    });

    await prisma.conversation.upsert({
      where: { salonId_customerPhone: { salonId: testSalon.id, customerPhone: testPhone } },
      update: { state: ConversationState.START, activeAppointmentId: completedAppt.id },
      create: {
        salonId: testSalon.id,
        customerPhone: testPhone,
        state: ConversationState.START,
        activeAppointmentId: completedAppt.id,
      },
    });

    const sendMetaSpy = jest.spyOn(whatsAppService, 'sendMetaMessage');
    sendMetaSpy.mockClear();

    const result = await whatsAppService.handleIncomingMessage(
      testSalon.id,
      testPhone,
      'remind_confirm',
      'remind_confirm',
    );

    expect(result.replyMessage).toContain('VISIT COMPLETED');
    expect(result.replyMessage).not.toContain('Continue Booking');

    const payload = sendMetaSpy.mock.calls[0][1];
    expect(payload.buttons).toEqual([
      { id: 'btn_book_now', title: '📅 Book Again' },
      { id: 'btn_start', title: '🏠 Main Menu' },
    ]);
  });

  // ---------------------------------------------------------------------------
  // EDGE CASE 3: Idempotent Confirmation (Already Confirmed)
  // ---------------------------------------------------------------------------
  it('EC-3: Tapping remind_confirm on Already Confirmed appointment confirms without errors', async () => {
    if (!testSalon || !testUser || !salonUser) return;

    const confirmedAppt = await prisma.appointment.create({
      data: {
        appointmentNumber: `AUDIT-CONF-${Date.now()}`,
        salonId: testSalon.id,
        salonUserId: salonUser.id,
        stylistId: testStylist?.id || null,
        serviceId: testService?.id || null,
        serviceNameSnapshot: testService?.name || 'Haircut',
        durationMinutes: 30,
        price: 350,
        status: AppointmentStatus.CONFIRMED,
        startAt: new Date(Date.now() + 7200000),
        endAt: new Date(Date.now() + 9000000),
        appointmentDate: new Date(),
        source: BookingSource.WHATSAPP,
      },
    });

    await prisma.conversation.upsert({
      where: { salonId_customerPhone: { salonId: testSalon.id, customerPhone: testPhone } },
      update: { state: ConversationState.START, activeAppointmentId: confirmedAppt.id },
      create: {
        salonId: testSalon.id,
        customerPhone: testPhone,
        state: ConversationState.START,
        activeAppointmentId: confirmedAppt.id,
      },
    });

    const result = await whatsAppService.handleIncomingMessage(
      testSalon.id,
      testPhone,
      'remind_confirm',
      'remind_confirm',
    );

    expect(result.replyMessage).toContain('APPOINTMENT ALREADY CONFIRMED');
  });

  // ---------------------------------------------------------------------------
  // EDGE CASE 4: 2-Hour Reminder Prompt Wording & Warning Notice
  // ---------------------------------------------------------------------------
  it('EC-4: build2HourReminderPrompt includes "✅ Confirm Booking" button and 1-hour auto-cancel warning', () => {
    const prompt = templateService.build2HourReminderPrompt(
      'Glamour Salon',
      'Trilok',
      'Haircut',
      350,
      'Rahul',
      'Today, Oct 1',
      '04:00 PM',
      'Main Street',
    );

    expect(prompt.bodyText).toContain('Action Required within 1 Hour:');
    expect(prompt.bodyText).toContain('automatically canceled with a penalty strike');

    const confirmBtn = prompt.buttons.find((b: any) => b.id === 'remind_confirm');
    expect(confirmBtn).toBeDefined();
    expect(confirmBtn?.title).toBe('✅ Confirm Booking');
  });

  // ---------------------------------------------------------------------------
  // EDGE CASE 5: Tapping Funnel Action on Stale Draft (> 30 mins)
  // ---------------------------------------------------------------------------
  it('EC-5: Tapping funnel action after 35 mins resets cleanly with SESSION EXPIRED and clears dirty columns', async () => {
    if (!testSalon || !testUser) return;

    // Simulate stale draft with dirty columns updated 35 minutes ago
    const staleDate = new Date(Date.now() - 35 * 60 * 1000);
    await prisma.conversation.upsert({
      where: { salonId_customerPhone: { salonId: testSalon.id, customerPhone: testPhone } },
      update: {
        state: ConversationState.SELECT_TIME,
        selectedServiceId: testService?.id || 'dummy_svc',
        selectedDate: staleDate,
        updatedAt: staleDate,
        activeAppointmentId: null,
      },
      create: {
        salonId: testSalon.id,
        customerPhone: testPhone,
        state: ConversationState.SELECT_TIME,
        selectedServiceId: testService?.id || 'dummy_svc',
        selectedDate: staleDate,
        updatedAt: staleDate,
      },
    });

    const sendMetaSpy = jest.spyOn(whatsAppService, 'sendMetaMessage');
    sendMetaSpy.mockClear();

    const result = await whatsAppService.handleIncomingMessage(
      testSalon.id,
      testPhone,
      'slot_14:00',
      'slot_14:00',
    );

    expect(result.replyMessage).toContain('SESSION EXPIRED');

    // Verify conversation columns were wiped
    const updatedConv = await prisma.conversation.findUnique({
      where: { salonId_customerPhone: { salonId: testSalon.id, customerPhone: testPhone } },
    });
    expect(updatedConv?.selectedServiceId).toBeNull();
    expect(updatedConv?.selectedDate).toBeNull();
    expect(updatedConv?.state).toBe(ConversationState.START);
  });

  // ---------------------------------------------------------------------------
  // EDGE CASE 6: Tapping Resume Booking on Stale Draft
  // ---------------------------------------------------------------------------
  it('EC-6: Tapping btn_resume_booking on stale/dead draft resets cleanly without resurrecting old slots', async () => {
    if (!testSalon || !testUser) return;

    const staleDate = new Date(Date.now() - 40 * 60 * 1000);
    await prisma.conversation.upsert({
      where: { salonId_customerPhone: { salonId: testSalon.id, customerPhone: testPhone } },
      update: {
        state: ConversationState.SELECT_TIME,
        selectedServiceId: testService?.id || 'dummy_svc',
        selectedDate: staleDate,
        updatedAt: staleDate,
        activeAppointmentId: null,
      },
      create: {
        salonId: testSalon.id,
        customerPhone: testPhone,
        state: ConversationState.SELECT_TIME,
        selectedServiceId: testService?.id || 'dummy_svc',
        selectedDate: staleDate,
        updatedAt: staleDate,
      },
    });

    const sendMetaSpy = jest.spyOn(whatsAppService, 'sendMetaMessage');
    sendMetaSpy.mockClear();

    const result = await whatsAppService.handleIncomingMessage(
      testSalon.id,
      testPhone,
      'btn_resume_booking',
      'btn_resume_booking',
    );

    // Must show standard welcome message, not "Please pick an available time slot"
    expect(result.replyMessage).not.toContain('Please pick an available time slot');

    const updatedConv = await prisma.conversation.findUnique({
      where: { salonId_customerPhone: { salonId: testSalon.id, customerPhone: testPhone } },
    });
    expect(updatedConv?.selectedServiceId).toBeNull();
    expect(updatedConv?.state).toBe(ConversationState.START);
  });
});
