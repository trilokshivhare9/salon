import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { WhatsAppService } from '../src/modules/whatsapp/whatsapp.service';
import { RemindersService } from '../src/modules/appointments/reminders.service';
import { DateTime } from 'luxon';

describe('Smart WhatsApp Reminders & Late Arrival Flow (E2E Tests)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let whatsappService: WhatsAppService;
  let remindersService: RemindersService;
  let testSalon: any;
  let testCustomer: any;
  let testStaff: any;
  let testService: any;
  const testCustomerPhone = '+919999000099';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    whatsappService = app.get(WhatsAppService);
    remindersService = app.get(RemindersService);

    // Mock sendMetaMessage to avoid live Meta Cloud rate-limiting during fast tests
    jest.spyOn(whatsappService, 'sendMetaMessage').mockResolvedValue(true as any);

    // Clean up test appointments
    await prisma.appointmentStatusHistory.deleteMany({
      where: { appointment: { salon: { slug: 'royal' } } },
    });
    await prisma.appointment.deleteMany({ where: { salon: { slug: 'royal' } } });

    testSalon = await prisma.salon.findFirst({
      where: { slug: 'royal' },
      include: { services: true, staff: true },
    });

    testStaff = testSalon.staff[0];
    testService = testSalon.services[0];

    testCustomer = await prisma.customer.upsert({
      where: { salonId_phone: { salonId: testSalon.id, phone: testCustomerPhone } },
      update: {},
      create: {
        salonId: testSalon.id,
        name: 'Late Rahul',
        phone: testCustomerPhone,
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. Stage 1 (T-2h Reminder): Dispatches 2-hour advance reminder & marks reminder2hSentAt', async () => {
    const tz = testSalon.timezone || 'Asia/Kolkata';
    const future2h = DateTime.now().setZone(tz).plus({ hours: 2 }).toJSDate();
    const future2hEnd = DateTime.now().setZone(tz).plus({ hours: 2, minutes: 30 }).toJSDate();

    const appt = await prisma.appointment.create({
      data: {
        appointmentNumber: `TST-${Date.now().toString().slice(-4)}`,
        salonId: testSalon.id,
        customerId: testCustomer.id,
        staffId: testStaff.id,
        serviceId: testService.id,
        date: future2h,
        startTime: future2h,
        endTime: future2hEnd,
        price: testService.price,
        status: 'CONFIRMED',
      },
    });

    const result = await remindersService.processReminders();
    expect(result.stage1).toBeGreaterThanOrEqual(1);

    const updated = await prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(updated?.reminder2hSentAt).toBeDefined();
    expect(updated?.reminder2hSentAt).not.toBeNull();
  });

  it('2. Stage 2 (T-10m Imminent Alert): Dispatches 10-minute alert & marks reminder10mSentAt', async () => {
    const tz = testSalon.timezone || 'Asia/Kolkata';
    const future10m = DateTime.now().setZone(tz).plus({ minutes: 8 }).toJSDate();
    const future10mEnd = DateTime.now().setZone(tz).plus({ minutes: 38 }).toJSDate();

    const appt = await prisma.appointment.create({
      data: {
        appointmentNumber: `TST-${Date.now().toString().slice(-4)}`,
        salonId: testSalon.id,
        customerId: testCustomer.id,
        staffId: testStaff.id,
        serviceId: testService.id,
        date: future10m,
        startTime: future10m,
        endTime: future10mEnd,
        price: testService.price,
        status: 'CONFIRMED',
      },
    });

    const result = await remindersService.processReminders();
    expect(result.stage2).toBeGreaterThanOrEqual(1);

    const updated = await prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(updated?.reminder10mSentAt).toBeDefined();
    expect(updated?.reminder10mSentAt).not.toBeNull();
  });

  it('3. Stage 3 (T+10m Late Follow-up): Dispatches late check if client has not checked in', async () => {
    const tz = testSalon.timezone || 'Asia/Kolkata';
    const past15m = DateTime.now().setZone(tz).minus({ minutes: 20 }).toJSDate();
    const past15mEnd = DateTime.now().setZone(tz).minus({ minutes: 5 }).toJSDate();

    const appt = await prisma.appointment.create({
      data: {
        appointmentNumber: `TST-${Date.now().toString().slice(-4)}`,
        salonId: testSalon.id,
        customerId: testCustomer.id,
        staffId: testStaff.id,
        serviceId: testService.id,
        date: past15m,
        startTime: past15m,
        endTime: past15mEnd,
        price: testService.price,
        status: 'CONFIRMED',
      },
    });

    const result = await remindersService.processReminders();
    expect(result.stage3).toBeGreaterThanOrEqual(1);

    const updated = await prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(updated?.lateFollowUpSentAt).toBeDefined();
    expect(updated?.lateFollowUpSentAt).not.toBeNull();

    // 4. Client taps "🚗 On My Way (10m)" button
    const res = await whatsappService.handleIncomingMessage(
      testSalon.id,
      testCustomerPhone,
      `late_on_way_${appt.id}`,
      `late_on_way_${appt.id}`,
    );

    expect(res.replyMessage).toContain('held your specialist');

    const withEta = await prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(withEta?.clientEtaStatus).toBe('ON_WAY_10M');
  });

  it('4. Idempotency Check: Running processReminders again must NOT send duplicate messages', async () => {
    const secondPass = await remindersService.processReminders();
    expect(secondPass.stage1).toBe(0);
    expect(secondPass.stage2).toBe(0);
    expect(secondPass.stage3).toBe(0);
  });
});
