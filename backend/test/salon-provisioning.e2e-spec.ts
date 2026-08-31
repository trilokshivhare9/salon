import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';

describe('Super Admin Salon Provisioning & Dynamic Activation Lifecycle (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let superAdminToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);

    // Create or find platform super admin
    let superAdmin = await prisma.user.findFirst({
      where: { role: UserRole.PLATFORM_ADMIN },
    });
    if (!superAdmin) {
      superAdmin = await prisma.user.create({
        data: {
          name: 'Platform Super Admin',
          email: `admin_prov_${Date.now()}@salonsaas.com`,
          passwordHash: 'hashed_password',
          role: UserRole.PLATFORM_ADMIN,
        },
      });
    }

    superAdminToken = jwtService.sign({
      sub: superAdmin.id,
      email: superAdmin.email,
      role: superAdmin.role,
      salonId: superAdmin.salonId,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  let createdSalonId: string;
  let ownerToken: string;

  it('1. Successfully provisions clean salon with ZERO dummy data (DEACTIVATED status, 0 staff, 0 services)', async () => {
    const uniqueEmail = `owner_clean_${Date.now()}@example.com`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/salons/platform/create')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        name: 'The Grand Royal Barber',
        ownerName: 'Vikram Rajput',
        email: uniqueEmail,
        password: 'Password123!',
        phone: '7999817743',
        city: 'Indore',
        address: 'Shop 14, Main Market, Rajwada',
        openTime: '09:00',
        closeTime: '21:00',
      })
      .expect(201);

    const data = res.body.data || res.body;
    expect(data).toBeDefined();
    expect(data.name).toBe('The Grand Royal Barber');
    expect(data.status).toBe('DEACTIVATED');
    expect(data.staffCount).toBe(0);
    expect(data.servicesCount).toBe(0);
    expect(data.phone).toBe('+917999817743');

    createdSalonId = data.id;

    // Verify in database: exactly 0 staff, 0 services, 7 working hours
    const salon = await prisma.salon.findUnique({
      where: { id: data.id },
      include: {
        services: true,
        staff: true,
        workingHours: true,
        users: true,
      },
    });
    expect(salon).toBeDefined();
    expect(salon!.status).toBe('DEACTIVATED');
    expect(salon!.services.length).toBe(0);
    expect(salon!.staff.length).toBe(0);
    expect(salon!.workingHours.length).toBe(7);
    expect(salon!.users.length).toBe(1);
    expect(salon!.users[0].role).toBe(UserRole.SALON_ADMIN);

    ownerToken = jwtService.sign({
      sub: salon!.users[0].id,
      email: salon!.users[0].email,
      role: salon!.users[0].role,
      salonId: salon!.id,
    });
  });

  it('2. Rejects duplicate owner email with 409 Conflict', async () => {
    const duplicateEmail = `dup_${Date.now()}@example.com`;

    await request(app.getHttpServer())
      .post('/api/v1/salons/platform/create')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        name: 'First Instance',
        ownerName: 'Aarav Gupta',
        email: duplicateEmail,
        password: 'Password123!',
        phone: '9822233445',
        city: 'Delhi',
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/api/v1/salons/platform/create')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        name: 'Second Instance',
        ownerName: 'Another Owner',
        email: duplicateEmail,
        password: 'Password123!',
        phone: '9833344556',
        city: 'Delhi',
      })
      .expect(409);

    expect(res.body.message).toContain('already exists');
  });

  it('3. Rejects invalid mobile number strings (e.g. dfdsfssefefsdf) with 400 Bad Request', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/salons/platform/create')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        name: 'Invalid Phone Salon',
        ownerName: 'Rahul Mehra',
        email: `bad_phone_${Date.now()}@example.com`,
        password: 'Password123!',
        phone: 'dfdsfssefefsdf',
        city: 'Bengaluru',
      })
      .expect(400);

    expect(JSON.stringify(res.body.message)).toContain('valid 10-digit mobile number');
  });

  it('4. Rejects closing time earlier than opening time with 400 Bad Request', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/salons/platform/create')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        name: 'Invalid Hours Salon',
        ownerName: 'Kunal Joshi',
        email: `invalid_hours_${Date.now()}@example.com`,
        password: 'Password123!',
        phone: '9855566778',
        city: 'Jaipur',
        openTime: '20:00',
        closeTime: '08:00',
      })
      .expect(400);

    expect(res.body.message).toContain('Closing time must be later than opening time');
  });

  it('5. Automatically activates salon when owner adds first staff member and first service', async () => {
    // Check initial salon status is DEACTIVATED
    let salon = await prisma.salon.findUnique({ where: { id: createdSalonId } });
    expect(salon!.status).toBe('DEACTIVATED');

    // 1. Owner adds first service
    const svcRes = await request(app.getHttpServer())
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Classic Haircut',
        price: 250,
        durationMinutes: 30,
        category: 'Hair',
      })
      .expect(201);

    const createdSvc = svcRes.body.data || svcRes.body;

    // Status should still be DEACTIVATED (staff is 0)
    salon = await prisma.salon.findUnique({ where: { id: createdSalonId } });
    expect(salon!.status).toBe('DEACTIVATED');

    // 2. Owner adds first staff member
    await request(app.getHttpServer())
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Sameer Khan',
        phone: '9876543210',
        serviceIds: [createdSvc.id],
      })
      .expect(201);

    // Salon status should NOW automatically be ACTIVE!
    salon = await prisma.salon.findUnique({ where: { id: createdSalonId } });
    expect(salon!.status).toBe('ACTIVE');
  });
});
