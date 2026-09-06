import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AdminRole, DayOfWeek, SalonStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

describe('Suite 3: Super Admin, Salon Hours, Mandatory Breaks, Services & Stylists (Sections 5-11)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let superAdminToken: string;
  let salonOwnerToken: string;
  let salon: any;
  let testService1: any;
  let testService2: any;
  let stylist1: any;

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
      where: { email: 'suite3-admin@salonsaas.com' },
      update: {},
      create: {
        email: 'suite3-admin@salonsaas.com',
        name: 'Suite 3 Super Admin',
        passwordHash,
        role: AdminRole.SUPER_ADMIN,
      },
    });

    const superRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'suite3-admin@salonsaas.com', password: 'Password123!' })
      .expect(200);
    superAdminToken = superRes.body.accessToken;
  });

  afterAll(async () => {
    try {
      if (salon?.id) {
        await prisma.appointment.deleteMany({ where: { salonId: salon.id } });
        await prisma.stylistService.deleteMany({
          where: { stylist: { salonId: salon.id } },
        });
        await prisma.stylistWorkingHours.deleteMany({
          where: { stylist: { salonId: salon.id } },
        });
        await prisma.stylist.deleteMany({ where: { salonId: salon.id } });
        await prisma.service.deleteMany({ where: { salonId: salon.id } });
        await prisma.salonWorkingHours.deleteMany({ where: { salonId: salon.id } });
        await prisma.salonUser.deleteMany({ where: { salonId: salon.id } });
        await prisma.admin.deleteMany({ where: { salonId: salon.id } });
        await prisma.salon.deleteMany({ where: { id: salon.id } });
      }
      await prisma.admin.deleteMany({ where: { email: 'suite3-admin@salonsaas.com' } });
    } catch (e) {
      // Best-effort cleanup
    }
    await app.close();
  });

  describe('1. Super Admin Validation & Salon Lifecycle', () => {
    it('should REJECT salon creation with empty or missing name', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/salons/platform/create')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          name: '',
          city: 'Pune',
          phone: '9888888881',
          ownerName: 'Owner Validation',
          email: 'invalid-name@test.com',
          password: 'Password123!',
        })
        .expect(400);
    });

    it('should REJECT salon creation with invalid email', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/salons/platform/create')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          name: 'Valid Name Salon',
          city: 'Pune',
          phone: '9888888882',
          ownerName: 'Owner Validation',
          email: 'not-an-email',
          password: 'Password123!',
        })
        .expect(400);
    });

    it('should successfully create salon and automatically seed all 7 days in salon_working_hours', async () => {
      const ownerEmail = `suite3-owner-${Date.now()}@test.com`;
      const res = await request(app.getHttpServer())
        .post('/api/v1/salons/platform/create')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          name: 'Opulent Hair Studio',
          city: 'Pune',
          phone: '9888888883',
          ownerName: 'Opulent Owner',
          email: ownerEmail,
          password: 'Password123!',
          openTime: '08:30',
          closeTime: '21:30',
        })
        .expect(201);

      salon = res.body;
      expect(salon.id).toBeDefined();

      // Verify all 7 days are in database
      const hours = await prisma.salonWorkingHours.findMany({
        where: { salonId: salon.id },
      });
      expect(hours.length).toBe(7);
      const days = hours.map((h) => h.dayOfWeek);
      expect(days).toContain(DayOfWeek.MONDAY);
      expect(days).toContain(DayOfWeek.SUNDAY);
      expect(hours[0].startTime).toBe('08:30');
      expect(hours[0].endTime).toBe('21:30');

      // Login as the salon owner
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: ownerEmail, password: 'Password123!' })
        .expect(200);
      salonOwnerToken = loginRes.body.accessToken;
    });

    it('should allow Super Admin to toggle salon status to DEACTIVATED', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/salons/platform/${salon.id}/toggle-status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      expect(res.body.status).toBe(SalonStatus.DEACTIVATED);

      // Toggle back to ACTIVE for subsequent tests
      await request(app.getHttpServer())
        .patch(`/api/v1/salons/platform/${salon.id}/toggle-status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);
    });
  });

  describe('2. Salon Working Hours & Mandatory Breaks (Sections 6 & 7)', () => {
    it('should update Monday working hours without mutating Tuesday', async () => {
      await request(app.getHttpServer())
        .put('/api/v1/salons/working-hours')
        .set('Authorization', `Bearer ${salonOwnerToken}`)
        .send({
          hours: [
            {
              dayOfWeek: DayOfWeek.MONDAY,
              isClosed: false,
              startTime: '10:00',
              endTime: '19:00',
              breakStartTime: '13:00',
              breakEndTime: '14:00',
            },
          ],
        })
        .expect(200);

      const mon = await prisma.salonWorkingHours.findUnique({
        where: { salonId_dayOfWeek: { salonId: salon.id, dayOfWeek: DayOfWeek.MONDAY } },
      });
      const tue = await prisma.salonWorkingHours.findUnique({
        where: { salonId_dayOfWeek: { salonId: salon.id, dayOfWeek: DayOfWeek.TUESDAY } },
      });

      expect(mon!.startTime).toBe('10:00');
      expect(mon!.endTime).toBe('19:00');
      expect(mon!.breakStartTime).toBe('13:00');
      expect(mon!.breakEndTime).toBe('14:00');

      // Tuesday remains untouched at original default (08:30 - 21:30)
      expect(tue!.startTime).toBe('08:30');
      expect(tue!.endTime).toBe('21:30');
      expect(tue!.breakStartTime).toBeNull();
    });
  });

  describe('3. Services & Stylist Prerequisite Enforcement (Sections 8, 9, 10, 11)', () => {
    it('should REJECT stylist creation when salon has NO services (Prerequisite Rule)', async () => {
      // Salon currently has 0 services
      await request(app.getHttpServer())
        .post('/api/v1/staff')
        .set('Authorization', `Bearer ${salonOwnerToken}`)
        .send({
          name: 'Premature Stylist',
          phone: '+919888888890',
          serviceIds: ['00000000-0000-0000-0000-000000000000'],
        })
        .expect(400);
    });

    it('should allow creating active services with valid durations and prices', async () => {
      const res1 = await request(app.getHttpServer())
        .post('/api/v1/services')
        .set('Authorization', `Bearer ${salonOwnerToken}`)
        .send({
          name: 'Signature Haircut',
          durationMinutes: 45,
          price: 600,
        })
        .expect(201);
      testService1 = res1.body;

      const res2 = await request(app.getHttpServer())
        .post('/api/v1/services')
        .set('Authorization', `Bearer ${salonOwnerToken}`)
        .send({
          name: 'Luxury Spa Facial',
          durationMinutes: 60,
          price: 1500,
        })
        .expect(201);
      testService2 = res2.body;

      expect(testService1.id).toBeDefined();
      expect(testService2.id).toBeDefined();
    });

    it('should REJECT stylist creation if serviceIds is empty', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/staff')
        .set('Authorization', `Bearer ${salonOwnerToken}`)
        .send({
          name: 'Empty Services Stylist',
          phone: '+919888888891',
          serviceIds: [],
        })
        .expect(400);
    });

    it('should successfully create Stylist and link services', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/staff')
        .set('Authorization', `Bearer ${salonOwnerToken}`)
        .send({
          name: 'Master Stylist Elena',
          phone: '+919888888892',
          followsSalonSchedule: true,
          serviceIds: [testService1.id, testService2.id],
        })
        .expect(201);

      stylist1 = res.body;
      expect(stylist1.id).toBeDefined();
      expect(stylist1.followsSalonSchedule).toBe(true);

      const links = await prisma.stylistService.findMany({
        where: { stylistId: stylist1.id },
      });
      expect(links.length).toBe(2);
    });

    it('should allow configuring custom stylist hours and individual breaks', async () => {
      // 1. Update stylist to not follow salon schedule
      await request(app.getHttpServer())
        .put(`/api/v1/staff/${stylist1.id}`)
        .set('Authorization', `Bearer ${salonOwnerToken}`)
        .send({
          name: stylist1.name,
          followsSalonSchedule: false,
        })
        .expect(200);

      // 2. Set custom working hours
      await request(app.getHttpServer())
        .put(`/api/v1/staff/${stylist1.id}/working-hours`)
        .set('Authorization', `Bearer ${salonOwnerToken}`)
        .send({
          hours: [
            {
              dayOfWeek: DayOfWeek.MONDAY,
              isWorking: true,
              startTime: '11:00',
              endTime: '18:00',
              breakStartTime: '14:00',
              breakEndTime: '15:00',
            },
          ],
        })
        .expect(200);

      const dbStylist = await prisma.stylist.findUnique({
        where: { id: stylist1.id },
        include: { workingHours: true },
      });
      expect(dbStylist!.followsSalonSchedule).toBe(false);
      expect(dbStylist!.workingHours.length).toBe(1);
      expect(dbStylist!.workingHours[0].startTime).toBe('11:00');
      expect(dbStylist!.workingHours[0].endTime).toBe('18:00');
      expect(dbStylist!.workingHours[0].breakStartTime).toBe('14:00');
    });
  });
});
