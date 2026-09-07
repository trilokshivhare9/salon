import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/http-exception.filter';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import {
  prisma,
  cleanAllTestData,
  seedBasePlatform,
  auditAll17Invariants,
  TEST_DB_URL,
} from './qa-helper';
import { ServiceStatus, StylistStatus, AdminRole, DayOfWeek, AppointmentStatus, BookingSource } from '@prisma/client';
import * as bcrypt from 'bcrypt';

interface ServiceTestReport {
  id: string;
  category: string;
  scenario: string;
  expectedResult: string;
  actualResult: string;
  apiStatus: number;
  dbVerified: string;
  verdict: 'PASS' | 'FAIL' | 'BLOCKED';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  reason?: string;
  apiRequest?: { method: string; endpoint: string; payload?: any };
  apiResponse?: { status: number; body: any };
  databaseEvidence?: any;
}

const reports: ServiceTestReport[] = [];

function recordReport(rep: ServiceTestReport) {
  reports.push(rep);
  const icon = rep.verdict === 'PASS' ? '✅' : '❌';
  console.log(`----------------------------------------------------`);
  console.log(`${icon} [${rep.id}] [${rep.severity}] ${rep.category}: ${rep.scenario}`);
  console.log(`   HTTP: ${rep.apiStatus} | DB: ${rep.dbVerified} | Result: ${rep.verdict}`);
  if (rep.reason) {
    console.log(`   Reason: ${rep.reason}`);
  }
}

