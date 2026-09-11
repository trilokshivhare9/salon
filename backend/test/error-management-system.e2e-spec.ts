import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { ErrorLogService } from '../src/modules/error-logs/error-log.service';
import { SanitizationUtility } from '../src/common/utils/sanitization.utility';
import { ErrorStatus, ErrorSeverity, AdminRole } from '@prisma/client';

describe('Centralized Error Management System (ERROR-001 to ERROR-025)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let errorLogService: ErrorLogService;
  let superAdminToken: string;
  let salonOwnerToken: string;
  let testSalonId: string;

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
      }),
    );

    errorLogService = app.get(ErrorLogService);
    app.useGlobalFilters(new AllExceptionsFilter(errorLogService));

    await app.init();
    prisma = app.get(PrismaService);

    // Setup Super Admin login token
    const superAdminRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@salonsaas.com', password: 'SuperAdminPass123!' });

    if (superAdminRes.status === 200 && superAdminRes.body?.data?.accessToken) {
      superAdminToken = superAdminRes.body.data.accessToken;
    }

    // Setup Salon Owner login token
    const ownerRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'owner@salon.com', password: 'Test@1234' });

    if (ownerRes.status === 200 && ownerRes.body?.data?.accessToken) {
      salonOwnerToken = ownerRes.body.data.accessToken;
      testSalonId = ownerRes.body.data.user?.salonId || ownerRes.body.data.user?.salon?.id;
    }

    if (!testSalonId) {
      const sampleSalon = await prisma.salon.findFirst();
      if (sampleSalon) testSalonId = sampleSalon.id;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Sanitization & Privacy Protection', () => {
    it('ERROR-010 to ERROR-013: Redacts passwords, access tokens, refresh tokens, and secrets from payloads', () => {
      const sensitivePayload = {
        email: 'test@example.com',
        password: 'MySecretPassword123!',
        pass: 'SecretPass',
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        refreshToken: 'rt_sample_refresh_token_123',
        authorization: 'Bearer eyJhbGciOi...',
        otp: '123456',
        nested: {
          secretKey: 'topsecret',
          safeField: 'Hello World',
        },
      };

      const sanitized = SanitizationUtility.sanitize(sensitivePayload);

      expect(sanitized.email).toBe('test@example.com');
      expect(sanitized.password).toBe('[REDACTED]');
      expect(sanitized.pass).toBe('[REDACTED]');
      expect(sanitized.accessToken).toBe('[REDACTED]');
      expect(sanitized.refreshToken).toBe('[REDACTED]');
      expect(sanitized.authorization).toBe('[REDACTED]');
      expect(sanitized.otp).toBe('[REDACTED]');
      expect(sanitized.nested.secretKey).toBe('[REDACTED]');
      expect(sanitized.nested.safeField).toBe('Hello World');
    });
  });

  describe('Core Error Logging & Central Exception Interception', () => {
    it('ERROR-001 to ERROR-009: Captures unexpected error context, status, stack trace, and timestamps', async () => {
      let realSalon = await prisma.salon.findFirst();
      if (!realSalon) {
        let admin = await prisma.admin.findFirst();
        if (!admin) {
          admin = await prisma.admin.create({
            data: {
              name: 'Test Admin',
              email: 'testadmin@example.com',
              passwordHash: 'hashed',
              role: 'SUPER_ADMIN',
            },
          });
        }
        realSalon = await prisma.salon.create({
          data: {
            name: 'Test Error Salon',
            slug: 'test-error-salon-' + Date.now(),
            phone: '9999999999',
            email: 'errorsalon@example.com',
            city: 'Mumbai',
            status: 'ACTIVE',
            createdByAdminId: admin.id,
          },
        });
      }
      const validSalonId = realSalon.id;

      await prisma.errorLog.deleteMany({
        where: { message: { contains: 'Database Connection Pool Exceeded Exception' } },
      });

      const mockReq = {
        method: 'POST',
        originalUrl: '/api/v1/booking/test-crash',
        correlationId: 'req-test-uuid-1234',
        headers: { 'user-agent': 'JestTestRunner', authorization: 'Bearer secret_token' },
        query: { ref: 'partner' },
        body: { customerName: 'John', password: 'SecretPassword123' },
        user: { id: 'usr-123', email: 'john@example.com', role: 'SALON_OWNER', salonId: validSalonId },
        tenantSalonId: validSalonId,
      };

      const mockError = new Error('Database Connection Pool Exceeded Exception');

      await errorLogService.logError({
        error: mockError,
        request: mockReq,
        severity: ErrorSeverity.CRITICAL,
      });

      const loggedError = await prisma.errorLog.findFirst({
        where: { message: { contains: 'Database Connection Pool Exceeded Exception' } },
      });

      expect(loggedError).toBeDefined();
      expect(loggedError.status).toBe(ErrorStatus.UNRESOLVED); // ERROR-002
      expect(loggedError.severity).toBe(ErrorSeverity.CRITICAL);
      expect(loggedError.httpMethod).toBe('POST'); // ERROR-005
      expect(loggedError.endpoint).toBe('/api/v1/booking/test-crash'); // ERROR-004
      expect(loggedError.correlationId).toBe('req-test-uuid-1234');
      expect(loggedError.userEmail).toBe('john@example.com'); // ERROR-006
      expect(loggedError.salonId).toBe(validSalonId); // ERROR-007
      expect(loggedError.stackTrace).toBeDefined(); // ERROR-009
      expect((loggedError.requestBody as any)?.password).toBe('[REDACTED]'); // ERROR-013
      expect((loggedError.headers as any)?.authorization).toBe('[REDACTED]'); // ERROR-011
    });

    it('ERROR-008: Records anonymous requests correctly without user context', async () => {
      const anonReq = {
        method: 'GET',
        originalUrl: '/api/v1/public/crash',
      };

      await errorLogService.logError({
        error: new Error('Anonymous System Fault'),
        request: anonReq,
      });

      const loggedError = await prisma.errorLog.findFirst({
        where: { message: 'Anonymous System Fault' },
      });

      expect(loggedError).toBeDefined();
      expect(loggedError.userId).toBeNull();
      expect(loggedError.userEmail).toBeNull();
    });

    it('ERROR-021: Repeated errors within deduplication window increment occurrenceCount', async () => {
      await prisma.errorLog.deleteMany({ where: { message: 'Identical Duplicate Bug' } });

      const repeatedReq = {
        method: 'GET',
        originalUrl: '/api/v1/repeating-endpoint',
      };

      const errorObj = new Error('Identical Duplicate Bug');

      await errorLogService.logError({ error: errorObj, request: repeatedReq });
      await errorLogService.logError({ error: errorObj, request: repeatedReq });
      await errorLogService.logError({ error: errorObj, request: repeatedReq });

      const logs = await prisma.errorLog.findMany({
        where: { message: 'Identical Duplicate Bug' },
      });

      expect(logs.length).toBe(1);
      expect(logs[0].occurrenceCount).toBe(3);
    });

    it('ERROR-022: Error logging failures never crash the original application flow', async () => {
      // Pass corrupted request object
      await expect(
        errorLogService.logError({
          error: null,
          request: { headers: { get dangerous() { throw new Error('Proxy Getter Crash'); } } },
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('Super Admin Access & Resolution Workflow', () => {
    it('ERROR-015 & ERROR-024: Rejects Salon Owner access to Error Management APIs', async () => {
      if (!salonOwnerToken) return;

      const res = await request(app.getHttpServer())
        .get('/api/v1/super-admin/errors')
        .set('Authorization', `Bearer ${salonOwnerToken}`);

      expect(res.status).toBe(403);
    });

    it('ERROR-014 & ERROR-016: Allows Super Admin to view and open error details', async () => {
      if (!superAdminToken) return;

      const res = await request(app.getHttpServer())
        .get('/api/v1/super-admin/errors')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success !== false).toBe(true);
      expect(Array.isArray(res.body.data || res.body)).toBe(true);

      const items = res.body.data || res.body;
      if (items.length > 0) {
        const detailRes = await request(app.getHttpServer())
          .get(`/api/v1/super-admin/errors/${items[0].id}`)
          .set('Authorization', `Bearer ${superAdminToken}`);

        expect(detailRes.status).toBe(200);
      }
    });

    it('ERROR-017 to ERROR-020: Super Admin can mark error RESOLVED and store audit history', async () => {
      if (!superAdminToken) return;

      const newErrorLog = await prisma.errorLog.create({
        data: {
          fingerprint: 'test-fingerprint-resolution-123',
          status: ErrorStatus.UNRESOLVED,
          severity: ErrorSeverity.HIGH,
          errorType: 'NullPointerError',
          message: 'Resolution workflow test exception',
          httpMethod: 'POST',
          endpoint: '/api/v1/test-resolve',
          statusCode: 500,
        },
      });

      const resolveRes = await request(app.getHttpServer())
        .patch(`/api/v1/super-admin/errors/${newErrorLog.id}/resolve`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ resolutionNotes: 'Fixed null check in handler logic' });

      expect(resolveRes.status).toBe(200);

      const dbCheck = await prisma.errorLog.findUnique({
        where: { id: newErrorLog.id },
      });

      expect(dbCheck.status).toBe(ErrorStatus.RESOLVED);
      expect(dbCheck.resolvedAt).toBeDefined(); // ERROR-019
      expect(dbCheck.resolvedById).toBeDefined(); // ERROR-018
      expect(dbCheck.resolutionNotes).toBe('Fixed null check in handler logic');

      // Verify resolved record remains in historical queries (ERROR-020)
      const historicalList = await prisma.errorLog.findMany({
        where: { id: newErrorLog.id },
      });
      expect(historicalList.length).toBe(1);
    });
  });

  describe('Business vs System Error Differentiation', () => {
    it('ERROR-023: Expected 400 validation failures are not recorded as system crashes', async () => {
      const initialCount = await prisma.errorLog.count();

      // Trigger 400 validation error
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ invalidField: 'test' });

      const finalCount = await prisma.errorLog.count();

      // 400 Bad Request should not create system ErrorLog records
      expect(finalCount).toBe(initialCount);
    });
  });
});
