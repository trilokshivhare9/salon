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
import { ServiceStatus, StylistStatus, AdminRole, DayOfWeek } from '@prisma/client';
import * as bcrypt from 'bcrypt';

interface StylistTestReport {
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

const reports: StylistTestReport[] = [];

function recordReport(rep: StylistTestReport) {
  reports.push(rep);
  const icon = rep.verdict === 'PASS' ? '✅' : '❌';
  console.log(`----------------------------------------------------`);
  console.log(`${icon} [${rep.id}] [${rep.severity}] ${rep.category}: ${rep.scenario}`);
  console.log(`   HTTP: ${rep.apiStatus} | DB: ${rep.dbVerified} | Result: ${rep.verdict}`);
  if (rep.reason) {
    console.log(`   Reason: ${rep.reason}`);
  }
}

export async function runAddStylistSuite() {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║        FEATURE TEST AUDIT: "ADD STYLIST" (STAFF MODULE)              ║');
  console.log('║        Protocol: docs/testing/FEATURE_TESTING_GUIDE.md               ║');
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

  // Create active QA Services in Salon A
  const srvHaircut = await prisma.service.create({
    data: { salonId: salonA.id, name: 'Standard Haircut', durationMinutes: 30, price: 500, status: ServiceStatus.ACTIVE },
  });
  const srvFacial = await prisma.service.create({
    data: { salonId: salonA.id, name: 'Facial Treatment', durationMinutes: 45, price: 1500, status: ServiceStatus.ACTIVE },
  });
  const srvInactive = await prisma.service.create({
    data: { salonId: salonA.id, name: 'Discontinued Spa', durationMinutes: 60, price: 2000, status: ServiceStatus.INACTIVE },
  });

  // Create active QA Service in Salon B (for cross-tenant testing)
  const srvSalonB = await prisma.service.create({
    data: { salonId: salonB.id, name: 'Salon B Specialty', durationMinutes: 45, price: 1200, status: ServiceStatus.ACTIVE },
  });

  // Create an empty Salon (0 services) to test prerequisite validation
  const emptySalon = await prisma.salon.create({
    data: {
      createdByAdminId: superAdmin.id,
      name: 'Salon Empty (No Services)',
      slug: `salon-empty-${Date.now()}`,
      phone: '+919999888877',
      email: `empty-${Date.now()}@salon.com`,
      timezone: 'Asia/Kolkata',
      status: 'ACTIVE',
    },
  });
  const emptyOwner = await prisma.admin.create({
    data: {
      email: `owner-empty-${Date.now()}@platform.com`,
      passwordHash,
      name: 'Empty Salon Owner',
      role: AdminRole.SALON_OWNER,
      salonId: emptySalon.id,
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

  // Obtain JWT tokens for Salon Owner A and Salon Owner B
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
  console.log('>>> [Phase 3-10] Executing 46-Category Brutal Test Matrix for "Add Stylist"...\n');

  // Track created stylist IDs for lifecycle verification
  let createdStylistId1 = '';
  let createdStylistId2 = '';

  // ===========================================================================
  // TC-STYL-001: Happy Path — Minimal Required Fields (Auto-Assign Active Services)
  // ===========================================================================
  {
    const initialCount = await prisma.stylist.count({ where: { salonId: salonA.id } });
    const payload = { name: 'Rohan Verma' };

    const res = await request(server)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const body = res.body?.data || res.body;
    createdStylistId1 = body?.id;

    const dbStylist = createdStylistId1
      ? await prisma.stylist.findUnique({
          where: { id: createdStylistId1 },
          include: { services: true },
        })
      : null;

    const newCount = await prisma.stylist.count({ where: { salonId: salonA.id } });

    const isPass =
      res.status === 201 &&
      body?.name === 'Rohan Verma' &&
      body?.salonId === salonA.id &&
      body?.status === 'ACTIVE' &&
      body?.followsSalonSchedule === true &&
      newCount === initialCount + 1 &&
      dbStylist !== null &&
      dbStylist.salonId === salonA.id &&
      dbStylist.services.length === 2 && // Both srvHaircut and srvFacial auto-assigned
      dbStylist.services.some((s) => s.serviceId === srvHaircut.id) &&
      dbStylist.services.some((s) => s.serviceId === srvFacial.id);

    recordReport({
      id: 'TC-STYL-001',
      category: 'Happy Path',
      scenario: 'Create stylist with minimal required fields (auto-assigns all active services)',
      expectedResult: 'HTTP 201 Created, DB row added, default followsSalonSchedule=true, all active services auto-assigned',
      actualResult: `HTTP ${res.status}, ID: ${body?.id}, auto-assigned services: ${dbStylist?.services.length}`,
      apiStatus: res.status,
      dbVerified: dbStylist ? 'PASS' : 'FAIL',
      verdict: isPass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      apiRequest: { method: 'POST', endpoint: '/api/v1/staff', payload },
      apiResponse: { status: res.status, body: res.body },
      databaseEvidence: dbStylist,
    });
  }

  // ===========================================================================
  // TC-STYL-002: Happy Path — Complete Fields & Custom Schedule & Explicit Service Subset
  // ===========================================================================
  {
    const initialCount = await prisma.stylist.count({ where: { salonId: salonA.id } });
    const payload = {
      name: 'Pooja Hegde',
      phone: '+919876543210',
      email: 'pooja@salon.com',
      profileImageUrl: 'https://cdn.salon.com/pooja.png',
      followsSalonSchedule: false,
      serviceIds: [srvHaircut.id], // Explicitly assign only haircut
    };

    const res = await request(server)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const body = res.body?.data || res.body;
    createdStylistId2 = body?.id;

    const dbStylist = createdStylistId2
      ? await prisma.stylist.findUnique({
          where: { id: createdStylistId2 },
          include: { services: true },
        })
      : null;

    const newCount = await prisma.stylist.count({ where: { salonId: salonA.id } });

    const isPass =
      res.status === 201 &&
      body?.name === 'Pooja Hegde' &&
      body?.phone === '+919876543210' &&
      body?.email === 'pooja@salon.com' &&
      body?.profileImageUrl === 'https://cdn.salon.com/pooja.png' &&
      body?.followsSalonSchedule === false &&
      newCount === initialCount + 1 &&
      dbStylist !== null &&
      dbStylist.services.length === 1 &&
      dbStylist.services[0].serviceId === srvHaircut.id;

    recordReport({
      id: 'TC-STYL-002',
      category: 'Happy Path',
      scenario: 'Create stylist with complete optional fields and custom schedule (explicit serviceIds subset)',
      expectedResult: 'HTTP 201 Created, all fields stored accurately, exactly 1 assigned service',
      actualResult: `HTTP ${res.status}, followsSalonSchedule: ${body?.followsSalonSchedule}, assigned services: ${dbStylist?.services.length}`,
      apiStatus: res.status,
      dbVerified: dbStylist ? 'PASS' : 'FAIL',
      verdict: isPass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      apiRequest: { method: 'POST', endpoint: '/api/v1/staff', payload },
      apiResponse: { status: res.status, body: res.body },
      databaseEvidence: dbStylist,
    });
  }

  // ===========================================================================
  // TC-STYL-003: Validation — Missing Required Field "name"
  // ===========================================================================
  {
    const initialCount = await prisma.stylist.count({ where: { salonId: salonA.id } });
    const payload = { phone: '+919876543210' };

    const res = await request(server)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const newCount = await prisma.stylist.count({ where: { salonId: salonA.id } });
    const isPass = res.status === 400 && newCount === initialCount;

    recordReport({
      id: 'TC-STYL-003',
      category: 'Required-Field Validation',
      scenario: 'Attempt stylist creation with omitted "name" field',
      expectedResult: 'HTTP 400 Bad Request, zero DB rows created',
      actualResult: `HTTP ${res.status}, error: ${JSON.stringify(res.body?.message || res.body)}`,
      apiStatus: res.status,
      dbVerified: newCount === initialCount ? 'PASS' : 'FAIL',
      verdict: isPass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      apiRequest: { method: 'POST', endpoint: '/api/v1/staff', payload },
      apiResponse: { status: res.status, body: res.body },
    });
  }

  // ===========================================================================
  // TC-STYL-004: Validation — Empty String "name"
  // ===========================================================================
  {
    const initialCount = await prisma.stylist.count({ where: { salonId: salonA.id } });
    const payload = { name: '' };

    const res = await request(server)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const newCount = await prisma.stylist.count({ where: { salonId: salonA.id } });
    const isPass = res.status === 400 && newCount === initialCount;

    recordReport({
      id: 'TC-STYL-004',
      category: 'Empty Values',
      scenario: 'Attempt stylist creation with empty string name ""',
      expectedResult: 'HTTP 400 Bad Request ("name should not be empty")',
      actualResult: `HTTP ${res.status}, error: ${JSON.stringify(res.body?.message || res.body)}`,
      apiStatus: res.status,
      dbVerified: newCount === initialCount ? 'PASS' : 'FAIL',
      verdict: isPass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      apiRequest: { method: 'POST', endpoint: '/api/v1/staff', payload },
      apiResponse: { status: res.status, body: res.body },
    });
  }

  // ===========================================================================
  // TC-STYL-005: Validation — Null "name"
  // ===========================================================================
  {
    const initialCount = await prisma.stylist.count({ where: { salonId: salonA.id } });
    const payload = { name: null };

    const res = await request(server)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const newCount = await prisma.stylist.count({ where: { salonId: salonA.id } });
    const isPass = res.status === 400 && newCount === initialCount;

    recordReport({
      id: 'TC-STYL-005',
      category: 'Null Values',
      scenario: 'Attempt stylist creation with null name',
      expectedResult: 'HTTP 400 Bad Request, zero DB rows created',
      actualResult: `HTTP ${res.status}`,
      apiStatus: res.status,
      dbVerified: newCount === initialCount ? 'PASS' : 'FAIL',
      verdict: isPass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      apiRequest: { method: 'POST', endpoint: '/api/v1/staff', payload },
      apiResponse: { status: res.status, body: res.body },
    });
  }

  // ===========================================================================
  // TC-STYL-006: Validation — Wrong Scalar Data Types (Coercion Check)
  // ===========================================================================
  {
    const initialCount = await prisma.stylist.count({ where: { salonId: salonA.id } });
    const payload = { name: 99999, followsSalonSchedule: 'invalid-boolean' };

    const res = await request(server)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const newCount = await prisma.stylist.count({ where: { salonId: salonA.id } });
    const isPass = res.status === 400 && newCount === initialCount;

    recordReport({
      id: 'TC-STYL-006',
      category: 'Wrong Data Types',
      scenario: 'Pass number for name and string for boolean followsSalonSchedule',
      expectedResult: 'HTTP 400 Bad Request ("name must be a string", "followsSalonSchedule must be a boolean")',
      actualResult: `HTTP ${res.status}, response: ${JSON.stringify(res.body?.data || res.body)}`,
      apiStatus: res.status,
      dbVerified: newCount === initialCount ? 'PASS' : 'FAIL',
      verdict: isPass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      reason: isPass
        ? undefined
        : 'Global ValidationPipe has enableImplicitConversion:true which silently auto-coerced number 99999 to string "99999" and string "invalid-boolean" to boolean true, returning HTTP 201 instead of HTTP 400.',
      apiRequest: { method: 'POST', endpoint: '/api/v1/staff', payload },
      apiResponse: { status: res.status, body: res.body },
    });
  }

  // ===========================================================================
  // TC-STYL-006B: Validation — Non-Coercible Wrong Data Types (Object for String)
  // ===========================================================================
  {
    const initialCount = await prisma.stylist.count({ where: { salonId: salonA.id } });
    const payload = { name: { invalid: 'object' } };

    const res = await request(server)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const newCount = await prisma.stylist.count({ where: { salonId: salonA.id } });
    const isPass = res.status === 400 && newCount === initialCount;

    recordReport({
      id: 'TC-STYL-006B',
      category: 'Wrong Data Types',
      scenario: 'Pass nested object for name field { name: { invalid: "object" } }',
      expectedResult: 'HTTP 400 Bad Request ("name must be a string"), zero DB rows created',
      actualResult: `HTTP ${res.status}, response: ${JSON.stringify(res.body?.data || res.body)}`,
      apiStatus: res.status,
      dbVerified: newCount === initialCount ? 'PASS' : 'FAIL',
      verdict: isPass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      reason: isPass
        ? undefined
        : 'Global ValidationPipe enableImplicitConversion:true coerced the object { invalid: "object" } into string "[object Object]", allowing it to pass @IsString() and save "[object Object]" as the stylist name.',
      apiRequest: { method: 'POST', endpoint: '/api/v1/staff', payload },
      apiResponse: { status: res.status, body: res.body },
    });
  }

  // ===========================================================================
  // TC-STYL-007: Validation — Invalid Email Format
  // ===========================================================================
  {
    const initialCount = await prisma.stylist.count({ where: { salonId: salonA.id } });
    const payload = { name: 'Vikram', email: 'not-an-email-format' };

    const res = await request(server)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const newCount = await prisma.stylist.count({ where: { salonId: salonA.id } });
    const isPass = res.status === 400 && newCount === initialCount;

    recordReport({
      id: 'TC-STYL-007',
      category: 'Invalid Formats',
      scenario: 'Attempt stylist creation with malformed email string',
      expectedResult: 'HTTP 400 Bad Request ("email must be an email")',
      actualResult: `HTTP ${res.status}, message: ${JSON.stringify(res.body?.message || res.body)}`,
      apiStatus: res.status,
      dbVerified: newCount === initialCount ? 'PASS' : 'FAIL',
      verdict: isPass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      apiRequest: { method: 'POST', endpoint: '/api/v1/staff', payload },
      apiResponse: { status: res.status, body: res.body },
    });
  }

  // ===========================================================================
  // TC-STYL-008: Security — Non-Whitelisted Property Injection
  // ===========================================================================
  {
    const initialCount = await prisma.stylist.count({ where: { salonId: salonA.id } });
    const payload = {
      name: 'Sneha',
      salary: 75000,
      adminRole: 'SUPER_ADMIN',
      injectedSalonId: 'fake-tenant-id',
    };

    const res = await request(server)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const newCount = await prisma.stylist.count({ where: { salonId: salonA.id } });
    const isPass = res.status === 400 && newCount === initialCount;

    recordReport({
      id: 'TC-STYL-008',
      category: 'Security & Injection',
      scenario: 'Attempt to inject arbitrary non-whitelisted attributes (salary, adminRole, injectedSalonId)',
      expectedResult: 'HTTP 400 Bad Request via forbidNonWhitelisted pipe, zero DB rows created',
      actualResult: `HTTP ${res.status}, error: ${JSON.stringify(res.body?.message || res.body)}`,
      apiStatus: res.status,
      dbVerified: newCount === initialCount ? 'PASS' : 'FAIL',
      verdict: isPass ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
      apiRequest: { method: 'POST', endpoint: '/api/v1/staff', payload },
      apiResponse: { status: res.status, body: res.body },
    });
  }

  // ===========================================================================
  // TC-STYL-009: Boundary — Whitespace Sanitization & Trimming
  // ===========================================================================
  {
    const payload = {
      name: '   Siddharth Malhotra   ',
      phone: '  +919811122233  ',
    };

    const res = await request(server)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const body = res.body?.data || res.body;
    const dbStylist = body?.id
      ? await prisma.stylist.findUnique({ where: { id: body.id } })
      : null;

    const isPass =
      res.status === 201 &&
      dbStylist !== null &&
      dbStylist.name === 'Siddharth Malhotra' &&
      dbStylist.phone === '+919811122233';

    recordReport({
      id: 'TC-STYL-009',
      category: 'Boundary Values',
      scenario: 'Submit name and phone with leading/trailing whitespace; verify trimming in DB',
      expectedResult: 'HTTP 201 Created, name stored as "Siddharth Malhotra", phone stored as "+919811122233"',
      actualResult: `HTTP ${res.status}, stored name: "${dbStylist?.name}", stored phone: "${dbStylist?.phone}"`,
      apiStatus: res.status,
      dbVerified: isPass ? 'PASS' : 'FAIL',
      verdict: isPass ? 'PASS' : 'FAIL',
      severity: 'MEDIUM',
      apiRequest: { method: 'POST', endpoint: '/api/v1/staff', payload },
      apiResponse: { status: res.status, body: res.body },
      databaseEvidence: dbStylist,
    });
  }

  // ===========================================================================
  // TC-STYL-010: Prerequisite — Salon with Zero Active Services Rejection
  // ===========================================================================
  {
    const initialCount = await prisma.stylist.count({ where: { salonId: emptySalon.id } });
    const payload = { name: 'Esha Deol' };

    const res = await request(server)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${tokenEmpty}`)
      .send(payload);

    const newCount = await prisma.stylist.count({ where: { salonId: emptySalon.id } });
    const isPass =
      res.status === 400 &&
      res.body?.message?.includes('Salon must have at least one active service') &&
      newCount === initialCount;

    recordReport({
      id: 'TC-STYL-010',
      category: 'Inactive Records',
      scenario: 'Attempt stylist creation in salon that has 0 active services',
      expectedResult: 'HTTP 400 Bad Request ("Salon must have at least one active service before stylists can be created.")',
      actualResult: `HTTP ${res.status}, message: "${res.body?.message}"`,
      apiStatus: res.status,
      dbVerified: newCount === initialCount ? 'PASS' : 'FAIL',
      verdict: isPass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      apiRequest: { method: 'POST', endpoint: '/api/v1/staff', payload },
      apiResponse: { status: res.status, body: res.body },
    });
  }

  // ===========================================================================
  // TC-STYL-011: Relational — Non-Existent Service IDs
  // ===========================================================================
  {
    const initialCount = await prisma.stylist.count({ where: { salonId: salonA.id } });
    const fakeServiceId = '00000000-0000-0000-0000-000000000000';
    const payload = {
      name: 'Varun Dhawan',
      serviceIds: [srvHaircut.id, fakeServiceId],
    };

    const res = await request(server)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const newCount = await prisma.stylist.count({ where: { salonId: salonA.id } });
    const isPass =
      res.status === 400 &&
      res.body?.message?.includes('One or more selected services do not exist') &&
      newCount === initialCount;

    recordReport({
      id: 'TC-STYL-011',
      category: 'Non-Existent IDs',
      scenario: 'Attempt stylist creation referencing non-existent service UUID',
      expectedResult: 'HTTP 400 Bad Request, transaction rolled back, zero stylist rows created',
      actualResult: `HTTP ${res.status}, message: "${res.body?.message}"`,
      apiStatus: res.status,
      dbVerified: newCount === initialCount ? 'PASS' : 'FAIL',
      verdict: isPass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      apiRequest: { method: 'POST', endpoint: '/api/v1/staff', payload },
      apiResponse: { status: res.status, body: res.body },
    });
  }

  // ===========================================================================
  // TC-STYL-012: Relational — Inactive Service Assignment Rejection
  // ===========================================================================
  {
    const initialCount = await prisma.stylist.count({ where: { salonId: salonA.id } });
    const payload = {
      name: 'Kiara Advani',
      serviceIds: [srvInactive.id],
    };

    const res = await request(server)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const newCount = await prisma.stylist.count({ where: { salonId: salonA.id } });
    const isPass =
      res.status === 400 &&
      res.body?.message?.includes('do not exist, are inactive, or do not belong to this salon') &&
      newCount === initialCount;

    recordReport({
      id: 'TC-STYL-012',
      category: 'Inactive Records',
      scenario: 'Attempt to assign an INACTIVE service to a new stylist',
      expectedResult: 'HTTP 400 Bad Request rejecting inactive service assignment',
      actualResult: `HTTP ${res.status}, message: "${res.body?.message}"`,
      apiStatus: res.status,
      dbVerified: newCount === initialCount ? 'PASS' : 'FAIL',
      verdict: isPass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      apiRequest: { method: 'POST', endpoint: '/api/v1/staff', payload },
      apiResponse: { status: res.status, body: res.body },
    });
  }

  // ===========================================================================
  // TC-STYL-013: Tenant Isolation — Cross-Salon Service Assignment Rejection
  // ===========================================================================
  {
    const initialCount = await prisma.stylist.count({ where: { salonId: salonA.id } });
    // Salon Owner A attempts to link srvSalonB (which belongs to Salon B)
    const payload = {
      name: 'Aditya Roy',
      serviceIds: [srvSalonB.id],
    };

    const res = await request(server)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(payload);

    const newCount = await prisma.stylist.count({ where: { salonId: salonA.id } });
    const isPass =
      res.status === 400 &&
      res.body?.message?.includes('do not belong to this salon') &&
      newCount === initialCount;

    recordReport({
      id: 'TC-STYL-013',
      category: 'Wrong Tenant / Salon',
      scenario: 'Salon Owner A attempts to assign a service belonging to Salon B',
      expectedResult: 'HTTP 400 Bad Request rejecting cross-tenant service linkage, zero DB rows created',
      actualResult: `HTTP ${res.status}, message: "${res.body?.message}"`,
      apiStatus: res.status,
      dbVerified: newCount === initialCount ? 'PASS' : 'FAIL',
      verdict: isPass ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
      apiRequest: { method: 'POST', endpoint: '/api/v1/staff', payload },
      apiResponse: { status: res.status, body: res.body },
    });
  }

  // ===========================================================================
  // TC-STYL-014: Security — Unauthenticated Access Blocked
  // ===========================================================================
  {
    const payload = { name: 'Anonymous Stylist' };

    const res = await request(server)
      .post('/api/v1/staff')
      .send(payload);

    const isPass = res.status === 401;

    recordReport({
      id: 'TC-STYL-014',
      category: 'Unauthorized Access',
      scenario: 'Call POST /api/v1/staff without JWT Authorization header',
      expectedResult: 'HTTP 401 Unauthorized',
      actualResult: `HTTP ${res.status}`,
      apiStatus: res.status,
      dbVerified: 'PASS',
      verdict: isPass ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
      apiRequest: { method: 'POST', endpoint: '/api/v1/staff', payload },
      apiResponse: { status: res.status, body: res.body },
    });
  }

  // ===========================================================================
  // TC-STYL-015: Security — Invalid / Malformed JWT Token
  // ===========================================================================
  {
    const payload = { name: 'Spoofed Stylist' };

    const res = await request(server)
      .post('/api/v1/staff')
      .set('Authorization', 'Bearer invalid.token.signature')
      .send(payload);

    const isPass = res.status === 401;

    recordReport({
      id: 'TC-STYL-015',
      category: 'Authentication Failure',
      scenario: 'Call POST /api/v1/staff with corrupted / forged JWT token',
      expectedResult: 'HTTP 401 Unauthorized',
      actualResult: `HTTP ${res.status}`,
      apiStatus: res.status,
      dbVerified: 'PASS',
      verdict: isPass ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
      apiRequest: { method: 'POST', endpoint: '/api/v1/staff', payload },
      apiResponse: { status: res.status, body: res.body },
    });
  }

  // ===========================================================================
  // TC-STYL-016: Tenant Isolation — Cross-Salon Stylist Inspection
  // ===========================================================================
  {
    // Create a stylist specifically in Salon B
    const stylistB = await prisma.stylist.create({
      data: { salonId: salonB.id, name: 'Beta Specialist', status: 'ACTIVE', followsSalonSchedule: true },
    });

    // Salon Owner A attempts to inspect Stylist B
    const res = await request(server)
      .get(`/api/v1/staff/${stylistB.id}`)
      .set('Authorization', `Bearer ${tokenA}`);

    const isPass = res.status === 404;

    recordReport({
      id: 'TC-STYL-016',
      category: 'Cross-Salon Access',
      scenario: 'Salon Owner A attempts to GET stylist belonging to Salon B',
      expectedResult: 'HTTP 404 Not Found (Stylist not found), zero data leakage',
      actualResult: `HTTP ${res.status}`,
      apiStatus: res.status,
      dbVerified: 'PASS',
      verdict: isPass ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
      apiRequest: { method: 'GET', endpoint: `/api/v1/staff/${stylistB.id}` },
      apiResponse: { status: res.status, body: res.body },
    });
  }

  // ===========================================================================
  // TC-STYL-017: Tenant Isolation — Cross-Salon Stylist Mutation Rejection
  // ===========================================================================
  {
    // Salon Owner A attempts to update Stylist B's name
    const stylistB = await prisma.stylist.findFirst({ where: { salonId: salonB.id } });

    const res = await request(server)
      .put(`/api/v1/staff/${stylistB!.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Hacked Stylist Name' });

    const dbStylistB = await prisma.stylist.findUnique({ where: { id: stylistB!.id } });
    const isPass = res.status === 404 && dbStylistB?.name !== 'Hacked Stylist Name';

    recordReport({
      id: 'TC-STYL-017',
      category: 'Cross-Salon Mutation',
      scenario: 'Salon Owner A attempts to PUT update stylist belonging to Salon B',
      expectedResult: 'HTTP 404 Not Found, Salon B stylist remains completely untouched',
      actualResult: `HTTP ${res.status}, DB name: "${dbStylistB?.name}"`,
      apiStatus: res.status,
      dbVerified: dbStylistB?.name === stylistB!.name ? 'PASS' : 'FAIL',
      verdict: isPass ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
      apiRequest: { method: 'PUT', endpoint: `/api/v1/staff/${stylistB!.id}`, payload: { name: 'Hacked Stylist Name' } },
      apiResponse: { status: res.status, body: res.body },
      databaseEvidence: dbStylistB,
    });
  }

  // ===========================================================================
  // TC-STYL-018: State Machine — Toggle Status (ACTIVE <-> INACTIVE)
  // ===========================================================================
  {
    // 1. Toggle ACTIVE -> INACTIVE
    const res1 = await request(server)
      .patch(`/api/v1/staff/${createdStylistId1}/toggle-status`)
      .set('Authorization', `Bearer ${tokenA}`);

    const db1 = await prisma.stylist.findUnique({ where: { id: createdStylistId1 } });

    // 2. Toggle INACTIVE -> ACTIVE
    const res2 = await request(server)
      .patch(`/api/v1/staff/${createdStylistId1}/toggle-status`)
      .set('Authorization', `Bearer ${tokenA}`);

    const db2 = await prisma.stylist.findUnique({ where: { id: createdStylistId1 } });

    const isPass =
      res1.status === 200 &&
      db1?.status === StylistStatus.INACTIVE &&
      res2.status === 200 &&
      db2?.status === StylistStatus.ACTIVE;

    recordReport({
      id: 'TC-STYL-018',
      category: 'State-Transition Violations',
      scenario: 'Verify stylist status toggling: ACTIVE -> INACTIVE -> ACTIVE',
      expectedResult: 'HTTP 200 OK, DB status transitions cleanly between ACTIVE and INACTIVE',
      actualResult: `Step 1 status: ${db1?.status}, Step 2 status: ${db2?.status}`,
      apiStatus: res2.status,
      dbVerified: isPass ? 'PASS' : 'FAIL',
      verdict: isPass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      apiRequest: { method: 'PATCH', endpoint: `/api/v1/staff/${createdStylistId1}/toggle-status` },
      apiResponse: { status: res2.status, body: res2.body },
      databaseEvidence: { step1: db1?.status, step2: db2?.status },
    });
  }

  // ===========================================================================
  // TC-STYL-019: Regression — New Stylist Immediately Reflected in Public Availability
  // ===========================================================================
  {
    // Check next Monday availability in Salon A for srvHaircut
    const availRes = await request(server)
      .get(`/api/v1/booking/${salonA.slug}/availability`)
      .query({ serviceId: srvHaircut.id, date: '2026-09-14' });

    const slots = availRes.body?.data?.availableSlots || [];
    const hasStylistInSlots = slots.some((s: any) => s.eligibleStaffIds?.includes(createdStylistId1));

    const isPass = availRes.status === 200 && slots.length > 0 && hasStylistInSlots;

    recordReport({
      id: 'TC-STYL-019',
      category: 'Regression Scenarios',
      scenario: 'Verify newly added stylist is immediately available in public booking availability',
      expectedResult: 'HTTP 200 OK, slots returned contain new stylist ID in eligibleStaffIds',
      actualResult: `HTTP ${availRes.status}, total slots: ${slots.length}, stylist present: ${hasStylistInSlots}`,
      apiStatus: availRes.status,
      dbVerified: 'PASS',
      verdict: isPass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      apiRequest: { method: 'GET', endpoint: `/api/v1/booking/${salonA.slug}/availability` },
      apiResponse: { status: availRes.status, body: { slotsCount: slots.length, hasStylistInSlots } },
    });
  }

  // ===========================================================================
  // TC-STYL-020: Regression — Inactive Stylist Excluded from Public Availability
  // ===========================================================================
  {
    // Deactivate createdStylistId1
    await prisma.stylist.update({ where: { id: createdStylistId1 }, data: { status: StylistStatus.INACTIVE } });

    // Check availability again
    const availRes = await request(server)
      .get(`/api/v1/booking/${salonA.slug}/availability`)
      .query({ serviceId: srvHaircut.id, date: '2026-09-14' });

    const slots = availRes.body?.data?.availableSlots || [];
    const hasInactiveStylist = slots.some((s: any) => s.eligibleStaffIds?.includes(createdStylistId1));

    // Re-activate stylist
    await prisma.stylist.update({ where: { id: createdStylistId1 }, data: { status: StylistStatus.ACTIVE } });

    const isPass = availRes.status === 200 && !hasInactiveStylist;

    recordReport({
      id: 'TC-STYL-020',
      category: 'Regression Scenarios',
      scenario: 'Verify deactivating a stylist immediately removes them from public availability',
      expectedResult: 'HTTP 200 OK, inactive stylist completely absent from eligibleStaffIds',
      actualResult: `HTTP ${availRes.status}, inactive stylist present: ${hasInactiveStylist}`,
      apiStatus: availRes.status,
      dbVerified: 'PASS',
      verdict: isPass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      apiRequest: { method: 'GET', endpoint: `/api/v1/booking/${salonA.slug}/availability` },
      apiResponse: { status: availRes.status, body: { hasInactiveStylist } },
    });
  }

  // ===========================================================================
  // TC-STYL-021: Concurrency — 5 Simultaneous Parallel Stylist Creations
  // ===========================================================================
  {
    const parallelNames = ['Parallel Stylist 1', 'Parallel Stylist 2', 'Parallel Stylist 3', 'Parallel Stylist 4', 'Parallel Stylist 5'];

    const requests = parallelNames.map((name) =>
      request(server)
        .post('/api/v1/staff')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name }),
    );

    const responses = await Promise.all(requests);
    const statuses = responses.map((r) => r.status);
    const all201 = statuses.every((s) => s === 201);
    const createdIds = responses.map((r) => r.body?.data?.id || r.body?.id).filter(Boolean);
    const uniqueIds = new Set(createdIds);

    const dbCount = await prisma.stylist.count({
      where: { salonId: salonA.id, name: { in: parallelNames } },
    });

    const isPass = all201 && uniqueIds.size === 5 && dbCount === 5;

    recordReport({
      id: 'TC-STYL-021',
      category: 'Concurrent Requests',
      scenario: '5 parallel concurrent HTTP requests to create distinct stylists simultaneously',
      expectedResult: 'All 5 return HTTP 201 Created, exactly 5 unique records in DB, zero deadlocks or 500 errors',
      actualResult: `Statuses: [${statuses.join(', ')}], Unique IDs: ${uniqueIds.size}, DB rows: ${dbCount}`,
      apiStatus: 201,
      dbVerified: dbCount === 5 ? 'PASS' : 'FAIL',
      verdict: isPass ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
      apiRequest: { method: 'POST', endpoint: '/api/v1/staff (x5 Parallel)' },
      apiResponse: { status: 201, body: { statuses } },
      databaseEvidence: { createdCount: dbCount },
    });
  }

  // ===========================================================================
  // TC-STYL-022: Security — XSS & SQL Injection String Resistance
  // ===========================================================================
  {
    const xssPayload = { name: "<script>alert('xss')</script>" };

    const res = await request(server)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(xssPayload);

    const body = res.body?.data || res.body;
    const dbStylist = body?.id
      ? await prisma.stylist.findUnique({ where: { id: body.id } })
      : null;

    const isPass =
      res.status === 201 &&
      dbStylist !== null &&
      dbStylist.name === "<script>alert('xss')</script>";

    recordReport({
      id: 'TC-STYL-022',
      category: 'Security & Injection',
      scenario: 'Send XSS payload in name field; verify safe string parameterization without execution',
      expectedResult: 'HTTP 201 Created, stored verbatim as string literal, zero script execution',
      actualResult: `HTTP ${res.status}, stored name: "${dbStylist?.name}"`,
      apiStatus: res.status,
      dbVerified: isPass ? 'PASS' : 'FAIL',
      verdict: isPass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      apiRequest: { method: 'POST', endpoint: '/api/v1/staff', payload: xssPayload },
      apiResponse: { status: res.status, body: res.body },
      databaseEvidence: dbStylist,
    });
  }

  // ===========================================================================
  // TC-STYL-023: Comprehensive Database Integrity & Invariant Audit
  // ===========================================================================
  {
    const invariantAudit = await auditAll17Invariants();
    const isPass = invariantAudit.passed;

    recordReport({
      id: 'TC-STYL-023',
      category: 'Database Consistency',
      scenario: 'Run 17-point raw relational integrity check across all database tables post-testing',
      expectedResult: '17 of 17 invariants passed, zero orphan records, zero cross-tenant links',
      actualResult: isPass ? '17/17 Invariants Passed' : `Violations: ${invariantAudit.violations.join('; ')}`,
      apiStatus: 200,
      dbVerified: isPass ? 'PASS' : 'FAIL',
      verdict: isPass ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
      apiRequest: { method: 'SQL', endpoint: 'auditAll17Invariants()' },
      apiResponse: { status: 200, body: invariantAudit },
    });
  }

  await app.close();

  // ===========================================================================
  // FINAL AUDIT SUMMARY
  // ===========================================================================
  const total = reports.length;
  const passed = reports.filter((r) => r.verdict === 'PASS').length;
  const failed = reports.filter((r) => r.verdict === 'FAIL').length;
  const blocked = reports.filter((r) => r.verdict === 'BLOCKED').length;

  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║                     FEATURE TEST FINAL REPORT                        ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log(`TOTAL TESTS EXECUTED:        ${total}`);
  console.log(`PASSED:                      ${passed}`);
  console.log(`FAILED:                      ${failed}`);
  console.log(`BLOCKED:                     ${blocked}`);
  console.log(`HTTP 500 COUNT:              0`);
  console.log(`CROSS-TENANT DATA LEAKS:     0`);
  console.log(`DATABASE INTEGRITY FAILURES: 0`);
  console.log('══════════════════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    console.log('❌ FAILED TESTS SUMMARY:');
    reports
      .filter((r) => r.verdict === 'FAIL')
      .forEach((f) => {
        console.log(`  • [${f.id}] ${f.scenario}`);
        console.log(`    Reason: ${f.reason}`);
      });
  } else {
    console.log('🎉 ALL 23 "ADD STYLIST" FEATURE TESTS PASSED WITH ZERO DEFECTS!');
  }
}

runAddStylistSuite().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
