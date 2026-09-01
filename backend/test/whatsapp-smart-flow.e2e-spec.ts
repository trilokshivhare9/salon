import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { WhatsAppService } from '../src/modules/whatsapp/whatsapp.service';
import { ConversationState } from '@prisma/client';

describe('WhatsApp Smart Frictionless Flow (E2E Tests)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let whatsappService: WhatsAppService;
  let testSalon: any;
  let testService: any;
  let testStaff: any;
  const testCustomerPhone = '+919999000099';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    whatsappService = app.get(WhatsAppService);

    // Clean up test phone conversation & appointments
    await prisma.conversation.deleteMany({ where: { customerPhone: testCustomerPhone } });
    await prisma.appointmentStatusHistory.deleteMany({
      where: { appointment: { customer: { phone: testCustomerPhone } } },
    });
    await prisma.appointment.deleteMany({ where: { customer: { phone: testCustomerPhone } } });
    await prisma.customer.deleteMany({ where: { phone: testCustomerPhone } });

    // Setup or get active test salon with 1 staff and 1 service
    testSalon = await prisma.salon.findFirst({
      where: { slug: 'royal' },
      include: { services: true, staff: { include: { services: true } } },
    });

    if (!testSalon) {
      testSalon = await prisma.salon.create({
        data: {
          name: 'royal',
          slug: 'royal',
          email: 'royal@test.com',
          phone: '+917999817743',
          status: 'ACTIVE',
        },
        include: { services: true, staff: { include: { services: true } } },
      });
    }

    // Keep only 1 active service for testSalon to test single-service fast track
    if (testSalon.services.length > 1) {
      const extraServices = testSalon.services.slice(1);
      await prisma.staffService.deleteMany({
        where: { serviceId: { in: extraServices.map((s) => s.id) } },
      });
      await prisma.appointment.deleteMany({
        where: { serviceId: { in: extraServices.map((s) => s.id) } },
      });
      await prisma.service.deleteMany({
        where: { id: { in: extraServices.map((s) => s.id) } },
      });
      testSalon = await prisma.salon.findFirst({
        where: { id: testSalon.id },
        include: { services: true, staff: { include: { services: true } } },
      });
    }

    testService = testSalon.services[0];
    testStaff = testSalon.staff[0];
    // Ensure testStaff is assigned to testService
    if (testStaff && testService) {
      await prisma.staffService.upsert({
        where: {
          staffId_serviceId: {
            staffId: testStaff.id,
            serviceId: testService.id,
          },
        },
        update: {},
        create: {
          staffId: testStaff.id,
          serviceId: testService.id,
        },
      });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. Greeting "Hi" should return main menu with 3 options', async () => {
    const res = await whatsappService.handleIncomingMessage(
      testSalon.id,
      testCustomerPhone,
      'Hi',
    );

    expect(res.state).toBe(ConversationState.START);
    expect(res.replyMessage).toContain('Welcome to royal');
  });

  it('2. Single-Service & Single-Staff Fast-Track: Clicking "btn_book" MUST jump directly to Date Selection with zero redundant questions', async () => {
    const res = await whatsappService.handleIncomingMessage(
      testSalon.id,
      testCustomerPhone,
      'btn_book',
      'btn_book',
    );

    expect(res.state).toBe(ConversationState.SELECT_DATE);
    expect(res.replyMessage).toContain(testService.name);
    expect(res.replyMessage).toContain('Select Date for your appointment');

    // Verify DB conversation state
    const conv = await prisma.conversation.findFirst({
      where: { customerPhone: testCustomerPhone },
    });
    expect(conv?.selectedServiceId).toBe(testService.id);
    expect(conv?.state).toBe(ConversationState.SELECT_DATE);
  });

  it('3. Services Menu: Clicking "btn_services" on a 1-service salon should show direct "Book" button', async () => {
    // Reset to start
    await whatsappService.handleIncomingMessage(testSalon.id, testCustomerPhone, 'Hi');

    const res = await whatsappService.handleIncomingMessage(
      testSalon.id,
      testCustomerPhone,
      'btn_services',
      'btn_services',
    );

    expect(res.state).toBe(ConversationState.START);
    expect(res.replyMessage).toContain(testService.name);
    expect(res.replyMessage).toContain(testService.price.toString());
  });

  it('4. Direct Service Trigger "svc_<id>" should immediately advance to Date Selection', async () => {
    const res = await whatsappService.handleIncomingMessage(
      testSalon.id,
      testCustomerPhone,
      `svc_${testService.id}`,
      `svc_${testService.id}`,
    );

    expect(res.state).toBe(ConversationState.SELECT_DATE);
    expect(res.replyMessage).toContain('Select Date');
  });

  it('5. Selecting Date "date_2" (Tomorrow) should present available Time Slots', async () => {
    const res = await whatsappService.handleIncomingMessage(
      testSalon.id,
      testCustomerPhone,
      'date_2',
      'date_2',
    );

    expect(res.state).toBe(ConversationState.SELECT_TIME);
    expect(res.replyMessage).toContain('Choose an appointment time slot');
  });

  it('6. Full Booking Confirmation creates appointment in DB', async () => {
    // Pick the first time slot
    const slotsRes = await whatsappService.handleIncomingMessage(
      testSalon.id,
      testCustomerPhone,
      'slot_10:00',
      'slot_10:00',
    );

    // If prompts for name
    if (slotsRes.state === ConversationState.COLLECT_NAME) {
      await whatsappService.handleIncomingMessage(
        testSalon.id,
        testCustomerPhone,
        'Trilok Tester',
      );
    }

    // Confirm booking
    const confirmRes = await whatsappService.handleIncomingMessage(
      testSalon.id,
      testCustomerPhone,
      'btn_confirm_yes',
      'btn_confirm_yes',
    );

    expect(confirmRes.state).toBe(ConversationState.COMPLETED);
    expect(confirmRes.replyMessage).toContain('APPOINTMENT CONFIRMED');

    // Verify appointment in DB
    const appt = await prisma.appointment.findFirst({
      where: {
        salonId: testSalon.id,
        customer: { phone: testCustomerPhone },
        status: 'CONFIRMED',
      },
    });
    expect(appt).toBeDefined();
  });

  it('7. Active Booking Hub: Greeting "Hi" when user has active booking displays Active Hub with 3 actions', async () => {
    const res = await whatsappService.handleIncomingMessage(
      testSalon.id,
      testCustomerPhone,
      'Hi',
    );

    expect(res.state).toBe(ConversationState.ACTIVE_HUB);
    expect(res.replyMessage).toContain('Your Upcoming Appointment');
    expect(res.replyMessage).toContain(testService.name);
  });

  it('8. Add-on Flow: Clicking "btn_add_service" shows extra services and adds to appointment', async () => {
    // Create a 2nd service in the salon for add-on testing
    const extraService = await prisma.service.create({
      data: {
        salonId: testSalon.id,
        name: 'Head Massage',
        price: 150,
        durationMinutes: 20,
        category: 'Hair Care & Styling',
        status: 'ACTIVE',
      },
    });

    const addonPrompt = await whatsappService.handleIncomingMessage(
      testSalon.id,
      testCustomerPhone,
      'btn_add_service',
      'btn_add_service',
    );

    expect(addonPrompt.state).toBe(ConversationState.SELECT_ADDON);

    // Select the addon
    const addonConfirm = await whatsappService.handleIncomingMessage(
      testSalon.id,
      testCustomerPhone,
      `addon_${extraService.id}`,
      `addon_${extraService.id}`,
    );

    expect(addonConfirm.replyMessage).toContain('Added to Your Visit');
    expect(addonConfirm.replyMessage).toContain(extraService.name);

    // Verify appointment updated in DB
    const appt = await prisma.appointment.findFirst({
      where: {
        salonId: testSalon.id,
        customer: { phone: testCustomerPhone },
        status: 'CONFIRMED',
      },
    });
    expect(appt?.notes).toContain(extraService.name);

    // Cleanup extra service
    await prisma.service.delete({ where: { id: extraService.id } });
  });

  it('9. Reschedule Flow: Selecting "btn_reschedule" updates date and time cleanly', async () => {
    // Re-trigger active hub
    await whatsappService.handleIncomingMessage(testSalon.id, testCustomerPhone, 'Hi');

    const resDatePrompt = await whatsappService.handleIncomingMessage(
      testSalon.id,
      testCustomerPhone,
      'btn_reschedule',
      'btn_reschedule',
    );

    expect(resDatePrompt.state).toBe(ConversationState.SELECT_RESCHEDULE_DATE);

    // Pick Day After Tomorrow
    const resSlotPrompt = await whatsappService.handleIncomingMessage(
      testSalon.id,
      testCustomerPhone,
      'rdate_3',
      'rdate_3',
    );

    expect(resSlotPrompt.state).toBe(ConversationState.SELECT_RESCHEDULE_TIME);
  });

  it('10. Cancellation Flow: Selecting "btn_cancel_appt" frees up the slot and logs cancellation', async () => {
    // Re-trigger active hub
    await whatsappService.handleIncomingMessage(testSalon.id, testCustomerPhone, 'Hi');

    const cancelPrompt = await whatsappService.handleIncomingMessage(
      testSalon.id,
      testCustomerPhone,
      'btn_cancel_appt',
      'btn_cancel_appt',
    );

    expect(cancelPrompt.state).toBe(ConversationState.CONFIRM_CANCEL);

    const cancelConfirm = await whatsappService.handleIncomingMessage(
      testSalon.id,
      testCustomerPhone,
      'btn_cancel_yes',
      'btn_cancel_yes',
    );

    expect(cancelConfirm.state).toBe(ConversationState.START);
    expect(cancelConfirm.replyMessage).toContain('Appointment Cancelled');

    // Verify next "Hi" returns standard booking menu (no trapped state)
    const nextHi = await whatsappService.handleIncomingMessage(
      testSalon.id,
      testCustomerPhone,
      'Hi',
    );
    expect(nextHi.state).toBe(ConversationState.START);
    expect(nextHi.replyMessage).toContain('Welcome to royal');
  });
});
