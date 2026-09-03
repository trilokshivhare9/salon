import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { WhatsAppService } from '../src/modules/whatsapp/whatsapp.service';
import { AppointmentsService } from '../src/modules/appointments/appointments.service';
import { AppointmentStatus, BookingSource, DayOfWeek } from '@prisma/client';
import { DateTime } from 'luxon';
import { firstValueFrom } from 'rxjs';

describe('Real-Time Notifications & WhatsApp Outbound Alerts (E2E Tests)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let whatsappService: WhatsAppService;
  let appointmentsService: AppointmentsService;
  let testSalon: any;
  let testService: any;
  let testStaff: any;
  const client1Phone = '+919888111001';
  const client2Phone = '+919888111002';

  // Array to capture sent WhatsApp messages during tests
  const sentMessages: Array<{ to: string; body: string }> = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    whatsappService = app.get(WhatsAppService);
    appointmentsService = app.get(AppointmentsService);

    // Spy on sendMetaMessage to capture outbound messages
    jest.spyOn(whatsappService, 'sendMetaMessage').mockImplementation(async (to: string, payload: any): Promise<void> => {
      sentMessages.push({ to, body: payload.bodyText || '' });
    });

    // Cleanup test data
    await prisma.conversation.deleteMany({ where: { customerPhone: { in: [client1Phone, client2Phone] } } });
    await prisma.appointmentStatusHistory.deleteMany({
      where: { appointment: { customer: { phone: { in: [client1Phone, client2Phone] } } } },
    });
    await prisma.appointment.deleteMany({
      where: { customer: { phone: { in: [client1Phone, client2Phone] } } },
    });
    await prisma.customer.deleteMany({
      where: { phone: { in: [client1Phone, client2Phone] } },
    });

    // Ensure test salon
    testSalon = await prisma.salon.findFirst({
      where: { slug: 'royal' },
      include: { services: true, staff: { include: { services: true } } },
    });

    if (!testSalon) {
      testSalon = await prisma.salon.create({
        data: {
          name: 'Royal Barber Studio',
          slug: 'royal',
          email: 'royal@test.com',
          phone: '+917999817743',
          status: 'ACTIVE',
          address: '45 MG Road, Bangalore',
        },
        include: { services: true, staff: { include: { services: true } } },
      });
    }

    testService = testSalon.services[0];
    if (!testService) {
      testService = await prisma.service.create({
        data: {
          salonId: testSalon.id,
          name: 'Royal Signature Haircut',
          price: 150,
          durationMinutes: 30,
          category: 'Hair Care',
          status: 'ACTIVE',
        },
      });
    }

    testStaff = testSalon.staff[0];
    if (!testStaff) {
      testStaff = await prisma.staff.create({
        data: {
          salonId: testSalon.id,
          name: 'Sameer',
          phone: '+919999999999',
          status: 'ACTIVE',
        },
      });

      const days: DayOfWeek[] = [
        DayOfWeek.MONDAY,
        DayOfWeek.TUESDAY,
        DayOfWeek.WEDNESDAY,
        DayOfWeek.THURSDAY,
        DayOfWeek.FRIDAY,
        DayOfWeek.SATURDAY,
        DayOfWeek.SUNDAY,
      ];
      for (const day of days) {
        await prisma.staffWorkingHours.create({
          data: {
            staffId: testStaff.id,
            dayOfWeek: day,
            startTime: '09:00',
            endTime: '21:00',
            isWorking: true,
          },
        });
      }
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    sentMessages.length = 0;
  });

  it('1. Should emit NEW_BOOKING event on real-time stream when booking is created', async () => {
    const tomorrow = DateTime.now().plus({ days: 1 }).toISODate();

    // Subscribe to salon SSE stream
    const eventPromise = firstValueFrom(appointmentsService.getSalonEvents(testSalon.id));

    const appt = await appointmentsService.createAppointment(testSalon.id, {
      serviceId: testService.id,
      staffId: testStaff.id,
      date: tomorrow,
      startTime: '10:00',
      customerName: 'Test Client 1',
      customerPhone: client1Phone,
      source: BookingSource.WEB,
    });

    expect(appt).toBeDefined();
    expect(appt.customer.phone).toBe(client1Phone);

    const emittedEvent = await eventPromise;
    expect(emittedEvent.type).toBe('NEW_BOOKING');
    expect(emittedEvent.salonId).toBe(testSalon.id);
    expect(emittedEvent.data.id).toBe(appt.id);
  });

  it('2. Should send Outbound WhatsApp alert to customer when Admin Cancels booking', async () => {
    const tomorrow = DateTime.now().plus({ days: 1 }).toISODate();
    const appt = await appointmentsService.createAppointment(testSalon.id, {
      serviceId: testService.id,
      staffId: testStaff.id,
      date: tomorrow,
      startTime: '11:00',
      customerName: 'Test Client 1',
      customerPhone: client1Phone,
      source: BookingSource.WEB,
    });

    sentMessages.length = 0;

    // Admin cancels
    await appointmentsService.updateStatus(testSalon.id, appt.id, {
      status: AppointmentStatus.CANCELLED,
      reason: 'Specialist emergency',
    });

    expect(sentMessages.length).toBeGreaterThanOrEqual(1);
    const cancelMsg = sentMessages.find((m) => m.to === client1Phone);
    expect(cancelMsg).toBeDefined();
    expect(cancelMsg.body).toContain('APPOINTMENT CANCELLED');
    expect(cancelMsg.body).toContain(testSalon.name);
  });

  it('3. Should send Outbound WhatsApp alert to customer when Admin Reschedules booking', async () => {
    const tomorrow = DateTime.now().plus({ days: 1 }).toISODate();
    const dayAfter = DateTime.now().plus({ days: 2 }).toISODate();

    const appt = await appointmentsService.createAppointment(testSalon.id, {
      serviceId: testService.id,
      staffId: testStaff.id,
      date: tomorrow,
      startTime: '12:00',
      customerName: 'Test Client 1',
      customerPhone: client1Phone,
      source: BookingSource.WEB,
    });

    sentMessages.length = 0;

    // Admin reschedules
    const reschedAppt = await appointmentsService.rescheduleAppointment(testSalon.id, appt.id, {
      newDate: dayAfter,
      newStartTime: '15:00',
      staffId: testStaff.id,
    });

    expect(reschedAppt).toBeDefined();
    expect(sentMessages.length).toBeGreaterThanOrEqual(1);
    const reschedMsg = sentMessages.find((m) => m.to === client1Phone);
    expect(reschedMsg).toBeDefined();
    expect(reschedMsg.body).toContain('APPOINTMENT RESCHEDULED');
    expect(reschedMsg.body).toContain('03:00 PM');
  });

  it('4. Should trigger automated "Chair Ready" WhatsApp call-up to next client when previous service completes', async () => {
    const today = DateTime.now().toISODate();

    await prisma.appointment.deleteMany({
      where: {
        staffId: testStaff.id,
      },
    });


    // 1st Appointment: Currently IN_SERVICE (Started 40 mins ago, finishes now)
    const appt1 = await prisma.appointment.create({

      data: {
        salonId: testSalon.id,
        customerId: (await prisma.customer.findFirst({ where: { phone: client1Phone } }))!.id,
        staffId: testStaff.id,
        serviceId: testService.id,
        appointmentNumber: 'SAL-TEST-01',
        date: new Date(today),
        startTime: new Date(Date.now() - 40 * 60 * 1000),
        endTime: new Date(Date.now() - 5 * 60 * 1000),
        price: 150,
        status: AppointmentStatus.IN_SERVICE,
        source: BookingSource.WEB,
      },
    });

    // 2nd Appointment: Next in line (CONFIRMED starting in 5 mins)
    const customer2 = await prisma.customer.upsert({
      where: { salonId_phone: { salonId: testSalon.id, phone: client2Phone } },
      update: {},
      create: { salonId: testSalon.id, phone: client2Phone, name: 'Next VIP Client' },
    });

    const appt2 = await prisma.appointment.create({
      data: {
        salonId: testSalon.id,
        customerId: customer2.id,
        staffId: testStaff.id,
        serviceId: testService.id,
        appointmentNumber: 'SAL-TEST-02',
        date: new Date(today),
        startTime: new Date(Date.now() + 5 * 60 * 1000), // In 5 mins
        endTime: new Date(Date.now() + 35 * 60 * 1000),
        price: 150,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WEB,
      },
    });

    sentMessages.length = 0;

    // Operator marks 1st appointment as COMPLETED
    await appointmentsService.updateStatus(testSalon.id, appt1.id, {
      status: AppointmentStatus.COMPLETED,
    });

    // Wait 100ms for async call-up trigger
    await new Promise((r) => setTimeout(r, 200));

    // Client 2 should receive the "Chair Ready" message!
    const callupMsg = sentMessages.find((m) => m.to === client2Phone);
    expect(callupMsg).toBeDefined();
    expect(callupMsg.body).toContain('YOUR CHAIR IS READY');
    expect(callupMsg.body).toContain(testStaff.name);
  });
});
