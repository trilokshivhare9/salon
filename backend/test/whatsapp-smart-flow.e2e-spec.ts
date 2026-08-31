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

    // Clean up test phone conversation
    await prisma.conversation.deleteMany({ where: { customerPhone: testCustomerPhone.replace('+', '') } });
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

  it('5. Selecting Date "date_1" (Today) should present available Time Slots', async () => {
    const res = await whatsappService.handleIncomingMessage(
      testSalon.id,
      testCustomerPhone,
      'date_1',
      'date_1',
    );

    expect(res.state).toBe(ConversationState.SELECT_TIME);
    expect(res.replyMessage).toContain('Choose an appointment time slot');
  });
});