export async function runServicesSuite() {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║    FEATURE TEST AUDIT: "ADD SERVICE" & "EDIT SERVICE" MODULE         ║');
  console.log('║    Protocol: docs/testing/FEATURE_TESTING_GUIDE.md                   ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  // Step 1: Environment Safety Verification
  console.log('>>> [Phase 1/11] Verifying Safe Isolated QA Environment...');
  if (!TEST_DB_URL.includes('salon_test_qa')) {
    console.error('TEST BLOCKED — SAFE QA ENVIRONMENT NOT CONFIRMED.');
    process.exit(1);
  }
  await prisma.$connect();
  console.log('    Connected to isolated QA database: salon_test_qa ✅\n');

  // Step 2: Clean and Seed Base QA Platform
  console.log('>>> [Phase 2/11] Seeding Base QA Multi-Tenant Data...');
  await cleanAllTestData();
  const { superAdmin, salonOwnerA, salonA, salonB } = await seedBasePlatform();

  // Create Salon Owner B for multi-tenant isolation testing
  const passwordHash = await bcrypt.hash('adminPassword123', 10);
  const salonOwnerB = await prisma.admin.create({
    data: {
      email: `owner-beta-${Date.now()}@platform.com`,
      passwordHash,
      name: 'Salon Beta Owner',
      role: AdminRole.SALON_OWNER,
      salonId: salonB.id,
    },
  });

  // Seed Stylists in Salon A
  const stylistA1 = await prisma.stylist.create({
    data: {
      salonId: salonA.id,
      name: 'Vikram Mehta',
      phone: '+919876500001',
      status: StylistStatus.ACTIVE,
    },
  });

  const stylistA2 = await prisma.stylist.create({
    data: {
      salonId: salonA.id,
      name: 'Ananya Roy',
      phone: '+919876500002',
      status: StylistStatus.ACTIVE,
    },
  });

  const inactiveStylistA = await prisma.stylist.create({
    data: {
      salonId: salonA.id,
      name: 'Ramesh Suspended',
      phone: '+919876500003',
      status: StylistStatus.INACTIVE,
    },
  });

  // Seed Stylist in Salon B (for cross-tenant testing)
  const stylistB1 = await prisma.stylist.create({
    data: {
      salonId: salonB.id,
      name: 'Kavita Salon B',
      phone: '+919876500004',
      status: StylistStatus.ACTIVE,
    },
  });

  // Seed a pre-existing Service in Salon B (for cross-tenant access testing)
  const serviceB1 = await prisma.service.create({
    data: {
      salonId: salonB.id,
      name: 'Salon B Exclusive Spa',
      price: 1800,
      durationMinutes: 60,
      status: ServiceStatus.ACTIVE,
    },
  });

  // Seed an empty Salon (0 services, 1 stylist) to test Salon Active dynamic status sync
  const emptySalon = await prisma.salon.create({
    data: {
      createdByAdminId: superAdmin.id,
      name: 'Salon Dynamic Status Test',
      slug: `salon-dyn-${Date.now()}`,
      phone: '+919999111222',
      email: `dyn-${Date.now()}@salon.com`,
      timezone: 'Asia/Kolkata',
      status: 'INACTIVE',
    },
  });
  const emptyOwner = await prisma.admin.create({
    data: {
      email: `owner-dyn-${Date.now()}@platform.com`,
      passwordHash,
      name: 'Dyn Salon Owner',
      role: AdminRole.SALON_OWNER,
      salonId: emptySalon.id,
    },
  });
  // Add 1 active stylist to emptySalon so service addition can trigger ACTIVE status
  const dynStylist = await prisma.stylist.create({
    data: {
      salonId: emptySalon.id,
      name: 'Dyn Stylist',
      phone: '+919999111223',
      status: StylistStatus.ACTIVE,
    },
  });

  // Boot the real NestJS HTTP Server
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app: INestApplication = moduleFixture.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new TransformInterceptor());
  await app.init();
  const server = app.getHttpServer();

  // Obtain JWT tokens
  const loginResA = await request(server)
    .post('/api/v1/auth/login')
    .send({ email: salonOwnerA.email, password: 'adminPassword123' });
  const tokenA = loginResA.body?.data?.accessToken || loginResA.body?.accessToken;

  const loginResB = await request(server)
    .post('/api/v1/auth/login')
    .send({ email: salonOwnerB.email, password: 'adminPassword123' });
  const tokenB = loginResB.body?.data?.accessToken || loginResB.body?.accessToken;

  const loginResEmpty = await request(server)
    .post('/api/v1/auth/login')
    .send({ email: emptyOwner.email, password: 'adminPassword123' });
  const tokenEmpty = loginResEmpty.body?.data?.accessToken || loginResEmpty.body?.accessToken;

  console.log('    Booted NestJS test server & authenticated Admin tokens ✅\n');
  console.log('>>> [Phase 3-10] Executing 46-Category Brutal Test Matrix for Services...\n');

  // Track created service IDs for lifecycle tests
  let createdServiceId1 = '';
  let createdServiceId2 = '';
  let createdServiceId3 = '';

  // ===========================================================================
  // TC-SRV-001: Happy Path — Add Service with Minimal Fields (Auto-Assign All Active Stylists)
  // ===========================================================================
  {
    const initialCount = await prisma.service.count({ where: { salonId: salonA.id } });
    const payload = {
      name: 'Classic Men Haircut',
      price: 350,
      durationMinutes: 30,
    };

    const res = await request(server)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const body = res.body?.data || res.body;
    createdServiceId1 = body?.id;

    const dbService = createdServiceId1
      ? await prisma.service.findUnique({
          where: { id: createdServiceId1 },
          include: { stylists: true },
        })
      : null;

    const afterCount = await prisma.service.count({ where: { salonId: salonA.id } });

    // Verify auto-linked active stylists (stylistA1 & stylistA2 should be linked, inactiveStylistA should NOT)
    const linkedStylistIds = dbService?.stylists.map((s) => s.stylistId) || [];
    const autoLinkedCorrectly =
      linkedStylistIds.includes(stylistA1.id) &&
      linkedStylistIds.includes(stylistA2.id) &&
      !linkedStylistIds.includes(inactiveStylistA.id);

    const pass =
      res.status === 201 &&
      res.body?.success === true &&
      dbService !== null &&
      dbService.name === 'Classic Men Haircut' &&
      Number(dbService.price) === 350 &&
      dbService.durationMinutes === 30 &&
      dbService.status === ServiceStatus.ACTIVE &&
      afterCount === initialCount + 1 &&
      autoLinkedCorrectly;

    recordReport({
      id: 'TC-SRV-001',
      category: 'Category A: Happy Path',
      scenario: 'Add Service with minimal fields (auto-assign active stylists)',
      expectedResult: 'HTTP 201, Service row created with status ACTIVE, auto-linked all active stylists',
      actualResult: `HTTP ${res.status}, Created ID: ${createdServiceId1}, Stylists auto-linked: ${linkedStylistIds.length}`,
      apiStatus: res.status,
      dbVerified: pass ? 'VERIFIED_IN_DB' : 'DB_MISMATCH',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      apiRequest: { method: 'POST', endpoint: '/api/v1/services', payload },
      apiResponse: { status: res.status, body: res.body },
      databaseEvidence: dbService,
    });
  }

  // ===========================================================================
  // TC-SRV-002: Happy Path — Add Service with Full Fields & Explicit Stylist Selection
  // ===========================================================================
  {
    const payload = {
      name: 'Beard Sculpting & Hot Towel Treatment',
      description: 'Deluxe organic beard oil treatment with warm towel compress',
      category: 'Grooming',
      price: 499.50,
      durationMinutes: 45,
      stylistIds: [stylistA1.id],
    };

    const res = await request(server)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const body = res.body?.data || res.body;
    createdServiceId2 = body?.id;

    const dbService = createdServiceId2
      ? await prisma.service.findUnique({
          where: { id: createdServiceId2 },
          include: { stylists: true },
        })
      : null;

    const pass =
      res.status === 201 &&
      res.body?.success === true &&
      dbService !== null &&
      dbService.name === payload.name &&
      dbService.description === payload.description &&
      dbService.category === payload.category &&
      Number(dbService.price) === 499.50 &&
      dbService.durationMinutes === 45 &&
      dbService.stylists.length === 1 &&
      dbService.stylists[0].stylistId === stylistA1.id;

    recordReport({
      id: 'TC-SRV-002',
      category: 'Category A: Happy Path',
      scenario: 'Add Service with full optional fields & explicit single stylist',
      expectedResult: 'HTTP 201, full fields saved accurately, exactly 1 stylist linked',
      actualResult: `HTTP ${res.status}, Category: ${dbService?.category}, Stylists: ${dbService?.stylists.length}`,
      apiStatus: res.status,
      dbVerified: pass ? 'VERIFIED_IN_DB' : 'DB_MISMATCH',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      apiRequest: { method: 'POST', endpoint: '/api/v1/services', payload },
      apiResponse: { status: res.status, body: res.body },
      databaseEvidence: dbService,
    });
  }

  // ===========================================================================
  // TC-SRV-003: Happy Path — Add Service with Explicit Empty Stylist Array
  // ===========================================================================
  {
    const payload = {
      name: 'Unassigned Hair Spa Capsule',
      price: 1200,
      durationMinutes: 60,
      stylistIds: [],
    };

    const res = await request(server)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const body = res.body?.data || res.body;
    createdServiceId3 = body?.id;

    const dbService = createdServiceId3
      ? await prisma.service.findUnique({
          where: { id: createdServiceId3 },
          include: { stylists: true },
        })
      : null;

    const pass =
      res.status === 201 &&
      res.body?.success === true &&
      dbService !== null &&
      dbService.stylists.length === 0;

    recordReport({
      id: 'TC-SRV-003',
      category: 'Category A & D: Empty Collection Handling',
      scenario: 'Add Service with explicit empty stylistIds array []',
      expectedResult: 'HTTP 201, Service created with zero linked stylists',
      actualResult: `HTTP ${res.status}, Linked stylists count: ${dbService?.stylists.length}`,
      apiStatus: res.status,
      dbVerified: pass ? 'VERIFIED_IN_DB' : 'DB_MISMATCH',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'MEDIUM',
      apiRequest: { method: 'POST', endpoint: '/api/v1/services', payload },
      apiResponse: { status: res.status, body: res.body },
    });
  }

  // ===========================================================================
  // TC-SRV-004: Required-Field Validation — Missing "name"
  // ===========================================================================
  {
    const countBefore = await prisma.service.count({ where: { salonId: salonA.id } });
    const payload = { price: 500, durationMinutes: 30 };

    const res = await request(server)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const countAfter = await prisma.service.count({ where: { salonId: salonA.id } });
    const pass = res.status === 400 && countAfter === countBefore;

    recordReport({
      id: 'TC-SRV-004',
      category: 'Category B: Required-Field Validation',
      scenario: 'Omit required field "name" on create',
      expectedResult: 'HTTP 400 Bad Request, zero DB rows added',
      actualResult: `HTTP ${res.status}, Error: ${JSON.stringify(res.body?.message || res.body)}`,
      apiStatus: res.status,
      dbVerified: pass ? 'VERIFIED_NO_INSERT' : 'UNEXPECTED_INSERT',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      apiRequest: { method: 'POST', endpoint: '/api/v1/services', payload },
      apiResponse: { status: res.status, body: res.body },
    });
  }

  // ===========================================================================
  // TC-SRV-005: Required-Field Validation — Missing "price"
  // ===========================================================================
  {
    const countBefore = await prisma.service.count({ where: { salonId: salonA.id } });
    const payload = { name: 'Price Missing Service', durationMinutes: 30 };

    const res = await request(server)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const countAfter = await prisma.service.count({ where: { salonId: salonA.id } });
    const pass = res.status === 400 && countAfter === countBefore;

    recordReport({
      id: 'TC-SRV-005',
      category: 'Category B: Required-Field Validation',
      scenario: 'Omit required field "price" on create',
      expectedResult: 'HTTP 400 Bad Request, zero DB rows added',
      actualResult: `HTTP ${res.status}`,
      apiStatus: res.status,
      dbVerified: pass ? 'VERIFIED_NO_INSERT' : 'UNEXPECTED_INSERT',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
    });
  }

  // ===========================================================================
  // TC-SRV-006: Required-Field Validation — Missing "durationMinutes"
  // ===========================================================================
  {
    const countBefore = await prisma.service.count({ where: { salonId: salonA.id } });
    const payload = { name: 'Duration Missing Service', price: 300 };

    const res = await request(server)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const countAfter = await prisma.service.count({ where: { salonId: salonA.id } });
    const pass = res.status === 400 && countAfter === countBefore;

    recordReport({
      id: 'TC-SRV-006',
      category: 'Category B: Required-Field Validation',
      scenario: 'Omit required field "durationMinutes" on create',
      expectedResult: 'HTTP 400 Bad Request, zero DB rows added',
      actualResult: `HTTP ${res.status}`,
      apiStatus: res.status,
      dbVerified: pass ? 'VERIFIED_NO_INSERT' : 'UNEXPECTED_INSERT',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
    });
  }

  // ===========================================================================
  // TC-SRV-007: Empty String Validation — Empty "name: ''"
  // ===========================================================================
  {
    const countBefore = await prisma.service.count({ where: { salonId: salonA.id } });
    const payload = { name: '', price: 300, durationMinutes: 30 };

    const res = await request(server)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const countAfter = await prisma.service.count({ where: { salonId: salonA.id } });
    const pass = res.status === 400 && countAfter === countBefore;

    recordReport({
      id: 'TC-SRV-007',
      category: 'Category D: Empty Values',
      scenario: 'Send empty string for name on create',
      expectedResult: 'HTTP 400 Bad Request (name should not be empty)',
      actualResult: `HTTP ${res.status}`,
      apiStatus: res.status,
      dbVerified: pass ? 'VERIFIED_NO_INSERT' : 'UNEXPECTED_INSERT',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'MEDIUM',
    });
  }

  // ===========================================================================
  // TC-SRV-008: Wrong Data Types — String for numeric fields
  // ===========================================================================
  {
    const payload = { name: 'Bad Types', price: 'three-hundred', durationMinutes: 'thirty' };

    const res = await request(server)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const pass = res.status === 400;

    recordReport({
      id: 'TC-SRV-008',
      category: 'Category F: Wrong Data Types',
      scenario: 'Send strings where numbers expected (price, durationMinutes)',
      expectedResult: 'HTTP 400 Bad Request',
      actualResult: `HTTP ${res.status}`,
      apiStatus: res.status,
      dbVerified: pass ? 'REJECTED' : 'ACCEPTED',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'MEDIUM',
    });
  }

  // ===========================================================================
  // TC-SRV-009: Non-Whitelisted Payload Injection (Strict Security Pipe)
  // ===========================================================================
  {
    const payload = {
      name: 'Injected Service',
      price: 300,
      durationMinutes: 30,
      isSuperAdmin: true,
      salonId: '00000000-0000-0000-0000-000000000000',
    };

    const res = await request(server)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const pass = res.status === 400;

    recordReport({
      id: 'TC-SRV-009',
      category: 'Category G: Security & Payload Whitelisting',
      scenario: 'Inject unwhitelisted properties (isSuperAdmin, salonId)',
      expectedResult: 'HTTP 400 Bad Request (whitelist & forbidNonWhitelisted enforced)',
      actualResult: `HTTP ${res.status}`,
      apiStatus: res.status,
      dbVerified: pass ? 'REJECTED' : 'LEAKED',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
    });
  }

  // ===========================================================================
  // TC-SRV-010: Boundary & Minimum — Negative Price on Create
  // ===========================================================================
  {
    const payload = { name: 'Negative Price Service', price: -50, durationMinutes: 30 };

    const res = await request(server)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const pass = res.status === 400;

    recordReport({
      id: 'TC-SRV-010',
      category: 'Category H & K: Boundary & Minimum Values',
      scenario: 'Create service with negative price (-50)',
      expectedResult: 'HTTP 400 Bad Request (price must not be less than 0)',
      actualResult: `HTTP ${res.status}`,
      apiStatus: res.status,
      dbVerified: pass ? 'REJECTED' : 'ACCEPTED',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
    });
  }

  // ===========================================================================
  // TC-SRV-011: Boundary & Minimum — Zero Price (Free Service)
  // ===========================================================================
  {
    const payload = { name: 'Complimentary Styling Advice', price: 0, durationMinutes: 30 };

    const res = await request(server)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const body = res.body?.data || res.body;
    const dbService = body?.id
      ? await prisma.service.findUnique({ where: { id: body.id } })
      : null;

    const pass =
      res.status === 201 &&
      dbService !== null &&
      Number(dbService.price) === 0;

    recordReport({
      id: 'TC-SRV-011',
      category: 'Category I: Minimum Values',
      scenario: 'Create complimentary service with price = 0',
      expectedResult: 'HTTP 201 Created, price stored as 0.00',
      actualResult: `HTTP ${res.status}, Stored price: ${dbService?.price}`,
      apiStatus: res.status,
      dbVerified: pass ? 'VERIFIED_IN_DB' : 'DB_MISMATCH',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
    });
  }

  // ===========================================================================
  // TC-SRV-012: Boundary & Minimum — Duration Below 30 Minutes (15 mins)
  // ===========================================================================
  {
    const payload = { name: 'Quick 15 Min Trim', price: 200, durationMinutes: 15 };

    const res = await request(server)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const pass = res.status === 400;

    recordReport({
      id: 'TC-SRV-012',
      category: 'Category H & K: Boundary & Minimum Values',
      scenario: 'Create service with duration = 15 (< 30 min minimum requirement)',
      expectedResult: 'HTTP 400 Bad Request ("Service duration must be at least 30 minutes")',
      actualResult: `HTTP ${res.status}`,
      apiStatus: res.status,
      dbVerified: pass ? 'REJECTED' : 'ACCEPTED',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
    });
  }

  // ===========================================================================
  // TC-SRV-013: Boundary & Minimum — Duration 0 or Negative
  // ===========================================================================
  {
    const payload = { name: 'Zero Min Service', price: 200, durationMinutes: 0 };

    const res = await request(server)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const pass = res.status === 400;

    recordReport({
      id: 'TC-SRV-013',
      category: 'Category H & K: Boundary & Minimum Values',
      scenario: 'Create service with duration = 0',
      expectedResult: 'HTTP 400 Bad Request',
      actualResult: `HTTP ${res.status}`,
      apiStatus: res.status,
      dbVerified: pass ? 'REJECTED' : 'ACCEPTED',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
    });
  }

  // ===========================================================================
  // TC-SRV-014: Custom Business Rule — Duration Not Multiple of 15 (35 mins)
  // ===========================================================================
  {
    const payload = { name: 'Odd 35 Min Service', price: 300, durationMinutes: 35 };

    const res = await request(server)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const pass = res.status === 400;

    recordReport({
      id: 'TC-SRV-014',
      category: 'Category AT: Custom Rule (@IsMultipleOf15)',
      scenario: 'Create service with duration = 35 (>= 30 but not multiple of 15)',
      expectedResult: 'HTTP 400 Bad Request ("durationMinutes must be a multiple of 15")',
      actualResult: `HTTP ${res.status}`,
      apiStatus: res.status,
      dbVerified: pass ? 'REJECTED' : 'ACCEPTED',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
    });
  }

  // ===========================================================================
  // TC-SRV-015: Custom Business Rule — Duration Not Multiple of 15 (40 mins)
  // ===========================================================================
  {
    const payload = { name: 'Odd 40 Min Service', price: 300, durationMinutes: 40 };

    const res = await request(server)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const pass = res.status === 400;

    recordReport({
      id: 'TC-SRV-015',
      category: 'Category AT: Custom Rule (@IsMultipleOf15)',
      scenario: 'Create service with duration = 40 (not multiple of 15)',
      expectedResult: 'HTTP 400 Bad Request ("durationMinutes must be a multiple of 15")',
      actualResult: `HTTP ${res.status}`,
      apiStatus: res.status,
      dbVerified: pass ? 'REJECTED' : 'ACCEPTED',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
    });
  }

  // ===========================================================================
  // TC-SRV-016: Boundary & Maximum — Long Multi-Hour Service (180 mins)
  // ===========================================================================
  {
    const payload = { name: 'Intensive Keratin Smoothening', price: 6500, durationMinutes: 180 };

    const res = await request(server)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const body = res.body?.data || res.body;
    const dbService = body?.id
      ? await prisma.service.findUnique({ where: { id: body.id } })
      : null;

    const pass =
      res.status === 201 &&
      dbService !== null &&
      dbService.durationMinutes === 180;

    recordReport({
      id: 'TC-SRV-016',
      category: 'Category J: Maximum / Long Duration Values',
      scenario: 'Create multi-hour service (180 minutes)',
      expectedResult: 'HTTP 201 Created, duration stored as 180 mins',
      actualResult: `HTTP ${res.status}, Stored duration: ${dbService?.durationMinutes}`,
      apiStatus: res.status,
      dbVerified: pass ? 'VERIFIED_IN_DB' : 'DB_MISMATCH',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'MEDIUM',
    });
  }

  // ===========================================================================
  // TC-SRV-017: Invalid UUID format in stylistIds
  // ===========================================================================
  {
    const payload = {
      name: 'Bad UUID Stylist Service',
      price: 350,
      durationMinutes: 30,
      stylistIds: ['not-a-valid-uuid-12345'],
    };

    const res = await request(server)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const pass = res.status === 400;

    recordReport({
      id: 'TC-SRV-017',
      category: 'Category G: Invalid Formats',
      scenario: 'Provide invalid UUID string inside stylistIds',
      expectedResult: 'HTTP 400 Bad Request ("Each stylistId must be a valid UUID")',
      actualResult: `HTTP ${res.status}`,
      apiStatus: res.status,
      dbVerified: pass ? 'REJECTED' : 'ACCEPTED',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
    });
  }

  // ===========================================================================
  // TC-SRV-018: Non-Existent Stylist UUID
  // ===========================================================================
  {
    const payload = {
      name: 'Ghost Stylist Service',
      price: 350,
      durationMinutes: 30,
      stylistIds: ['a0000000-0000-4000-8000-000000000000'],
    };

    const res = await request(server)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const pass = res.status === 400;

    recordReport({
      id: 'TC-SRV-018',
      category: 'Category N: Non-Existent IDs',
      scenario: 'Provide unseeded / random UUID in stylistIds on create',
      expectedResult: 'HTTP 400 Bad Request ("One or more selected stylists do not exist...")',
      actualResult: `HTTP ${res.status}`,
      apiStatus: res.status,
      dbVerified: pass ? 'REJECTED' : 'ACCEPTED',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
    });
  }

  // ===========================================================================
  // TC-SRV-019: Inactive Stylist Linking Rejection
  // ===========================================================================
  {
    const payload = {
      name: 'Inactive Stylist Linking',
      price: 350,
      durationMinutes: 30,
      stylistIds: [inactiveStylistA.id],
    };

    const res = await request(server)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const pass = res.status === 400;

    recordReport({
      id: 'TC-SRV-019',
      category: 'Category P: Inactive Records',
      scenario: 'Attempt to link an INACTIVE stylist to new service',
      expectedResult: 'HTTP 400 Bad Request (cannot assign inactive stylist)',
      actualResult: `HTTP ${res.status}`,
      apiStatus: res.status,
      dbVerified: pass ? 'REJECTED' : 'ACCEPTED',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
    });
  }

  // ===========================================================================
  // TC-SRV-020: Multi-Tenant Isolation — Cross-Salon Stylist Linking on Create
  // ===========================================================================
  {
    const payload = {
      name: 'Cross Tenant Service',
      price: 350,
      durationMinutes: 30,
      stylistIds: [stylistB1.id], // Stylist belongs to Salon B!
    };

    const res = await request(server)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const pass = res.status === 400;

    recordReport({
      id: 'TC-SRV-020',
      category: 'Category Q & V: Multi-Tenant Cross-Salon Linking',
      scenario: 'Admin of Salon A attempts to link Stylist of Salon B to new service',
      expectedResult: 'HTTP 400 Bad Request, zero records leaked or created across salons',
      actualResult: `HTTP ${res.status}`,
      apiStatus: res.status,
      dbVerified: pass ? 'REJECTED' : 'LEAKED',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
    });
  }

  // ===========================================================================
  // TC-SRV-021: Happy Path — Edit Service (Partial Update: Name Only)
  // ===========================================================================
  {
    const payload = { name: 'Classic Men Haircut - Signature Edition' };

    const res = await request(server)
      .put(`/api/v1/services/${createdServiceId1}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const dbService = await prisma.service.findUnique({
      where: { id: createdServiceId1 },
      include: { stylists: true },
    });

    const pass =
      res.status === 200 &&
      res.body?.success === true &&
      dbService !== null &&
      dbService.name === payload.name &&
      Number(dbService.price) === 350 && // Unchanged
      dbService.durationMinutes === 30 && // Unchanged
      dbService.stylists.length === 2; // Linked stylists untouched

    recordReport({
      id: 'TC-SRV-021',
      category: 'Category A: Happy Path (Edit Service)',
      scenario: 'Partial update: edit name only (price, duration, stylists remain intact)',
      expectedResult: 'HTTP 200 OK, name updated, existing attributes preserved',
      actualResult: `HTTP ${res.status}, Name: ${dbService?.name}, Price: ${dbService?.price}`,
      apiStatus: res.status,
      dbVerified: pass ? 'VERIFIED_IN_DB' : 'DB_MISMATCH',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      apiRequest: { method: 'PUT', endpoint: `/api/v1/services/${createdServiceId1}`, payload },
      apiResponse: { status: res.status, body: res.body },
      databaseEvidence: dbService,
    });
  }

  // ===========================================================================
  // TC-SRV-022: Happy Path — Edit Service (Price and Duration Update)
  // ===========================================================================
  {
    const payload = { price: 550, durationMinutes: 45 };

    const res = await request(server)
      .put(`/api/v1/services/${createdServiceId1}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const dbService = await prisma.service.findUnique({
      where: { id: createdServiceId1 },
    });

    const pass =
      res.status === 200 &&
      res.body?.success === true &&
      dbService !== null &&
      Number(dbService.price) === 550 &&
      dbService.durationMinutes === 45;

    recordReport({
      id: 'TC-SRV-022',
      category: 'Category A: Happy Path (Edit Service)',
      scenario: 'Update price (350 -> 550) and durationMinutes (30 -> 45)',
      expectedResult: 'HTTP 200 OK, price and durationMinutes updated in DB',
      actualResult: `HTTP ${res.status}, New Price: ${dbService?.price}, Duration: ${dbService?.durationMinutes}`,
      apiStatus: res.status,
      dbVerified: pass ? 'VERIFIED_IN_DB' : 'DB_MISMATCH',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
    });
  }

  // ===========================================================================
  // TC-SRV-023: Happy Path — Edit Service (Description and Category Update)
  // ===========================================================================
  {
    const payload = {
      description: 'Updated comprehensive haircut and beard alignment',
      category: 'Premium Styling',
    };

    const res = await request(server)
      .put(`/api/v1/services/${createdServiceId1}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const dbService = await prisma.service.findUnique({
      where: { id: createdServiceId1 },
    });

    const pass =
      res.status === 200 &&
      dbService !== null &&
      dbService.description === payload.description &&
      dbService.category === payload.category;

    recordReport({
      id: 'TC-SRV-023',
      category: 'Category A: Happy Path (Edit Service)',
      scenario: 'Update description and category',
      expectedResult: 'HTTP 200 OK, description and category updated in DB',
      actualResult: `HTTP ${res.status}, Category: ${dbService?.category}`,
      apiStatus: res.status,
      dbVerified: pass ? 'VERIFIED_IN_DB' : 'DB_MISMATCH',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'MEDIUM',
    });
  }

  // ===========================================================================
  // TC-SRV-024: Happy Path — Edit Service (Reassign Linked Stylists)
  // ===========================================================================
  {
    // Reassign service 1 to only stylistA2 (removing stylistA1)
    const payload = { stylistIds: [stylistA2.id] };

    const res = await request(server)
      .put(`/api/v1/services/${createdServiceId1}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const dbService = await prisma.service.findUnique({
      where: { id: createdServiceId1 },
      include: { stylists: true },
    });

    const pass =
      res.status === 200 &&
      dbService !== null &&
      dbService.stylists.length === 1 &&
      dbService.stylists[0].stylistId === stylistA2.id;

    recordReport({
      id: 'TC-SRV-024',
      category: 'Category A & C: Relational Reassignment',
      scenario: 'Reassign linked stylists (replace [stylist1, stylist2] with [stylist2])',
      expectedResult: 'HTTP 200 OK, stylist_services updated, old link cleanly removed',
      actualResult: `HTTP ${res.status}, Stylists count: ${dbService?.stylists.length}, Assigned: ${dbService?.stylists[0]?.stylistId}`,
      apiStatus: res.status,
      dbVerified: pass ? 'VERIFIED_IN_DB' : 'DB_MISMATCH',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
    });
  }

  // ===========================================================================
  // TC-SRV-025: Happy Path — Edit Service (Unlink All Stylists via stylistIds: [])
  // ===========================================================================
  {
    const payload = { stylistIds: [] };

    const res = await request(server)
      .put(`/api/v1/services/${createdServiceId1}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const dbService = await prisma.service.findUnique({
      where: { id: createdServiceId1 },
      include: { stylists: true },
    });

    const pass =
      res.status === 200 &&
      dbService !== null &&
      dbService.stylists.length === 0;

    recordReport({
      id: 'TC-SRV-025',
      category: 'Category A & D: Relational Clear',
      scenario: 'Unlink all stylists via empty array stylistIds: [] on edit',
      expectedResult: 'HTTP 200 OK, stylist_services count becomes 0',
      actualResult: `HTTP ${res.status}, Stylists count: ${dbService?.stylists.length}`,
      apiStatus: res.status,
      dbVerified: pass ? 'VERIFIED_IN_DB' : 'DB_MISMATCH',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
    });
  }

  // ===========================================================================
  // TC-SRV-025B: Edit Validation — Empty String Name ("")
  // ===========================================================================
  {
    const payload = { name: '' };

    const res = await request(server)
      .put(`/api/v1/services/${createdServiceId1}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const dbService = await prisma.service.findUnique({
      where: { id: createdServiceId1 },
    });

    const pass = res.status === 400 && dbService?.name !== '';

    recordReport({
      id: 'TC-SRV-025B',
      category: 'Category D: Empty Values on Update',
      scenario: 'Attempt to update service name to empty string ("")',
      expectedResult: 'HTTP 400 Bad Request, service name must not be blank in DB',
      actualResult: `HTTP ${res.status}, DB Service Name: "${dbService?.name}"`,
      apiStatus: res.status,
      dbVerified: pass ? 'VERIFIED_REJECTED' : 'MUTATED_TO_EMPTY_STRING',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
    });
  }

  // ===========================================================================
  // TC-SRV-025C: Edit Validation — Whitespace-Only Name ("   ")
  // ===========================================================================
  {
    const payload = { name: '     ' };

    const res = await request(server)
      .put(`/api/v1/services/${createdServiceId1}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const dbService = await prisma.service.findUnique({
      where: { id: createdServiceId1 },
    });

    const pass = res.status === 400 && dbService?.name?.trim() !== '';

    recordReport({
      id: 'TC-SRV-025C',
      category: 'Category D: Whitespace Values on Update',
      scenario: 'Attempt to update service name to whitespace-only string ("   ")',
      expectedResult: 'HTTP 400 Bad Request, rejected by trimming validation',
      actualResult: `HTTP ${res.status}, DB Service Name: "${dbService?.name}"`,
      apiStatus: res.status,
      dbVerified: pass ? 'VERIFIED_REJECTED' : 'MUTATED_TO_WHITESPACE',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
    });
  }

  // ===========================================================================
  // TC-SRV-026: Edit Validation — Negative Price
  // ===========================================================================
  {
    const payload = { price: -75 };

    const res = await request(server)
      .put(`/api/v1/services/${createdServiceId1}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const dbService = await prisma.service.findUnique({
      where: { id: createdServiceId1 },
    });

    const pass = res.status === 400 && Number(dbService?.price) === 550; // Not modified

    recordReport({
      id: 'TC-SRV-026',
      category: 'Category H & K: Boundary & Minimum Values',
      scenario: 'Attempt to update price to negative value (-75)',
      expectedResult: 'HTTP 400 Bad Request, price remains unchanged in DB',
      actualResult: `HTTP ${res.status}, DB Price: ${dbService?.price}`,
      apiStatus: res.status,
      dbVerified: pass ? 'VERIFIED_NO_MUTATION' : 'MUTATED',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
    });
  }

  // ===========================================================================
  // TC-SRV-027: Edit Validation — Duration Below 30 Minutes
  // ===========================================================================
  {
    const payload = { durationMinutes: 15 };

    const res = await request(server)
      .put(`/api/v1/services/${createdServiceId1}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const dbService = await prisma.service.findUnique({
      where: { id: createdServiceId1 },
    });

    const pass = res.status === 400 && dbService?.durationMinutes === 45; // Not modified

    recordReport({
      id: 'TC-SRV-027',
      category: 'Category H & K: Boundary & Minimum Values',
      scenario: 'Attempt to update durationMinutes to 15 (< 30 min minimum)',
      expectedResult: 'HTTP 400 Bad Request, duration remains unchanged in DB',
      actualResult: `HTTP ${res.status}, DB Duration: ${dbService?.durationMinutes}`,
      apiStatus: res.status,
      dbVerified: pass ? 'VERIFIED_NO_MUTATION' : 'MUTATED',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
    });
  }

  // ===========================================================================
  // TC-SRV-028: Edit Validation — Duration Not Multiple of 15 (50 mins)
  // ===========================================================================
  {
    const payload = { durationMinutes: 50 };

    const res = await request(server)
      .put(`/api/v1/services/${createdServiceId1}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const dbService = await prisma.service.findUnique({
      where: { id: createdServiceId1 },
    });

    const pass = res.status === 400 && dbService?.durationMinutes === 45;

    recordReport({
      id: 'TC-SRV-028',
      category: 'Category AT: Custom Rule (@IsMultipleOf15)',
      scenario: 'Attempt to update durationMinutes to 50 (not multiple of 15)',
      expectedResult: 'HTTP 400 Bad Request, duration remains unchanged in DB',
      actualResult: `HTTP ${res.status}, DB Duration: ${dbService?.durationMinutes}`,
      apiStatus: res.status,
      dbVerified: pass ? 'VERIFIED_NO_MUTATION' : 'MUTATED',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
    });
  }

  // ===========================================================================
  // TC-SRV-029: Edit Validation — Non-Whitelisted Property Injection
  // ===========================================================================
  {
    const payload = { name: 'Hacked Name', salonId: 'fake-id', hackField: true };

    const res = await request(server)
      .put(`/api/v1/services/${createdServiceId1}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const pass = res.status === 400;

    recordReport({
      id: 'TC-SRV-029',
      category: 'Category G: Security & Payload Whitelisting',
      scenario: 'Inject unwhitelisted property (hackField, salonId) on update',
      expectedResult: 'HTTP 400 Bad Request, zero modifications',
      actualResult: `HTTP ${res.status}`,
      apiStatus: res.status,
      dbVerified: pass ? 'REJECTED' : 'ACCEPTED',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
    });
  }

  // ===========================================================================
  // TC-SRV-030: Edit Validation — Non-Existent Stylist UUID
  // ===========================================================================
  {
    const payload = { stylistIds: ['a0000000-0000-4000-8000-000000000000'] };

    const res = await request(server)
      .put(`/api/v1/services/${createdServiceId1}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const pass = res.status === 400;

    recordReport({
      id: 'TC-SRV-030',
      category: 'Category N: Non-Existent IDs',
      scenario: 'Provide non-existent stylist UUID in stylistIds on update',
      expectedResult: 'HTTP 400 Bad Request, stylist mappings unchanged',
      actualResult: `HTTP ${res.status}`,
      apiStatus: res.status,
      dbVerified: pass ? 'REJECTED' : 'ACCEPTED',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
    });
  }

  // ===========================================================================
  // TC-SRV-031: Edit Validation — Inactive Stylist Linking
  // ===========================================================================
  {
    const payload = { stylistIds: [inactiveStylistA.id] };

    const res = await request(server)
      .put(`/api/v1/services/${createdServiceId1}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const pass = res.status === 400;

    recordReport({
      id: 'TC-SRV-031',
      category: 'Category P: Inactive Records',
      scenario: 'Attempt to assign an INACTIVE stylist to service on update',
      expectedResult: 'HTTP 400 Bad Request',
      actualResult: `HTTP ${res.status}`,
      apiStatus: res.status,
      dbVerified: pass ? 'REJECTED' : 'ACCEPTED',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
    });
  }

  // ===========================================================================
  // TC-SRV-032: Multi-Tenant Isolation — Cross-Salon Stylist Linking on Edit
  // ===========================================================================
  {
    const payload = { stylistIds: [stylistB1.id] };

    const res = await request(server)
      .put(`/api/v1/services/${createdServiceId1}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const pass = res.status === 400;

    recordReport({
      id: 'TC-SRV-032',
      category: 'Category Q & V: Multi-Tenant Cross-Salon Linking',
      scenario: 'Admin of Salon A attempts to link Stylist of Salon B to existing service',
      expectedResult: 'HTTP 400 Bad Request, zero cross-salon associations',
      actualResult: `HTTP ${res.status}`,
      apiStatus: res.status,
      dbVerified: pass ? 'REJECTED' : 'LEAKED',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
    });
  }

  // ===========================================================================
  // TC-SRV-033: Non-Existent Service ID on Edit
  // ===========================================================================
  {
    const nonExistentId = '00000000-0000-4000-8000-000000000000';
    const payload = { name: 'Ghost Service Update' };

    const res = await request(server)
      .put(`/api/v1/services/${nonExistentId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const pass = res.status === 404;

    recordReport({
      id: 'TC-SRV-033',
      category: 'Category N: Non-Existent IDs',
      scenario: 'Attempt to update non-existent service ID',
      expectedResult: 'HTTP 404 Not Found',
      actualResult: `HTTP ${res.status}`,
      apiStatus: res.status,
      dbVerified: pass ? 'NOT_FOUND_HANDLED' : 'WRONG_STATUS',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'MEDIUM',
    });
  }

  // ===========================================================================
  // TC-SRV-034: Multi-Tenant Isolation — Admin A attempts to mutate Salon B Service
  // ===========================================================================
  {
    const payload = { name: 'Hacked by Salon A Admin', price: 10 };

    const res = await request(server)
      .put(`/api/v1/services/${serviceB1.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const dbServiceB = await prisma.service.findUnique({
      where: { id: serviceB1.id },
    });

    const pass =
      res.status === 404 &&
      dbServiceB?.name === 'Salon B Exclusive Spa' && // Name unchanged
      Number(dbServiceB?.price) === 1800; // Price unchanged

    recordReport({
      id: 'TC-SRV-034',
      category: 'Category T & U: Multi-Tenant Isolation (Cross-Salon Mutation)',
      scenario: 'Admin A attempts to edit Service belonging to Salon B',
      expectedResult: 'HTTP 404 Not Found, zero mutation in Salon B service row',
      actualResult: `HTTP ${res.status}, Service B Name: "${dbServiceB?.name}", Price: ${dbServiceB?.price}`,
      apiStatus: res.status,
      dbVerified: pass ? 'VERIFIED_ISOLATED' : 'CROSS_TENANT_MUTATION_BREACH',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
      apiRequest: { method: 'PUT', endpoint: `/api/v1/services/${serviceB1.id}`, payload },
      apiResponse: { status: res.status, body: res.body },
    });
  }

  // ===========================================================================
  // TC-SRV-035: Multi-Tenant Isolation — Admin A attempts to read Salon B Service
  // ===========================================================================
  {
    const res = await request(server)
      .get(`/api/v1/services/${serviceB1.id}`)
      .set('Authorization', `Bearer ${tokenA}`);

    const pass = res.status === 404;

    recordReport({
      id: 'TC-SRV-035',
      category: 'Category T & U: Multi-Tenant Isolation (Cross-Salon Read)',
      scenario: 'Admin A attempts to GET Service belonging to Salon B by ID',
      expectedResult: 'HTTP 404 Not Found, no data leaked',
      actualResult: `HTTP ${res.status}`,
      apiStatus: res.status,
      dbVerified: pass ? 'VERIFIED_ISOLATED' : 'DATA_LEAKED',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
    });
  }

  // ===========================================================================
  // TC-SRV-036: Multi-Tenant Isolation — Admin A attempts to delete Salon B Service
  // ===========================================================================
  {
    const res = await request(server)
      .delete(`/api/v1/services/${serviceB1.id}`)
      .set('Authorization', `Bearer ${tokenA}`);

    const dbServiceB = await prisma.service.findUnique({
      where: { id: serviceB1.id },
    });

    const pass = res.status === 404 && dbServiceB !== null;

    recordReport({
      id: 'TC-SRV-036',
      category: 'Category T & U: Multi-Tenant Isolation (Cross-Salon Delete)',
      scenario: 'Admin A attempts to DELETE Service belonging to Salon B',
      expectedResult: 'HTTP 404 Not Found, Salon B service remains in DB',
      actualResult: `HTTP ${res.status}, Service B Exists: ${dbServiceB !== null}`,
      apiStatus: res.status,
      dbVerified: pass ? 'VERIFIED_ISOLATED' : 'CROSS_TENANT_DELETION_BREACH',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
    });
  }

  // ===========================================================================
  // TC-SRV-037: Security & RBAC — Unauthenticated Request Blocked
  // ===========================================================================
  {
    const res = await request(server)
      .post('/api/v1/services')
      .send({ name: 'Unauthenticated Service', price: 500, durationMinutes: 30 });

    const pass = res.status === 401;

    recordReport({
      id: 'TC-SRV-037',
      category: 'Category R: Unauthorized Access',
      scenario: 'Call POST /services without Authorization header',
      expectedResult: 'HTTP 401 Unauthorized',
      actualResult: `HTTP ${res.status}`,
      apiStatus: res.status,
      dbVerified: pass ? 'BLOCKED' : 'PERMITTED',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
    });
  }

  // ===========================================================================
  // TC-SRV-038: Security & RBAC — Corrupted / Forged JWT Token
  // ===========================================================================
  {
    const res = await request(server)
      .put(`/api/v1/services/${createdServiceId1}`)
      .set('Authorization', 'Bearer forged.jwt.token.here')
      .send({ name: 'Forged Token Attempt' });

    const pass = res.status === 401;

    recordReport({
      id: 'TC-SRV-038',
      category: 'Category S: Authentication Failure',
      scenario: 'Call PUT /services/:id with forged / invalid JWT token',
      expectedResult: 'HTTP 401 Unauthorized',
      actualResult: `HTTP ${res.status}`,
      apiStatus: res.status,
      dbVerified: pass ? 'BLOCKED' : 'PERMITTED',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
    });
  }

  // ===========================================================================
  // TC-SRV-039: Historical Immutability & Decoupling from Booked Appointments
  // ===========================================================================
  {
    // Step 1: Create a customer and book an appointment with createdServiceId2
    // createdServiceId2 was created with: price 499.50, duration 45, name 'Beard Sculpting & Hot Towel Treatment'
    const customerUser = await prisma.user.create({
      data: {
        phone: '+919111222333',
        name: 'Rahul Customer',
      },
    });

    const salonUser = await prisma.salonUser.create({
      data: {
        salonId: salonA.id,
        userId: customerUser.id,
      },
    });

    const appointmentStart = new Date(Date.now() + 86400000); // 1 day ahead
    appointmentStart.setHours(11, 0, 0, 0);
    const appointmentEnd = new Date(appointmentStart.getTime() + 45 * 60000);

    const bookedAppt = await prisma.appointment.create({
      data: {
        appointmentNumber: `SRV-TEST-${Date.now()}`,
        salonId: salonA.id,
        salonUserId: salonUser.id,
        stylistId: stylistA1.id,
        serviceId: createdServiceId2,
        serviceNameSnapshot: 'Beard Sculpting & Hot Towel Treatment',
        price: 499.50,
        durationMinutes: 45,
        appointmentDate: appointmentStart,
        startAt: appointmentStart,
        endAt: appointmentEnd,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WEB,
      },
    });

    // Step 2: Now Admin A edits createdServiceId2 (change price to 850, duration to 60, name to 'Beard Pro Extreme')
    const updateRes = await request(server)
      .put(`/api/v1/services/${createdServiceId2}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        name: 'Beard Pro Extreme',
        price: 850,
        durationMinutes: 60,
      });

    // Step 3: Query the historical appointment directly from DB
    const refreshedAppt = await prisma.appointment.findUnique({
      where: { id: bookedAppt.id },
    });

    const pass =
      updateRes.status === 200 &&
      refreshedAppt !== null &&
      Number(refreshedAppt.price) === 499.50 && // Must NOT change to 850!
      refreshedAppt.durationMinutes === 45 && // Must NOT change to 60!
      refreshedAppt.serviceNameSnapshot === 'Beard Sculpting & Hot Towel Treatment'; // Snapshot preserved!

    recordReport({
      id: 'TC-SRV-039',
      category: 'Category AD & AA: Historical Immutability & Decoupling',
      scenario: 'Edit service price/duration; verify existing booked appointment retains original snapshots',
      expectedResult: 'HTTP 200 on edit; appointment.price stays 499.50, duration stays 45, snapshot unchanged',
      actualResult: `HTTP ${updateRes.status}, Appt Price: ${refreshedAppt?.price}, Duration: ${refreshedAppt?.durationMinutes}, Snapshot: "${refreshedAppt?.serviceNameSnapshot}"`,
      apiStatus: updateRes.status,
      dbVerified: pass ? 'IMMUTABILITY_CONFIRMED' : 'SNAPSHOT_CORRUPTED',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
      databaseEvidence: refreshedAppt,
    });
  }

  // ===========================================================================
  // TC-SRV-040: Service Status Toggle & Salon Active Status Dynamic Sync
  // ===========================================================================
  {
    // Toggle createdServiceId3 to INACTIVE
    const toggleRes1 = await request(server)
      .patch(`/api/v1/services/${createdServiceId3}/toggle-status`)
      .set('Authorization', `Bearer ${tokenA}`);

    const dbServiceInactive = await prisma.service.findUnique({
      where: { id: createdServiceId3 },
    });

    // Toggle it back to ACTIVE
    const toggleRes2 = await request(server)
      .patch(`/api/v1/services/${createdServiceId3}/toggle-status`)
      .set('Authorization', `Bearer ${tokenA}`);

    const dbServiceActive = await prisma.service.findUnique({
      where: { id: createdServiceId3 },
    });

    const pass =
      toggleRes1.status === 200 &&
      dbServiceInactive?.status === ServiceStatus.INACTIVE &&
      toggleRes2.status === 200 &&
      dbServiceActive?.status === ServiceStatus.ACTIVE;

    recordReport({
      id: 'TC-SRV-040',
      category: 'Category X: State-Transition & Status Toggle',
      scenario: 'Toggle service status from ACTIVE -> INACTIVE -> ACTIVE',
      expectedResult: 'HTTP 200, status toggles cleanly between ACTIVE and INACTIVE',
      actualResult: `Toggle1: ${dbServiceInactive?.status}, Toggle2: ${dbServiceActive?.status}`,
      apiStatus: toggleRes1.status,
      dbVerified: pass ? 'VERIFIED_IN_DB' : 'DB_MISMATCH',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
    });
  }

  // ===========================================================================
  // TC-SRV-041: Safety Guard — Prevent Service Deletion When Future Active Appointments Exist
  // ===========================================================================
  {
    // createdServiceId2 has an active future appointment booked in TC-SRV-039!
    const res = await request(server)
      .delete(`/api/v1/services/${createdServiceId2}`)
      .set('Authorization', `Bearer ${tokenA}`);

    const dbService = await prisma.service.findUnique({
      where: { id: createdServiceId2 },
    });

    const pass =
      res.status === 400 &&
      dbService !== null &&
      res.body?.message?.includes('appointment(s)');

    recordReport({
      id: 'TC-SRV-041',
      category: 'Category X & AS: Safety Guards on Deletion',
      scenario: 'Attempt to delete service that has active booked appointments',
      expectedResult: 'HTTP 400 Bad Request, service NOT deleted',
      actualResult: `HTTP ${res.status}, Message: "${res.body?.message}"`,
      apiStatus: res.status,
      dbVerified: pass ? 'PREVENTED_DELETION' : 'DELETED_UNSAFELY',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
    });
  }

  // ===========================================================================
  // TC-SRV-041B: Data Loss Prevention — Prevent Deletion When Past Completed Appointments Exist
  // ===========================================================================
  {
    // Create a service with a PAST completed appointment
    const pastSrv = await prisma.service.create({
      data: {
        salonId: salonA.id,
        name: 'Historical Special Treatment',
        price: 900,
        durationMinutes: 45,
        status: ServiceStatus.ACTIVE,
      },
    });

    const anySalonUser = await prisma.salonUser.findFirst({
      where: { salonId: salonA.id },
    });

    const pastApptStart = new Date(Date.now() - 3 * 86400000); // 3 days ago
    const pastApptEnd = new Date(pastApptStart.getTime() + 45 * 60000);

    const pastAppt = await prisma.appointment.create({
      data: {
        appointmentNumber: `HIST-${Date.now()}`,
        salonId: salonA.id,
        salonUserId: anySalonUser!.id,
        stylistId: stylistA1.id,
        serviceId: pastSrv.id,
        serviceNameSnapshot: 'Historical Special Treatment',
        price: 900,
        durationMinutes: 45,
        appointmentDate: pastApptStart,
        startAt: pastApptStart,
        endAt: pastApptEnd,
        status: AppointmentStatus.COMPLETED,
        source: BookingSource.WEB,
      },
    });

    const delRes = await request(server)
      .delete(`/api/v1/services/${pastSrv.id}`)
      .set('Authorization', `Bearer ${tokenA}`);

    const dbSrvCheck = await prisma.service.findUnique({ where: { id: pastSrv.id } });
    const dbApptCheck = await prisma.appointment.findUnique({ where: { id: pastAppt.id } });

    const pass =
      delRes.status === 400 &&
      dbSrvCheck !== null &&
      dbApptCheck !== null; // ZERO historical appointment data loss!

    recordReport({
      id: 'TC-SRV-041B',
      category: 'Category X & AS: Historical Data Loss Prevention',
      scenario: 'Attempt to delete service with past completed appointment',
      expectedResult: 'HTTP 400 Bad Request, service preserved, zero historical appointments deleted',
      actualResult: `HTTP ${delRes.status}, Service in DB: ${dbSrvCheck !== null}, Past Appt in DB: ${dbApptCheck !== null}`,
      apiStatus: delRes.status,
      dbVerified: pass ? 'HISTORICAL_APPOINTMENTS_PRESERVED' : 'DATA_LOSS_DETECTED',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
    });
  }

  // ===========================================================================
  // TC-SRV-042: Safe Service Deletion When No Active Appointments Exist
  // ===========================================================================
  {
    // createdServiceId3 has no appointments.
    const res = await request(server)
      .delete(`/api/v1/services/${createdServiceId3}`)
      .set('Authorization', `Bearer ${tokenA}`);

    const dbService = await prisma.service.findUnique({
      where: { id: createdServiceId3 },
    });

    const pass = res.status === 200 && dbService === null;

    recordReport({
      id: 'TC-SRV-042',
      category: 'Category Y & O: Safe Entity Deletion',
      scenario: 'Delete service with no active appointments',
      expectedResult: 'HTTP 200 OK, service row removed from DB',
      actualResult: `HTTP ${res.status}, Service in DB: ${dbService !== null}`,
      apiStatus: res.status,
      dbVerified: pass ? 'VERIFIED_DELETED' : 'STILL_EXISTS',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
    });
  }

  // ===========================================================================
  // TC-SRV-043: Dynamic Salon Activation Sync
  // ===========================================================================
  {
    // emptySalon currently has 1 active stylist (dynStylist) but 0 services -> status INACTIVE
    const initialSalon = await prisma.salon.findUnique({ where: { id: emptySalon.id } });

    // Add first service to emptySalon
    const addSrvRes = await request(server)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${tokenEmpty}`)
      .send({ name: 'First Service', price: 400, durationMinutes: 30 });

    const srvBody = addSrvRes.body?.data || addSrvRes.body;
    const firstServiceId = srvBody?.id;

    const activatedSalon = await prisma.salon.findUnique({ where: { id: emptySalon.id } });

    // Toggle that only service to INACTIVE -> Salon should auto-deactivate!
    await request(server)
      .patch(`/api/v1/services/${firstServiceId}/toggle-status`)
      .set('Authorization', `Bearer ${tokenEmpty}`);

    const deactivatedSalon = await prisma.salon.findUnique({ where: { id: emptySalon.id } });

    // Toggle service back to ACTIVE -> Salon should auto-activate!
    await request(server)
      .patch(`/api/v1/services/${firstServiceId}/toggle-status`)
      .set('Authorization', `Bearer ${tokenEmpty}`);

    const reactivatedSalon = await prisma.salon.findUnique({ where: { id: emptySalon.id } });

    const pass =
      initialSalon?.status === 'INACTIVE' &&
      activatedSalon?.status === 'ACTIVE' &&
      deactivatedSalon?.status === 'INACTIVE' &&
      reactivatedSalon?.status === 'ACTIVE';

    recordReport({
      id: 'TC-SRV-043',
      category: 'Category AC: Side Effects & Salon Active Status Sync',
      scenario: 'Verify Salon status dynamically synchronizes upon service addition & toggle',
      expectedResult: 'Salon transitions INACTIVE -> ACTIVE -> INACTIVE -> ACTIVE',
      actualResult: `Initial: ${initialSalon?.status}, After Add: ${activatedSalon?.status}, After Deactivate: ${deactivatedSalon?.status}, Reactivated: ${reactivatedSalon?.status}`,
      apiStatus: addSrvRes.status,
      dbVerified: pass ? 'SYNC_VERIFIED' : 'SYNC_FAILED',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
    });
  }

  // ===========================================================================
  // TC-SRV-044: Concurrency Stress — Simultaneous Parallel Service Additions
  // ===========================================================================
  {
    console.log('>>> [Phase 9/11] Running Concurrency Stress: 5 Parallel Service Creations...');
    const parallelPayloads = [
      { name: 'Concurrent Service 1', price: 250, durationMinutes: 30 },
      { name: 'Concurrent Service 2', price: 350, durationMinutes: 45 },
      { name: 'Concurrent Service 3', price: 450, durationMinutes: 60 },
      { name: 'Concurrent Service 4', price: 550, durationMinutes: 75 },
      { name: 'Concurrent Service 5', price: 650, durationMinutes: 90 },
    ];

    const promises = parallelPayloads.map((payload) =>
      request(server)
        .post('/api/v1/services')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(payload),
    );

    const results = await Promise.all(promises);
    const statuses = results.map((r) => r.status);
    const all201 = statuses.every((s) => s === 201);

    // Verify all 5 exist in database
    const createdNames = parallelPayloads.map((p) => p.name);
    const dbCount = await prisma.service.count({
      where: { salonId: salonA.id, name: { in: createdNames } },
    });

    const pass = all201 && dbCount === 5;

    recordReport({
      id: 'TC-SRV-044',
      category: 'Category AF & AG: Concurrency & Race Conditions',
      scenario: '5 parallel simultaneous service creation requests via Promise.all',
      expectedResult: 'All 5 return HTTP 201 Created, exactly 5 rows in DB, zero deadlocks or 500s',
      actualResult: `Statuses: [${statuses.join(', ')}], DB rows created: ${dbCount}`,
      apiStatus: all201 ? 201 : 500,
      dbVerified: pass ? 'CONCURRENCY_SAFE' : 'CONCURRENCY_FAIL',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
    });
  }

  // ===========================================================================
  // TC-SRV-045: Concurrency Stress — Simultaneous Parallel Edits on Same Service
  // ===========================================================================
  {
    console.log('>>> [Phase 9/11] Running Concurrency Stress: 4 Parallel Edits on Same Service...');
    const editPayloads = [
      { name: 'Concurrent Name Update' },
      { price: 777 },
      { description: 'Concurrent description updated' },
      { category: 'Concurrent Category' },
    ];

    const promises = editPayloads.map((payload) =>
      request(server)
        .put(`/api/v1/services/${createdServiceId1}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send(payload),
    );

    const results = await Promise.all(promises);
    const statuses = results.map((r) => r.status);
    const all200 = statuses.every((s) => s === 200);

    const dbService = await prisma.service.findUnique({
      where: { id: createdServiceId1 },
    });

    const pass = all200 && dbService !== null;

    recordReport({
      id: 'TC-SRV-045',
      category: 'Category AF & AG: Concurrency on Shared Entity',
      scenario: '4 parallel simultaneous updates to same service ID via Promise.all',
      expectedResult: 'All 4 return HTTP 200 OK, zero deadlocks or 500s, consistent final DB state',
      actualResult: `Statuses: [${statuses.join(', ')}], Final DB Price: ${dbService?.price}`,
      apiStatus: all200 ? 200 : 500,
      dbVerified: pass ? 'CONCURRENCY_SAFE' : 'CONCURRENCY_FAIL',
      verdict: pass ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
    });
  }

  // ===========================================================================
  // TC-SRV-046: Database 17-Point Invariant Audit
  // ===========================================================================
  {
    console.log('>>> [Phase 10/11] Auditing all 17 Database Invariants...');
    const auditResult = await auditAll17Invariants();

    recordReport({
      id: 'TC-SRV-046',
      category: 'Category AA: Database Consistency & Invariant Audit',
      scenario: 'Audit all 17 system invariants on PostgreSQL (exclusions, FKs, locks, snapshots)',
      expectedResult: '17/17 Invariants Pass, 0 Violations',
      actualResult: auditResult.passed
        ? '17/17 Invariants Pass (0 Violations)'
        : `Violations: ${auditResult.violations.join('; ')}`,
      apiStatus: 200,
      dbVerified: auditResult.passed ? 'ALL_17_INVARIANTS_PASSED' : 'INVARIANT_VIOLATION',
      verdict: auditResult.passed ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
      reason: auditResult.violations.length > 0 ? auditResult.violations.join(' | ') : undefined,
    });
  }

  // Cleanup & Close
  await app.close();
  await prisma.$disconnect();

  // Print Summary Table
  console.log('\n======================================================================');
  console.log('                   SERVICE SUITE AUDIT EXECUTION SUMMARY              ');
  console.log('======================================================================');
  const total = reports.length;
  const passed = reports.filter((r) => r.verdict === 'PASS').length;
  const failed = reports.filter((r) => r.verdict === 'FAIL').length;
  console.log(`Total Scenarios Executed: ${total}`);
  console.log(`Passed:                   ${passed} ✅`);
  console.log(`Failed:                   ${failed} ❌`);
  console.log(`Success Rate:             ${((passed / total) * 100).toFixed(1)}%`);
  console.log('======================================================================\n');

  return { total, passed, failed, reports };
}

if (require.main === module) {
  runServicesSuite()
    .then((res) => {
      if (res.failed > 0) {
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('Fatal Suite Execution Error:', err);
      process.exit(1);
    });
}
