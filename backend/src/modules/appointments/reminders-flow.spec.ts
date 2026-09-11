import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../database/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { RemindersService } from './reminders.service';
import { AppointmentsService } from './appointments.service';
import { AppointmentStatus, ClientEtaStatus } from '@prisma/client';
import { DateTime } from 'luxon';

describe('Smart WhatsApp Reminders & Smart Stale Button Handling (Flow Matrix Tests)', () => {
  let remindersService: RemindersService;
  let whatsAppService: WhatsAppService;
  let prisma: PrismaService;

  let testSalon: any;
  let testUser: any;
  let testSalonUser: any;
  let testStylist: any;
  let testService: any;
  const testCustomerPhone = '919999000099';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PrismaService,
        RemindersService,
        {
          provide: WhatsAppService,
          useValue: {
            sendMetaMessage: jest.fn().mockResolvedValue(true),
            findActiveUpcomingAppointments: jest.fn(),
            handleIncomingMessage: jest.fn(),
          },
        },
        {
          provide: AppointmentsService,
          useValue: {
            updateStatus: jest.fn().mockResolvedValue(true),
            triggerSmartMoveUpBroadcast: jest.fn().mockResolvedValue(true),
          },
        },
      ],
    }).compile();

    remindersService = moduleRef.get<RemindersService>(RemindersService);
    whatsAppService = moduleRef.get<WhatsAppService>(WhatsAppService);
    prisma = moduleRef.get<PrismaService>(PrismaService);

    // Find active salon with stylist and service
    testSalon = await prisma.salon.findFirst({
      where: { status: 'ACTIVE' },
      include: { services: true, stylists: true },
    });

    if (!testSalon) {
      return;
    }

    testStylist = testSalon.stylists?.[0];
    if (!testStylist) {
      testStylist = await prisma.stylist.create({
        data: {
          salonId: testSalon.id,
          name: 'Default Stylist',
          phone: '919999888877',
          status: 'ACTIVE',
        },
      });
    }

    testService = testSalon.services?.[0];
    if (!testService) {
      testService = await prisma.service.create({
        data: {
          salonId: testSalon.id,
          name: 'Classic Haircut',
          durationMinutes: 30,
          price: 450,
        },
      });
    }

    testUser = await prisma.user.upsert({
      where: { phone: testCustomerPhone },
      update: {},
      create: {
        phone: testCustomerPhone,
        name: 'Test Rahul',
      },
    });

    testSalonUser = await prisma.salonUser.upsert({
      where: { salonId_userId: { salonId: testSalon.id, userId: testUser.id } },
      update: { yearlyNoShowCount: 0, isBookingBlocked: false },
      create: {
        salonId: testSalon.id,
        userId: testUser.id,
        yearlyNoShowCount: 0,
      },
    });

    await prisma.appointment.deleteMany({
      where: { salonId: testSalon.id, salonUserId: testSalonUser.id },
    });
  });

  afterAll(async () => {
    if (testSalon && testSalonUser) {
      await prisma.appointment.deleteMany({
        where: { salonId: testSalon.id, salonUserId: testSalonUser.id },
      });
    }
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 1: Stage 1 (2-Hour Advance Reminder)
  // ---------------------------------------------------------------------------
  it('TC-REM-001: Stage 1 (2-Hour Reminder) - Sends 2h advance reminder & sets reminder2hSentAt', async () => {
    if (!testSalon) return;
    const tz = testSalon.timezone || 'Asia/Kolkata';
    const future2h = DateTime.now().setZone(tz).plus({ hours: 2 }).toJSDate();
    const future2hEnd = DateTime.now().setZone(tz).plus({ hours: 2, minutes: 30 }).toJSDate();
    const apptDate = DateTime.fromJSDate(future2h).startOf('day').toJSDate();

    const appt = await prisma.appointment.create({
      data: {
        appointmentNumber: `TST-${Date.now().toString().slice(-4)}`,
        salon: { connect: { id: testSalon.id } },
        salonUser: { connect: { id: testSalonUser.id } },
        stylist: { connect: { id: testStylist.id } },
        service: { connect: { id: testService.id } },
        serviceNameSnapshot: testService.name,
        durationMinutes: 30,
        appointmentDate: apptDate,
        startAt: future2h,
        endAt: future2hEnd,
        price: testService.price,
        status: AppointmentStatus.CONFIRMED,
      },
    });

    const result = await remindersService.processReminders();
    expect(result.stage1).toBeGreaterThanOrEqual(1);

    const updated = await prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(updated?.reminder2hSentAt).not.toBeNull();
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 2: Stage 2 (15-Min Arrival Alert with Penalty Warning)
  // ---------------------------------------------------------------------------
  it('TC-REM-002: Stage 2 (15-Min Arrival Alert) - Sends message with explicit auto-cancel & 1 penalty strike warning', async () => {
    if (!testSalon) return;
    const tz = testSalon.timezone || 'Asia/Kolkata';
    const future15m = DateTime.now().setZone(tz).plus({ minutes: 15 }).toJSDate();
    const future15mEnd = DateTime.now().setZone(tz).plus({ minutes: 45 }).toJSDate();
    const apptDate = DateTime.fromJSDate(future15m).startOf('day').toJSDate();

    const appt = await prisma.appointment.create({
      data: {
        appointmentNumber: `TST-${Date.now().toString().slice(-4)}`,
        salon: { connect: { id: testSalon.id } },
        salonUser: { connect: { id: testSalonUser.id } },
        stylist: { connect: { id: testStylist.id } },
        service: { connect: { id: testService.id } },
        serviceNameSnapshot: testService.name,
        durationMinutes: 30,
        appointmentDate: apptDate,
        startAt: future15m,
        endAt: future15mEnd,
        price: testService.price,
        status: AppointmentStatus.CONFIRMED,
      },
    });

    const sendMetaSpy = jest.spyOn(whatsAppService, 'sendMetaMessage');
    sendMetaSpy.mockClear();

    const result = await remindersService.processReminders();
    expect(result.stage2).toBeGreaterThanOrEqual(1);

    const updated = await prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(updated?.reminder10mSentAt).not.toBeNull();

    expect(sendMetaSpy).toHaveBeenCalled();
    const lastCallPayload = sendMetaSpy.mock.calls[sendMetaSpy.mock.calls.length - 1][1];
    expect(lastCallPayload.bodyText).toContain('auto-canceled');
    expect(lastCallPayload.bodyText).toContain('1 penalty strike');
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 3: Stage 4 (Auto-Cancellation Grace Period: 5 Minutes Post Slot Time)
  // ---------------------------------------------------------------------------
  it('TC-REM-003: Stage 4 (Auto-Cancel at +5 min) - Cancels booking & records penalty strike when no response', async () => {
    if (!testSalon) return;
    const tz = testSalon.timezone || 'Asia/Kolkata';
    // Slot started 6 minutes ago (exceeding 5-min grace cutoff)
    const past6m = DateTime.now().setZone(tz).minus({ minutes: 6 }).toJSDate();
    const past6mEnd = DateTime.now().setZone(tz).plus({ minutes: 24 }).toJSDate();
    const apptDate = DateTime.fromJSDate(past6m).startOf('day').toJSDate();

    const appt = await prisma.appointment.create({
      data: {
        appointmentNumber: `TST-${Date.now().toString().slice(-4)}`,
        salon: { connect: { id: testSalon.id } },
        salonUser: { connect: { id: testSalonUser.id } },
        stylist: { connect: { id: testStylist.id } },
        service: { connect: { id: testService.id } },
        serviceNameSnapshot: testService.name,
        durationMinutes: 30,
        appointmentDate: apptDate,
        startAt: past6m,
        endAt: past6mEnd,
        price: testService.price,
        status: AppointmentStatus.CONFIRMED,
        clientEtaStatus: null,
      },
    });

    const result = await remindersService.processReminders();
    expect(result.stage4).toBeGreaterThanOrEqual(1);

    const updatedAppt = await prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(updatedAppt?.status).toBe(AppointmentStatus.NO_SHOW);
    expect(updatedAppt?.notes).toContain('5-minute grace period');
  });
});
