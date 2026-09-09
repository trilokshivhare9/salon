import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { TenantContextGuard } from '../src/modules/auth/guards/tenant-context.guard';
import { AdminRole, SalonStatus, AdminStatus } from '@prisma/client';
import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

export interface TestResult {
  id: number;
  testName: string;
  expectedResult: string;
  actualResult: string;
  verdict: 'PASS' | 'FAIL';
}

function mockExecutionContext(req: any): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
    getHandler: () => (() => {}),
    getClass: () => (class {}),
    getArgs: () => [],
    getArgByIndex: () => ({}),
    switchToRpc: () => ({}) as any,
    switchToWs: () => ({}) as any,
    getType: () => 'http',
  } as unknown as ExecutionContext;
}

async function runTenantIsolationVerificationSuite() {
  console.log('================================================================');
  console.log('🛡️ TENANT ISOLATION & IDOR SECURITY TEST SUITE');
  console.log('   Architecture: Dual-Domain Authorization + TenantContextGuard');
  console.log('================================================================\n');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);
  const reflector = app.get(Reflector);
  const guard = new TenantContextGuard(prisma, reflector);

  const results: TestResult[] = [];

  function record(result: TestResult) {
    results.push(result);
    const icon = result.verdict === 'PASS' ? '✅' : '❌';
    console.log(`[Test ${result.id.toString().padStart(2, '0')}] ${icon} ${result.testName} -> ${result.actualResult} (${result.verdict})`);
  }

  try {
    const passwordHash = await bcrypt.hash('Password123!', 10);
    const timestamp = Date.now();

    const superAdmin = await prisma.admin.create({
      data: {
        name: 'Super Admin Test',
        email: `superadmin-${timestamp}@salonsaas.com`,
        passwordHash,
        role: AdminRole.SUPER_ADMIN,
        status: AdminStatus.ACTIVE,
      },
    });

    // 1. Fixtures: Salon A & Salon B
    const salonA = await prisma.salon.create({
      data: {
        createdByAdminId: superAdmin.id,
        name: `Tenant Test Salon A ${timestamp}`,
        slug: `tenant-a-${timestamp}`,
        email: `tenant-a-${timestamp}@salonsaas.com`,
        phone: `+91${Math.floor(1000000000 + Math.random() * 9000000000)}`,
        status: SalonStatus.ACTIVE,
      },
    });

    const salonB = await prisma.salon.create({
      data: {
        createdByAdminId: superAdmin.id,
        name: `Tenant Test Salon B ${timestamp}`,
        slug: `tenant-b-${timestamp}`,
        email: `tenant-b-${timestamp}@salonsaas.com`,
        phone: `+91${Math.floor(1000000000 + Math.random() * 9000000000)}`,
        status: SalonStatus.ACTIVE,
      },
    });

    const deactivatedSalon = await prisma.salon.create({
      data: {
        createdByAdminId: superAdmin.id,
        name: `Deactivated Salon ${timestamp}`,
        slug: `tenant-deact-${timestamp}`,
        email: `tenant-deact-${timestamp}@salonsaas.com`,
        phone: `+91${Math.floor(1000000000 + Math.random() * 9000000000)}`,
        status: SalonStatus.DEACTIVATED,
      },
    });

    const adminOwnerA = await prisma.admin.create({
      data: {
        salonId: salonA.id,
        name: 'Owner Salon A',
        email: `owner-a-${timestamp}@salonsaas.com`,
        passwordHash,
        role: AdminRole.SALON_OWNER,
        status: AdminStatus.ACTIVE,
      },
    });

    // TEST 1: Salon A owner accessing Salon A -> allowed
    try {
      const req: any = { user: adminOwnerA, headers: {}, params: {} };
      const can = await guard.canActivate(mockExecutionContext(req));
      record({
        id: 1,
        testName: 'Salon A owner accessing Salon A context',
        expectedResult: 'Allowed, tenantSalonId set to salonA.id',
        actualResult: `canActivate=${can}, tenantSalonId=${req.tenantSalonId}`,
        verdict: can && req.tenantSalonId === salonA.id ? 'PASS' : 'FAIL',
      });
    } catch (e: any) {
      record({
        id: 1,
        testName: 'Salon A owner accessing Salon A context',
        expectedResult: 'Allowed',
        actualResult: `Error: ${e.message}`,
        verdict: 'FAIL',
      });
    }

    // TEST 2: Salon A owner attempting to access Salon B via X-Salon-Id header -> rejected
    try {
      const req: any = { user: adminOwnerA, headers: { 'x-salon-id': salonB.id }, params: {} };
      await guard.canActivate(mockExecutionContext(req));
      record({
        id: 2,
        testName: 'Salon A owner sending X-Salon-Id for Salon B',
        expectedResult: 'ForbiddenException',
        actualResult: 'Request allowed unexpectedly',
        verdict: 'FAIL',
      });
    } catch (e: any) {
      const pass = e instanceof ForbiddenException;
      record({
        id: 2,
        testName: 'Salon A owner sending X-Salon-Id for Salon B',
        expectedResult: 'ForbiddenException',
        actualResult: `Caught ${e.constructor.name}: ${e.message}`,
        verdict: pass ? 'PASS' : 'FAIL',
      });
    }

    // TEST 3: Salon A owner manipulating URL route param salonId to Salon B -> rejected
    try {
      const req: any = { user: adminOwnerA, headers: {}, params: { salonId: salonB.id } };
      await guard.canActivate(mockExecutionContext(req));
      record({
        id: 3,
        testName: 'Salon A owner manipulating URL route param salonId',
        expectedResult: 'ForbiddenException',
        actualResult: 'Request allowed unexpectedly',
        verdict: 'FAIL',
      });
    } catch (e: any) {
      const pass = e instanceof ForbiddenException;
      record({
        id: 3,
        testName: 'Salon A owner manipulating URL route param salonId',
        expectedResult: 'ForbiddenException',
        actualResult: `Caught ${e.constructor.name}: ${e.message}`,
        verdict: pass ? 'PASS' : 'FAIL',
      });
    }

    // TEST 4: Salon A owner sending conflicting tenant identifiers (Header=Salon B, Param=Salon A) -> rejected
    try {
      const req: any = { user: adminOwnerA, headers: { 'x-salon-id': salonB.id }, params: { salonId: salonA.id } };
      await guard.canActivate(mockExecutionContext(req));
      record({
        id: 4,
        testName: 'Salon A owner sending conflicting tenant identifiers',
        expectedResult: 'ForbiddenException',
        actualResult: 'Request allowed unexpectedly',
        verdict: 'FAIL',
      });
    } catch (e: any) {
      const pass = e instanceof ForbiddenException;
      record({
        id: 4,
        testName: 'Salon A owner sending conflicting tenant identifiers',
        expectedResult: 'ForbiddenException',
        actualResult: `Caught ${e.constructor.name}: ${e.message}`,
        verdict: pass ? 'PASS' : 'FAIL',
      });
    }

    // TEST 5: Super Admin accessing platform route without tenant context -> allowed
    try {
      const req: any = { user: superAdmin, headers: {}, params: {} };
      const can = await guard.canActivate(mockExecutionContext(req));
      record({
        id: 5,
        testName: 'Super Admin accessing platform route without tenant context',
        expectedResult: 'Allowed with tenantSalonId=undefined',
        actualResult: `canActivate=${can}, tenantSalonId=${req.tenantSalonId}`,
        verdict: can && req.tenantSalonId === undefined ? 'PASS' : 'FAIL',
      });
    } catch (e: any) {
      record({
        id: 5,
        testName: 'Super Admin accessing platform route without tenant context',
        expectedResult: 'Allowed',
        actualResult: `Error: ${e.message}`,
        verdict: 'FAIL',
      });
    }

    // TEST 6: Super Admin switching to valid Salon B context via X-Salon-Id -> allowed
    try {
      const req: any = { user: superAdmin, headers: { 'x-salon-id': salonB.id }, params: {} };
      const can = await guard.canActivate(mockExecutionContext(req));
      record({
        id: 6,
        testName: 'Super Admin switching to valid Salon B context via X-Salon-Id',
        expectedResult: 'Allowed, tenantSalonId set to salonB.id',
        actualResult: `canActivate=${can}, tenantSalonId=${req.tenantSalonId}`,
        verdict: can && req.tenantSalonId === salonB.id ? 'PASS' : 'FAIL',
      });
    } catch (e: any) {
      record({
        id: 6,
        testName: 'Super Admin switching to valid Salon B context via X-Salon-Id',
        expectedResult: 'Allowed',
        actualResult: `Error: ${e.message}`,
        verdict: 'FAIL',
      });
    }

    // TEST 7: Super Admin using nonexistent salon ID -> rejected with NotFoundException
    try {
      const fakeUuid = '00000000-0000-0000-0000-000000000000';
      const req: any = { user: superAdmin, headers: { 'x-salon-id': fakeUuid }, params: {} };
      await guard.canActivate(mockExecutionContext(req));
      record({
        id: 7,
        testName: 'Super Admin using nonexistent salon ID',
        expectedResult: 'NotFoundException',
        actualResult: 'Request allowed unexpectedly',
        verdict: 'FAIL',
      });
    } catch (e: any) {
      const pass = e instanceof NotFoundException;
      record({
        id: 7,
        testName: 'Super Admin using nonexistent salon ID',
        expectedResult: 'NotFoundException',
        actualResult: `Caught ${e.constructor.name}: ${e.message}`,
        verdict: pass ? 'PASS' : 'FAIL',
      });
    }

    // TEST 8: Super Admin using deactivated salon -> rejected with ForbiddenException
    try {
      const req: any = { user: superAdmin, headers: { 'x-salon-id': deactivatedSalon.id }, params: {} };
      await guard.canActivate(mockExecutionContext(req));
      record({
        id: 8,
        testName: 'Super Admin using deactivated salon ID',
        expectedResult: 'ForbiddenException',
        actualResult: 'Request allowed unexpectedly',
        verdict: 'FAIL',
      });
    } catch (e: any) {
      const pass = e instanceof ForbiddenException;
      record({
        id: 8,
        testName: 'Super Admin using deactivated salon ID',
        expectedResult: 'ForbiddenException',
        actualResult: `Caught ${e.constructor.name}: ${e.message}`,
        verdict: pass ? 'PASS' : 'FAIL',
      });
    }

    // Cleanup test fixtures (delete salons first to respect createdByAdminId FK constraint)
    await prisma.admin.deleteMany({ where: { id: adminOwnerA.id } });
    await prisma.salon.deleteMany({
      where: { id: { in: [salonA.id, salonB.id, deactivatedSalon.id] } },
    });
    await prisma.admin.deleteMany({ where: { id: superAdmin.id } });

  } catch (error: any) {
    console.error('Fatal error during tenant isolation test execution:', error);
  } finally {
    await app.close();
  }

  const passedCount = results.filter((r) => r.verdict === 'PASS').length;
  const totalCount = results.length;

  console.log('\n================================================================');
  console.log('📊 TENANT ISOLATION TEST MATRIX SUMMARY');
  console.log('================================================================');
  console.log(`Total Scenarios Tested: ${totalCount}`);
  console.log(`Passed:                ${passedCount} ✅`);
  console.log(`Failed:                ${totalCount - passedCount} ❌`);
  console.log(`System Status:         ${passedCount === totalCount ? 'IDOR SECURE' : 'VULNERABILITIES DETECTED'}`);
  console.log('================================================================\n');

  if (passedCount !== totalCount) {
    process.exit(1);
  }
}

runTenantIsolationVerificationSuite().catch((err) => {
  console.error('Unhandled error in tenant isolation suite:', err);
  process.exit(1);
});
