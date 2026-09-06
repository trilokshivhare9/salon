import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AdminRole, DayOfWeek, AppointmentStatus, BookingSource } from '@prisma/client';
import * as bcrypt from 'bcrypt';

describe('Suite 1: Database Integrity, Constraints & Schema Enforcement (Section 3)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let superAdminId: string;
  let testSalonId: string;
  let testUserId: string;
  let testServiceId: string;
  let testStylistId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
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

    // Setup initial clean records for DB constraint testing
    const passwordHash = await bcrypt.hash('Password123!', 10);
    const superAdmin = await prisma.admin.upsert({
      where: { email: 'db-test-admin@salonsaas.com' },
      update: {},
      create: {
        email: 'db-test-admin@salonsaas.com',
        name: 'DB Test Admin',
        passwordHash,
        role: AdminRole.SUPER_ADMIN,
      },
    });
    superAdminId = superAdmin.id;

    const salon = await prisma.salon.create({
      data: {
        name: 'Schema Integrity Salon',
        slug: `schema-integrity-${Date.now()}`,
        phone: `+919000000001`,
        email: 'integrity@salontest.com',
        createdByAdminId: superAdminId,
      },
    });
    testSalonId = salon.id;

    const service = await prisma.service.create({
      data: {
        salonId: testSalonId,
        name: 'Integrity Cut',
        durationMinutes: 45,
        price: 350.0,
      },
    });
    testServiceId = service.id;

    const stylist = await prisma.stylist.create({
      data: {
        salonId: testSalonId,
        name: 'Integrity Stylist',
        services: { create: { serviceId: testServiceId } },
      },
    });
    testStylistId = stylist.id;

    const user = await prisma.user.create({
      data: {
        phone: '+919000000002',
        name: 'Integrity User',
      },
    });
    testUserId = user.id;
  });

  afterAll(async () => {
    try {
      await prisma.appointment.deleteMany({ where: { salonId: testSalonId } });
      await prisma.whatsAppAccount.deleteMany({ where: { salonId: testSalonId } });
      await prisma.whatsAppLog.deleteMany({ where: { salonId: testSalonId } });
      await prisma.stylistService.deleteMany({ where: { stylistId: testStylistId } });
      await prisma.stylist.deleteMany({ where: { salonId: testSalonId } });
      await prisma.service.deleteMany({ where: { salonId: testSalonId } });
      await prisma.salonWorkingHours.deleteMany({ where: { salonId: testSalonId } });
      await prisma.salonUser.deleteMany({ where: { salonId: testSalonId } });
      await prisma.salon.deleteMany({ where: { createdByAdminId: superAdminId } });
      await prisma.user.deleteMany({ where: { id: testUserId } });
      await prisma.admin.deleteMany({ where: { id: superAdminId } });
    } catch (e) {
      // Cleanup best effort
    }
    await app.close();
  });

  describe('1. Schema Structure & Enum Integrity', () => {
    it('should verify database tables and PostgreSQL enums are populated and functional', async () => {
      const enumCheck = await prisma.$queryRaw<any[]>`
        SELECT enumlabel FROM pg_enum 
        JOIN pg_type ON pg_enum.enumtypid = pg_type.oid 
        WHERE pg_type.typname = 'AdminRole';
      `;
      const roles = enumCheck.map((r) => r.enumlabel);
      expect(roles).toContain('SUPER_ADMIN');
      expect(roles).toContain('SALON_OWNER');
      expect(roles).not.toContain('MANAGER'); // Zero Manager role guarantee!
    });
  });

  describe('2. Primary Key & Unique Constraints', () => {
    it('should reject creating duplicate salon slug at database level', async () => {
      const existingSalon = await prisma.salon.findUnique({ where: { id: testSalonId } });
      await expect(
        prisma.salon.create({
          data: {
            name: 'Another Salon',
            slug: existingSalon!.slug, // DUPLICATE SLUG
            phone: '+919000000099',
            email: 'another@salontest.com',
            createdByAdmin: { connect: { id: superAdminId } },
          },
        }),
      ).rejects.toThrow();
    });

    it('should reject creating duplicate WhatsAppAccount phoneNumberId at database level', async () => {
      const waId = `PHONE-ID-${Date.now()}`;
      await prisma.whatsAppAccount.create({
        data: {
          salon: { connect: { id: testSalonId } },
          phoneNumberId: waId,
          accessTokenEncrypted: 'mock_encrypted_token',
          webhookVerifyToken: 'mock_verify_token',
        },
      });

      // Create a second salon to test cross-salon duplicate phoneNumberId
      const secondSalon = await prisma.salon.create({
        data: {
          name: 'Second Test Salon',
          slug: `second-salon-${Date.now()}`,
          phone: '+919000000088',
          email: 'second@salontest.com',
          createdByAdmin: { connect: { id: superAdminId } },
        },
      });

      await expect(
        prisma.whatsAppAccount.create({
          data: {
            salon: { connect: { id: secondSalon.id } },
            phoneNumberId: waId, // DUPLICATE META PHONE NUMBER ID
            accessTokenEncrypted: 'mock_encrypted_token',
            webhookVerifyToken: 'mock_verify_token',
          },
        }),
      ).rejects.toThrow();

      // Clean up second salon
      await prisma.salon.delete({ where: { id: secondSalon.id } });
    });

    it('should reject creating duplicate user phone number at database level', async () => {
      await expect(
        prisma.user.create({
          data: {
            phone: '+919000000002', // DUPLICATE USER PHONE
            name: 'Imposter User',
          },
        }),
      ).rejects.toThrow();
    });

    it('should reject duplicate metaMessageId in WhatsAppLog', async () => {
      const duplicateMsgId = `WAMID-TEST-${Date.now()}`;
      await prisma.whatsAppLog.create({
        data: {
          salonId: testSalonId,
          phone: '+919000000002',
          metaMessageId: duplicateMsgId,
          messageText: 'Initial delivery',
        },
      });

      await expect(
        prisma.whatsAppLog.create({
          data: {
            salonId: testSalonId,
            phone: '+919000000002',
            metaMessageId: duplicateMsgId, // DUPLICATE META MESSAGE ID
            messageText: 'Duplicate webhook retry',
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('3. Composite Unique Constraints', () => {
    it('should reject duplicate (salonId, dayOfWeek) in SalonWorkingHours', async () => {
      await prisma.salonWorkingHours.create({
        data: {
          salonId: testSalonId,
          dayOfWeek: DayOfWeek.MONDAY,
          startTime: '09:00',
          endTime: '20:00',
        },
      });

      await expect(
        prisma.salonWorkingHours.create({
          data: {
            salonId: testSalonId,
            dayOfWeek: DayOfWeek.MONDAY, // DUPLICATE COMPOSITE KEY
            startTime: '10:00',
            endTime: '19:00',
          },
        }),
      ).rejects.toThrow();
    });

    it('should reject duplicate (stylistId, serviceId) in StylistService', async () => {
      // (testStylistId, testServiceId) was already assigned during creation
      await expect(
        prisma.stylistService.create({
          data: {
            stylistId: testStylistId,
            serviceId: testServiceId, // DUPLICATE JUNCTION
          },
        }),
      ).rejects.toThrow();
    });

    it('should reject duplicate (salonId, userId) in SalonUser', async () => {
      await prisma.salonUser.create({
        data: {
          salonId: testSalonId,
          userId: testUserId,
        },
      });

      await expect(
        prisma.salonUser.create({
          data: {
            salonId: testSalonId,
            userId: testUserId, // DUPLICATE COMPOSITE RELATIONSHIP
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('4. Foreign Key Constraints & Delete Restriction (onDelete: Restrict)', () => {
    it('should reject inserting appointment with non-existent foreign keys', async () => {
      await expect(
        prisma.appointment.create({
          data: {
            appointmentNumber: 'SAL-INVALID-FK',
            salonId: '00000000-0000-0000-0000-000000000000', // Non-existent salon
            userId: testUserId,
            stylistId: testStylistId,
            serviceId: testServiceId,
            appointmentDate: new Date('2026-09-10'),
            startAt: new Date('2026-09-10T10:00:00.000Z'),
            endAt: new Date('2026-09-10T10:45:00.000Z'),
            serviceNameSnapshot: 'Integrity Cut',
            durationMinutes: 45,
            price: 350.0,
            status: AppointmentStatus.CONFIRMED,
            source: BookingSource.WEB,
          },
        }),
      ).rejects.toThrow();
    });

    it('should REJECT deleting a Service referenced by an active Appointment (onDelete: Restrict)', async () => {
      // 1. Create active appointment referencing testServiceId
      const appt = await prisma.appointment.create({
        data: {
          appointmentNumber: `SAL-${Math.floor(100000 + Math.random() * 900000)}`,
          salonId: testSalonId,
          userId: testUserId,
          stylistId: testStylistId,
          serviceId: testServiceId,
          appointmentDate: new Date('2026-09-10'),
          startAt: new Date('2026-09-10T11:00:00.000Z'),
          endAt: new Date('2026-09-10T11:45:00.000Z'),
          serviceNameSnapshot: 'Integrity Cut',
          durationMinutes: 45,
          price: 350.0,
          status: AppointmentStatus.CONFIRMED,
          source: BookingSource.WEB,
        },
      });

      // 2. Attempt hard delete of Service — MUST FAIL with foreign key violation!
      await expect(
        prisma.service.delete({
          where: { id: testServiceId },
        }),
      ).rejects.toThrow();

      // Clean up appointment
      await prisma.appointment.delete({ where: { id: appt.id } });
    });

    it('should REJECT deleting a Stylist referenced by an active Appointment (onDelete: Restrict)', async () => {
      const appt = await prisma.appointment.create({
        data: {
          appointmentNumber: `SAL-${Math.floor(100000 + Math.random() * 900000)}`,
          salonId: testSalonId,
          userId: testUserId,
          stylistId: testStylistId,
          serviceId: testServiceId,
          appointmentDate: new Date('2026-09-10'),
          startAt: new Date('2026-09-10T12:00:00.000Z'),
          endAt: new Date('2026-09-10T12:45:00.000Z'),
          serviceNameSnapshot: 'Integrity Cut',
          durationMinutes: 45,
          price: 350.0,
          status: AppointmentStatus.CONFIRMED,
          source: BookingSource.WEB,
        },
      });

      // Attempt hard delete of Stylist — MUST FAIL with foreign key violation!
      await expect(
        prisma.stylist.delete({
          where: { id: testStylistId },
        }),
      ).rejects.toThrow();

      // Clean up appointment
      await prisma.appointment.delete({ where: { id: appt.id } });
    });
  });

  describe('5. Automatic Timestamps Behavior', () => {
    it('should automatically set createdAt and update updatedAt on modification', async () => {
      const service = await prisma.service.findUnique({ where: { id: testServiceId } });
      expect(service!.createdAt).toBeDefined();
      expect(service!.updatedAt).toBeDefined();

      // Wait 50ms and update
      await new Promise((r) => setTimeout(r, 50));
      const updated = await prisma.service.update({
        where: { id: testServiceId },
        data: { price: 400.0 },
      });

      expect(updated.updatedAt.getTime()).toBeGreaterThan(service!.updatedAt.getTime());
    });
  });
});
