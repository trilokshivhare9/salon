import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AdminRole, DayOfWeek, AppointmentStatus, ConversationState } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { DateTime } from 'luxon';

describe('🔥 BRUTAL CUSTOMER BOOKING: Multi-Way Barber Booking, Concurrency & WhatsApp Replies', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let superAdminToken: string;
  let salonOwnerToken: string;
  let salon: any;
  let barberBob: any;
  let barberAlice: any;
  let serviceHaircut: any;
  let serviceBeard: any;

  // Booking test date: 3 days in advance in salon timezone
  const bookingDate = DateTime.now().setZone('Asia/Kolkata').plus({ days: 3 }).toISODate()!;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    prisma = app.get<PrismaService>(PrismaService);

    // 1. Setup Super Admin
    const passwordHash = await bcrypt.hash('Password123!', 10);
    await prisma.admin.upsert({
      where: { email: 'brutal-superadmin@salonsaas.com' },
      update: {},
      create: {
        email: 'brutal-superadmin@salonsaas.com',
        name: 'Brutal Super Admin',
        passwordHash,
        role: AdminRole.SUPER_ADMIN,
      },
    });

    const superRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'brutal-superadmin@salonsaas.com', password: 'Password123!' })
      .expect(200);
    superAdminToken = superRes.body.accessToken;

    // 2. Create Salon
    const ownerEmail = `brutal-owner-${Date.now()}@test.com`;
    const salonRes = await request(app.getHttpServer())
      .post('/api/v1/salons/platform/create')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        name: 'The Gentleman Barber Club',
        city: 'Mumbai',
        phone: '9555555551',
        ownerName: 'Barber Boss',
        email: ownerEmail,
        password: 'Password123!',
        openTime: '09:00',
        closeTime: '21:00',
      })
      .expect(201);
    salon = salonRes.body;

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password: 'Password123!' })
      .expect(200);
    salonOwnerToken = loginRes.body.accessToken;

    // 3. Create Services
    const s1Res = await request(app.getHttpServer())
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${salonOwnerToken}`)
      .send({
        name: 'Classic Haircut',
        durationMinutes: 30,
        price: 450,
      })
      .expect(201);
    serviceHaircut = s1Res.body;

    const s2Res = await request(app.getHttpServer())
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${salonOwnerToken}`)
      .send({
        name: 'Royal Beard Sculpting',
        durationMinutes: 30,
        price: 350,
      })
      .expect(201);
    serviceBeard = s2Res.body;

    // 4. Create Barbers
    // Barber Bob: assigned to Haircut & Beard
    const b1Res = await request(app.getHttpServer())
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${salonOwnerToken}`)
      .send({
        name: 'Barber Bob',
        phone: '+919555555591',
        followsSalonSchedule: true,
        serviceIds: [serviceHaircut.id, serviceBeard.id],
      })
      .expect(201);
    barberBob = b1Res.body;

    // Barber Alice: assigned to Haircut only
    const b2Res = await request(app.getHttpServer())
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${salonOwnerToken}`)
      .send({
        name: 'Barber Alice',
        phone: '+919555555592',
        followsSalonSchedule: true,
        serviceIds: [serviceHaircut.id],
      })
      .expect(201);
    barberAlice = b2Res.body;
  });

  afterAll(async () => {
    try {
      if (salon?.id) {
        await prisma.appointment.deleteMany({ where: { salonId: salon.id } });
        await prisma.whatsAppLog.deleteMany({ where: { salonId: salon.id } });
        await prisma.conversation.deleteMany({ where: { salonId: salon.id } });
        await prisma.stylistService.deleteMany({
          where: { stylist: { salonId: salon.id } },
        });
        await prisma.stylist.deleteMany({ where: { salonId: salon.id } });
        await prisma.service.deleteMany({ where: { salonId: salon.id } });
        await prisma.salonWorkingHours.deleteMany({ where: { salonId: salon.id } });
        await prisma.salonUser.deleteMany({ where: { salonId: salon.id } });
        await prisma.admin.deleteMany({ where: { salonId: salon.id } });
        await prisma.salon.deleteMany({ where: { id: salon.id } });
      }
      await prisma.admin.deleteMany({ where: { email: 'brutal-superadmin@salonsaas.com' } });
    } catch (e) {
      // Best-effort cleanup
    }
    await app.close();
  });

  // ===========================================================================
  // 1. MULTI-WAY BARBER BOOKING & WHATSAPP BOT CONVERSATION REPLIES
  // ===========================================================================
  describe('1. Multi-Way Barber Booking & WhatsApp Reply Flow', () => {
    const customer1Phone = '+919511111111';

    it('Way 1: WhatsApp Bot Booking with Specific Barber (Verifying Every Single Reply)', async () => {
      // Step 1: User says "Hi"
      const r1 = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/simulate')
        .send({
          salonSlug: salon.slug,
          customerPhone: customer1Phone,
          messageText: 'Hi',
        })
        .expect(201);

      expect(r1.body.state).toBe(ConversationState.START);
      expect(r1.body.replyMessage).toContain(salon.name);
      expect(r1.body.replyMessage).toContain('Welcome');

      // Verify User and SalonUser were auto-created upon initial greeting
      const user = await prisma.user.findUnique({ where: { phone: customer1Phone } });
      expect(user).toBeDefined();
      expect(user!.name).toBeNull(); // Missing customer info remains null

      // Step 2: User taps "📅 Book Slot" (btn_book)
      const r2 = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/simulate')
        .send({
          salonSlug: salon.slug,
          customerPhone: customer1Phone,
          messageText: 'Book',
          interactiveId: 'btn_book',
        })
        .expect(201);

      expect(r2.body.state).toBe(ConversationState.SELECT_SERVICE);
      expect(r2.body.replyMessage).toContain('Select a Service');
      expect(r2.body.metadata?.services.length).toBe(2);

      // Step 3: User chooses "Classic Haircut"
      const r3 = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/simulate')
        .send({
          salonSlug: salon.slug,
          customerPhone: customer1Phone,
          messageText: 'Classic Haircut',
          interactiveId: `svc_${serviceHaircut.id}`,
        })
        .expect(201);

      expect(r3.body.state).toBe(ConversationState.SELECT_STAFF);
      expect(r3.body.replyMessage).toMatch(/specialist/i);
      // Both Bob and Alice are qualified for Haircut
      expect(r3.body.metadata?.qualifiedStaff.length).toBe(2);

      // Step 4: User selects Barber Bob specifically
      const r4 = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/simulate')
        .send({
          salonSlug: salon.slug,
          customerPhone: customer1Phone,
          messageText: 'Barber Bob',
          interactiveId: `staff_${barberBob.id}`,
        })
        .expect(201);

      expect(r4.body.state).toBe(ConversationState.SELECT_DATE);
      expect(r4.body.replyMessage).toContain('Barber Bob');
      expect(r4.body.replyMessage).toContain('Select Date');

      // Step 5: User selects specific booking date
      const r5 = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/simulate')
        .send({
          salonSlug: salon.slug,
          customerPhone: customer1Phone,
          messageText: bookingDate,
        })
        .expect(201);

      expect(r5.body.state).toBe(ConversationState.SELECT_TIME);
      expect(r5.body.replyMessage).toMatch(/time slot|slots all day|available slots/i);
      expect(r5.body.metadata?.slots.length).toBeGreaterThan(0);

      // Step 6: User selects slot 10:00 AM
      const r6 = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/simulate')
        .send({
          salonSlug: salon.slug,
          customerPhone: customer1Phone,
          messageText: '10:00 AM',
          interactiveId: 'slot_10:00',
        })
        .expect(201);

      expect(r6.body.state).toBe(ConversationState.COLLECT_NAME);
      expect(r6.body.replyMessage).toContain('Full Name');

      // Step 7: User provides their Name: "Rohan Verma"
      const r7 = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/simulate')
        .send({
          salonSlug: salon.slug,
          customerPhone: customer1Phone,
          messageText: 'Rohan Verma',
        })
        .expect(201);

      expect(r7.body.state).toBe(ConversationState.CONFIRMATION);
      expect(r7.body.replyMessage).toContain('Please Confirm Your Appointment:');
      expect(r7.body.replyMessage).toContain('The Gentleman Barber Club');
      expect(r7.body.replyMessage).toContain('Classic Haircut');
      expect(r7.body.replyMessage).toContain('Barber Bob');
      expect(r7.body.replyMessage).toContain('₹450');
      expect(r7.body.replyMessage).toContain('Rohan Verma');

      // Step 8: User confirms booking
      const r8 = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/simulate')
        .send({
          salonSlug: salon.slug,
          customerPhone: customer1Phone,
          messageText: 'Confirm',
          interactiveId: 'btn_confirm_yes',
        })
        .expect(201);

      expect(r8.body.state).toBe(ConversationState.COMPLETED);
      expect(r8.body.replyMessage).toContain('APPOINTMENT CONFIRMED!');
      expect(r8.body.replyMessage).toContain('Booking ID:');
      expect(r8.body.metadata?.appointment.appointmentNumber).toMatch(/^SAL-\d+/);

      // Verify Appointment in Database
      const dbAppt = await prisma.appointment.findUnique({
        where: { id: r8.body.metadata.appointment.id },
      });
      expect(dbAppt).toBeDefined();
      expect(dbAppt!.stylistId).toBe(barberBob.id);
      expect(dbAppt!.serviceNameSnapshot).toBe('Classic Haircut');
      expect(Number(dbAppt!.price)).toBe(450);
      expect(dbAppt!.durationMinutes).toBe(30);
    }, 30000);

    it('Way 2: WhatsApp Bot Booking with "Any Specialist" (Auto-Assignment)', async () => {
      const customer2Phone = '+919522222222';

      // Start & Advance to Staff selection
      await request(app.getHttpServer())
        .post('/api/v1/whatsapp/simulate')
        .send({ salonSlug: salon.slug, customerPhone: customer2Phone, messageText: 'Hi' });

      await request(app.getHttpServer())
        .post('/api/v1/whatsapp/simulate')
        .send({ salonSlug: salon.slug, customerPhone: customer2Phone, messageText: 'Book', interactiveId: 'btn_book' });

      await request(app.getHttpServer())
        .post('/api/v1/whatsapp/simulate')
        .send({ salonSlug: salon.slug, customerPhone: customer2Phone, messageText: '1', interactiveId: `svc_${serviceHaircut.id}` });

      // User selects "Any Specialist"
      const staffRes = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/simulate')
        .send({
          salonSlug: salon.slug,
          customerPhone: customer2Phone,
          messageText: 'Any Specialist',
          interactiveId: 'staff_any',
        })
        .expect(201);

      expect(staffRes.body.state).toBe(ConversationState.SELECT_DATE);
      expect(staffRes.body.replyMessage).toContain('Any Specialist');

      // Select Date
      await request(app.getHttpServer())
        .post('/api/v1/whatsapp/simulate')
        .send({ salonSlug: salon.slug, customerPhone: customer2Phone, messageText: bookingDate });

      // Select slot 10:00 (Bob is already booked at 10:00, Alice is FREE!)
      await request(app.getHttpServer())
        .post('/api/v1/whatsapp/simulate')
        .send({ salonSlug: salon.slug, customerPhone: customer2Phone, messageText: '10:00 AM', interactiveId: 'slot_10:00' });

      // Enter name
      await request(app.getHttpServer())
        .post('/api/v1/whatsapp/simulate')
        .send({ salonSlug: salon.slug, customerPhone: customer2Phone, messageText: 'Karan Mehra' });

      // Confirm
      const confirmRes = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/simulate')
        .send({ salonSlug: salon.slug, customerPhone: customer2Phone, messageText: 'Confirm', interactiveId: 'btn_confirm_yes' })
        .expect(201);

      expect(confirmRes.body.state).toBe(ConversationState.COMPLETED);
      // Alice was automatically assigned because Bob was already booked!
      expect(confirmRes.body.metadata?.appointment.stylistId).toBe(barberAlice.id);
      expect(confirmRes.body.replyMessage).toContain('Barber Alice');
    }, 30000);

    it('Way 3: Web Public Booking with Specific Barber', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/booking/${salon.slug}/appointments`)
        .send({
          serviceId: serviceBeard.id,
          stylistId: barberBob.id,
          date: bookingDate,
          startTime: '11:00',
          customerName: 'Aarav Patel',
          customerPhone: '+919533333333',
        })
        .expect(201);

      expect(res.body.appointmentNumber).toBeDefined();
      expect(res.body.stylistName).toBe('Barber Bob');
      expect(res.body.serviceName).toBe('Royal Beard Sculpting');
    });

    it('Way 4: Web Public Booking with "Any Barber" (Automatic Load Balancing)', async () => {
      // At 11:30, both Bob and Alice are free. Bob has 2 bookings today, Alice has 1 booking today.
      // Auto-assignment must pick Alice (the least loaded barber)!
      const res = await request(app.getHttpServer())
        .post(`/api/v1/booking/${salon.slug}/appointments`)
        .send({
          serviceId: serviceHaircut.id,
          date: bookingDate,
          startTime: '11:30',
          customerName: 'Least Loaded Test',
          customerPhone: '+919544444444',
        })
        .expect(201);

      expect(res.body.appointmentNumber).toBeDefined();
      expect(res.body.stylistName).toBe('Barber Alice'); // Alice had fewer bookings!
    });
  });

  // ===========================================================================
  // 2. BRUTAL CONCURRENCY & RACE CONDITIONS (SAME TIME, SAME BARBER)
  // ===========================================================================
  describe('2. Brutal Concurrency & Race Conditions on Same Barber', () => {
    it('should handle CONCURRENT COLLISION on WhatsApp bot: Winner gets confirmed, Loser receives friendly conflict reply', async () => {
      const userA = '+919566666661';
      const userB = '+919566666662';
      const collisionSlot = '15:00';

      // Advance User A to CONFIRMATION for Bob at 15:00
      await request(app.getHttpServer()).post('/api/v1/whatsapp/simulate').send({ salonSlug: salon.slug, customerPhone: userA, messageText: 'Hi' });
      await request(app.getHttpServer()).post('/api/v1/whatsapp/simulate').send({ salonSlug: salon.slug, customerPhone: userA, messageText: 'Book', interactiveId: 'btn_book' });
      await request(app.getHttpServer()).post('/api/v1/whatsapp/simulate').send({ salonSlug: salon.slug, customerPhone: userA, messageText: '1', interactiveId: `svc_${serviceHaircut.id}` });
      await request(app.getHttpServer()).post('/api/v1/whatsapp/simulate').send({ salonSlug: salon.slug, customerPhone: userA, messageText: 'Bob', interactiveId: `staff_${barberBob.id}` });
      await request(app.getHttpServer()).post('/api/v1/whatsapp/simulate').send({ salonSlug: salon.slug, customerPhone: userA, messageText: bookingDate });
      await request(app.getHttpServer()).post('/api/v1/whatsapp/simulate').send({ salonSlug: salon.slug, customerPhone: userA, messageText: '3 PM', interactiveId: `slot_${collisionSlot}` });
      await request(app.getHttpServer()).post('/api/v1/whatsapp/simulate').send({ salonSlug: salon.slug, customerPhone: userA, messageText: 'User Alpha' });

      // Advance User B to CONFIRMATION for Bob at 15:00
      await request(app.getHttpServer()).post('/api/v1/whatsapp/simulate').send({ salonSlug: salon.slug, customerPhone: userB, messageText: 'Hi' });
      await request(app.getHttpServer()).post('/api/v1/whatsapp/simulate').send({ salonSlug: salon.slug, customerPhone: userB, messageText: 'Book', interactiveId: 'btn_book' });
      await request(app.getHttpServer()).post('/api/v1/whatsapp/simulate').send({ salonSlug: salon.slug, customerPhone: userB, messageText: '1', interactiveId: `svc_${serviceHaircut.id}` });
      await request(app.getHttpServer()).post('/api/v1/whatsapp/simulate').send({ salonSlug: salon.slug, customerPhone: userB, messageText: 'Bob', interactiveId: `staff_${barberBob.id}` });
      await request(app.getHttpServer()).post('/api/v1/whatsapp/simulate').send({ salonSlug: salon.slug, customerPhone: userB, messageText: bookingDate });
      await request(app.getHttpServer()).post('/api/v1/whatsapp/simulate').send({ salonSlug: salon.slug, customerPhone: userB, messageText: '3 PM', interactiveId: `slot_${collisionSlot}` });
      await request(app.getHttpServer()).post('/api/v1/whatsapp/simulate').send({ salonSlug: salon.slug, customerPhone: userB, messageText: 'User Beta' });

      // SIMULTANEOUS CONFIRMATION: Both click "Confirm Booking" at the exact same moment!
      const [resA, resB] = await Promise.all([
        request(app.getHttpServer())
          .post('/api/v1/whatsapp/simulate')
          .send({ salonSlug: salon.slug, customerPhone: userA, messageText: 'Confirm', interactiveId: 'btn_confirm_yes' }),
        request(app.getHttpServer())
          .post('/api/v1/whatsapp/simulate')
          .send({ salonSlug: salon.slug, customerPhone: userB, messageText: 'Confirm', interactiveId: 'btn_confirm_yes' }),
      ]);

      const responses = [resA.body, resB.body];
      const winner = responses.find((r) => r.state === ConversationState.COMPLETED);
      const loser = responses.find((r) => r.state !== ConversationState.COMPLETED);

      // Exactly ONE winner
      expect(winner).toBeDefined();
      expect(winner.replyMessage).toContain('APPOINTMENT CONFIRMED!');

      // Exactly ONE loser who received a polite collision message
      expect(loser).toBeDefined();
      expect(loser.replyMessage).toMatch(/⚠️.*(no longer available|another slot|just taken)/i);
      expect(loser.state).toBe(ConversationState.START);

      // Verify in DB: Exactly 1 appointment was created at 15:00 on Barber Bob
      const dbAppts = await prisma.appointment.findMany({
        where: {
          salonId: salon.id,
          stylistId: barberBob.id,
          appointmentDate: new Date(bookingDate),
          status: { notIn: ['CANCELLED', 'NO_SHOW', 'RESCHEDULED'] },
        },
      });
      const at1500 = dbAppts.filter((a) => {
        const h = DateTime.fromJSDate(a.startAt, { zone: 'Asia/Kolkata' }).hour;
        const m = DateTime.fromJSDate(a.startAt, { zone: 'Asia/Kolkata' }).minute;
        return h === 15 && m === 0;
      });
      expect(at1500.length).toBe(1);
    }, 30000);

    it('should support back-to-back bookings on the same barber without collision', async () => {
      // Barber Bob booked 16:00 -> 16:30.
      const res1 = await request(app.getHttpServer())
        .post(`/api/v1/booking/${salon.slug}/appointments`)
        .send({
          serviceId: serviceHaircut.id,
          stylistId: barberBob.id,
          date: bookingDate,
          startTime: '16:00',
          customerName: 'BackToBack User 1',
          customerPhone: '+919577777771',
        })
        .expect(201);

      // Next user immediately books 16:30 -> 17:00 on Barber Bob. Must succeed!
      const res2 = await request(app.getHttpServer())
        .post(`/api/v1/booking/${salon.slug}/appointments`)
        .send({
          serviceId: serviceHaircut.id,
          stylistId: barberBob.id,
          date: bookingDate,
          startTime: '16:30',
          customerName: 'BackToBack User 2',
          customerPhone: '+919577777772',
        })
        .expect(201);

      expect(res1.body.appointmentNumber).toBeDefined();
      expect(res2.body.appointmentNumber).toBeDefined();
    });

    it('should REJECT overlapping booking attempt on the same barber', async () => {
      // Bob is booked 16:00 -> 16:30. Attempting to book 16:15 must fail with 409!
      const res = await request(app.getHttpServer())
        .post(`/api/v1/booking/${salon.slug}/appointments`)
        .send({
          serviceId: serviceHaircut.id,
          stylistId: barberBob.id,
          date: bookingDate,
          startTime: '16:15', // OVERLAPPING WITH 16:00 - 16:30
          customerName: 'Overlap Attempter',
          customerPhone: '+919577777773',
        })
        .expect(409);

      expect(res.body.message).toMatch(/no longer available|choose another slot/i);
    });
  });

  // ===========================================================================
  // 3. WHATSAPP BOT REPLIES, RESCHEDULING, CANCELLATION & EDGE CASES
  // ===========================================================================
  describe('3. WhatsApp Reply Accuracy, Edge Cases & Active Booking Hub', () => {
    it('should present Active Booking Hub when customer with upcoming appointment sends "Hi"', async () => {
      const returningCustomerPhone = '+919511111111'; // Rohan Verma, who booked earlier

      const res = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/simulate')
        .send({
          salonSlug: salon.slug,
          customerPhone: returningCustomerPhone,
          messageText: 'Hi',
        })
        .expect(201);

      expect(res.body.state).toBe(ConversationState.ACTIVE_HUB);
      expect(res.body.replyMessage).toContain('Welcome back, *Rohan Verma*!');
      expect(res.body.replyMessage).toContain('Your Upcoming Appointment:');
      expect(res.body.replyMessage).toContain('Classic Haircut');
      expect(res.body.replyMessage).toContain('What would you like to do?');
    });

    it('should handle cancel appointment via WhatsApp and immediately free the slot', async () => {
      const cancellingCustomerPhone = '+919511111111';

      // 1. Customer taps "✕ Cancel Slot" (btn_cancel_appt)
      const res1 = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/simulate')
        .send({
          salonSlug: salon.slug,
          customerPhone: cancellingCustomerPhone,
          messageText: 'Cancel',
          interactiveId: 'btn_cancel_appt',
        })
        .expect(201);

      expect(res1.body.state).toBe(ConversationState.CONFIRM_CANCEL);
      expect(res1.body.replyMessage).toContain('Are you sure');

      // 2. Customer confirms cancellation
      const res2 = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/simulate')
        .send({
          salonSlug: salon.slug,
          customerPhone: cancellingCustomerPhone,
          messageText: 'Yes',
          interactiveId: 'btn_cancel_yes',
        })
        .expect(201);

      expect(res2.body.state).toBe(ConversationState.START);
      expect(res2.body.replyMessage).toContain('Cancelled');

      // Verify slot 10:00 on Bob is immediately available again!
      const avail = await request(app.getHttpServer())
        .get(`/api/v1/booking/${salon.slug}/availability`)
        .query({ serviceId: serviceHaircut.id, date: bookingDate, stylistId: barberBob.id })
        .expect(200);

      const slots = avail.body.availableSlots.map((s: any) => s.startTime);
      expect(slots).toContain('10:00'); // Immediately released!
    });

    it('should handle unexpected / invalid inputs gracefully at any state without crashing', async () => {
      const phone = '+919588888888';

      // 1. Send invalid command at START
      const r1 = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/simulate')
        .send({ salonSlug: salon.slug, customerPhone: phone, messageText: 'asdfghjkl123' })
        .expect(201);

      expect(r1.body.state).toBe(ConversationState.START);
      expect(r1.body.replyMessage).toMatch(/Please tap Book Slot|Welcome/i);

      // 2. Advance to SELECT_SERVICE and send gibberish
      await request(app.getHttpServer())
        .post('/api/v1/whatsapp/simulate')
        .send({ salonSlug: salon.slug, customerPhone: phone, messageText: 'Book', interactiveId: 'btn_book' });

      const r2 = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/simulate')
        .send({ salonSlug: salon.slug, customerPhone: phone, messageText: 'flying_carpet_treatment' })
        .expect(201);

      expect(r2.body.state).toBe(ConversationState.SELECT_SERVICE);
      expect(r2.body.replyMessage).toContain('Please select a service');

      // 3. Reset cleanly by typing "menu"
      const r3 = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/simulate')
        .send({ salonSlug: salon.slug, customerPhone: phone, messageText: 'menu' })
        .expect(201);

      expect(r3.body.state).toBe(ConversationState.START);
      expect(r3.body.replyMessage).toContain('How can we help you today?');
    });
  });
});
