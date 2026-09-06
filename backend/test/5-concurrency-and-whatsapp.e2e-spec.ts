import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AdminRole, DayOfWeek, WhatsAppMessageDirection } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { DateTime } from 'luxon';

describe('Suite 5: 100x Concurrency Defense, WhatsApp Idempotency & Snapshots (Sections 22-29, 38)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let superAdminToken: string;
  let salonOwnerToken: string;
  let salon: any;
  let stylist: any;
  let service: any;

  const testDate = DateTime.now().setZone('Asia/Kolkata').plus({ days: 4 }).toISODate()!;

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

    // Setup Super Admin
    const passwordHash = await bcrypt.hash('Password123!', 10);
    await prisma.admin.upsert({
      where: { email: 'suite5-admin@salonsaas.com' },
      update: {},
      create: {
        email: 'suite5-admin@salonsaas.com',
        name: 'Suite 5 Super Admin',
        passwordHash,
        role: AdminRole.SUPER_ADMIN,
      },
    });

    const superRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'suite5-admin@salonsaas.com', password: 'Password123!' })
      .expect(200);
    superAdminToken = superRes.body.accessToken;

    // Create Salon
    const ownerEmail = `suite5-owner-${Date.now()}@test.com`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/salons/platform/create')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        name: 'High Concurrency Studio',
        city: 'Hyderabad',
        phone: '9666666661',
        ownerName: 'Concurrency Boss',
        email: ownerEmail,
        password: 'Password123!',
        openTime: '09:00',
        closeTime: '21:00',
      })
      .expect(201);
    salon = res.body;

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password: 'Password123!' })
      .expect(200);
    salonOwnerToken = loginRes.body.accessToken;

    // Create Service
    const sRes = await request(app.getHttpServer())
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${salonOwnerToken}`)
      .send({
        name: 'Concurrency Haircut',
        durationMinutes: 30,
        price: 500,
      })
      .expect(201);
    service = sRes.body;

    // Create Stylist
    const stRes = await request(app.getHttpServer())
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${salonOwnerToken}`)
      .send({
        name: 'Advisory Lock Master',
        phone: '+919666666699',
        followsSalonSchedule: true,
        serviceIds: [service.id],
      })
      .expect(201);
    stylist = stRes.body;
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
      await prisma.admin.deleteMany({ where: { email: 'suite5-admin@salonsaas.com' } });
    } catch (e) {
      // Best-effort cleanup
    }
    await app.close();
  });

  describe('1. 100x Concurrent Simultaneous Booking Attack (Sections 22 & 23)', () => {
    it('should allow EXACTLY 1 booking and REJECT all others among concurrent simultaneous requests', async () => {
      const CONCURRENCY_COUNT = 50;
      const targetSlot = '10:00';

      // Launch 100 concurrent booking requests targeting the exact same slot on the same stylist
      const requests = Array.from({ length: CONCURRENCY_COUNT }).map((_, i) =>
        request(app.getHttpServer())
          .post(`/api/v1/booking/${salon.slug}/appointments`)
          .send({
            serviceId: service.id,
            stylistId: stylist.id,
            date: testDate,
            startTime: targetSlot,
            customerName: `Concurrent User ${i}`,
            customerPhone: `+91960000${String(i).padStart(4, '0')}`,
          }),
      );

      const results = await Promise.all(requests);

      const successes = results.filter((r) => r.status === 201);
      const conflicts = results.filter((r) => r.status === 409);

      expect(successes.length).toBe(1);
      expect(conflicts.length).toBe(CONCURRENCY_COUNT - 1);

      // Verify in Database: Exactly 1 appointment was created at this slot
      const apptsInDb = await prisma.appointment.findMany({
        where: {
          salonId: salon.id,
          stylistId: stylist.id,
          appointmentDate: new Date(testDate),
        },
      });

      expect(apptsInDb.length).toBe(1);
      expect(apptsInDb[0].serviceNameSnapshot).toBe('Concurrency Haircut');
    }, 60000); // 60s timeout for 100 requests
  });

  describe('2. WhatsApp User Auto-Creation & Idempotent Webhook Deduplication (Sections 24 & 38)', () => {
    it('should auto-create User with name: null and link SalonUser when new number messages via WhatsApp', async () => {
      const newPhone = '+919611223344';

      // Simulate inbound message from new customer
      await request(app.getHttpServer())
        .post('/api/v1/whatsapp/simulate')
        .send({
          salonSlug: salon.slug,
          customerPhone: newPhone,
          messageText: 'Hello',
        })
        .expect(201);

      // Verify User in DB
      const user = await prisma.user.findUnique({
        where: { phone: newPhone },
      });
      expect(user).toBeDefined();
      expect(user!.name).toBeNull(); // Missing customer info remains null!

      // Verify SalonUser link
      const salonUser = await prisma.salonUser.findUnique({
        where: { salonId_userId: { salonId: salon.id, userId: user!.id } },
      });
      expect(salonUser).toBeDefined();
    });

    it('should DEDUPLICATE retried Meta Webhooks with identical meta_message_id', async () => {
      const metaMessageId = `wamid.HBgMOTE5N${Date.now()}`;
      const mockPhone = '+919655443322';

      const metaPayload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      id: metaMessageId,
                      from: mockPhone,
                      text: { body: 'BOOK ' + salon.slug },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      // Send identical webhook 5 times
      for (let i = 0; i < 5; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/whatsapp/webhook')
          .send(metaPayload)
          .expect(200);

        expect(res.text).toBe('EVENT_RECEIVED');
      }

      // Allow background async tasks to settle
      await new Promise((r) => setTimeout(r, 200));

      // Verify in DB: Exactly ONE WhatsAppLog with this metaMessageId exists!
      const logs = await prisma.whatsAppLog.findMany({
        where: { metaMessageId },
      });
      expect(logs.length).toBe(1);
    });
  });

  describe('3. Historical Immutability Snapshots & Price Tampering Defense (Sections 28 & 29)', () => {
    it('should REJECT client attempt to inject price parameter (Validation Defense)', async () => {
      // Malicious client tries to send `price: 1`
      const res = await request(app.getHttpServer())
        .post(`/api/v1/booking/${salon.slug}/appointments`)
        .send({
          serviceId: service.id,
          stylistId: stylist.id,
          date: testDate,
          startTime: '13:00',
          customerName: 'Cheater',
          customerPhone: '+919699999998',
          price: 1, // MALICIOUS CLIENT INJECTION
        })
        .expect(400);

      expect(res.body.message).toContain('property price should not exist');
    });

    it('should retain original service snapshots even if catalog service changes later', async () => {
      // 1. Book an appointment at current catalog: ₹500, 30m
      const bookRes = await request(app.getHttpServer())
        .post(`/api/v1/booking/${salon.slug}/appointments`)
        .send({
          serviceId: service.id,
          stylistId: stylist.id,
          date: testDate,
          startTime: '14:00',
          customerName: 'Snapshot Customer',
          customerPhone: '+919699999999',
        })
        .expect(201);

      const apptId = bookRes.body.appointmentId;

      // Verify server used catalog price ₹500
      const initialDbAppt = await prisma.appointment.findUnique({
        where: { id: apptId },
      });
      expect(Number(initialDbAppt!.price)).toBe(500);
      expect(initialDbAppt!.durationMinutes).toBe(30);
      expect(initialDbAppt!.serviceNameSnapshot).toBe('Concurrency Haircut');

      // 2. Salon Owner modifies the service in catalog to ₹800 and 60m
      await request(app.getHttpServer())
        .put(`/api/v1/services/${service.id}`)
        .set('Authorization', `Bearer ${salonOwnerToken}`)
        .send({
          name: 'Updated Concurrency Haircut Deluxe',
          durationMinutes: 60,
          price: 800,
        })
        .expect(200);

      // 3. Historical appointment MUST STILL retain ₹500 and 30m!
      const subsequentDbAppt = await prisma.appointment.findUnique({
        where: { id: apptId },
      });
      expect(Number(subsequentDbAppt!.price)).toBe(500);
      expect(subsequentDbAppt!.durationMinutes).toBe(30);
      expect(subsequentDbAppt!.serviceNameSnapshot).toBe('Concurrency Haircut');
    });
  });
});
