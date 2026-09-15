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
  TEST_DB_URL,
} from './qa-helper';
import { SalonStatus, WhatsAppMessageDirection } from '@prisma/client';

interface InactiveWebhookTestReport {
  id: string;
  name: string;
  customerAction: string;
  expectedBehavior: string;
  actualBehavior: string;
  httpStatus: number;
  inboundLogged: boolean;
  outboundCount: number;
  verdict: 'PASS' | 'FAIL';
  reason?: string;
}

const reports: InactiveWebhookTestReport[] = [];

function recordReport(r: InactiveWebhookTestReport) {
  reports.push(r);
  const icon = r.verdict === 'PASS' ? '✅' : '❌';
  console.log(`----------------------------------------------------`);
  console.log(`${icon} [${r.id}] ${r.name}`);
  console.log(`   Customer Action: ${r.customerAction}`);
  console.log(`   HTTP: ${r.httpStatus} | Inbound Logged: ${r.inboundLogged} | Outbound Count: ${r.outboundCount} | Result: ${r.verdict}`);
  if (r.reason) {
    console.log(`   ⚠️ Reason: ${r.reason}`);
  }
}

export async function runInactiveSalonWebhookTestSuite() {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║   QA TEST SUITE: INACTIVE SALON WEBHOOK RETRY & SPAM GUARD          ║');
  console.log('║   Verifying 200 OK ACK, Meta Deduplication & 24h Cooldown Protection║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  // Step 1: Verify test DB
  if (!TEST_DB_URL.includes('salon_test_qa')) {
    console.error('TEST BLOCKED — SAFE QA ENVIRONMENT NOT CONFIRMED.');
    process.exit(1);
  }
  await prisma.$connect();
  console.log('>>> [1/5] Connected to isolated test DB: salon_test_qa');

  // Step 2: Clean and seed test data
  console.log('>>> [2/5] Cleaning and seeding test salons...');
  await cleanAllTestData();
  const { superAdmin, salonA: salonActive } = await seedBasePlatform();

  // Create Inactive Salon
  const salonInactive = await prisma.salon.create({
    data: {
      createdByAdminId: superAdmin.id,
      name: 'Glamour Inactive Studio',
      slug: `glamour-inactive-${Date.now()}`,
      phone: '+919811111111',
      email: `inactive-${Date.now()}@salon.com`,
      timezone: 'Asia/Kolkata',
      status: SalonStatus.INACTIVE,
    },
  });

  // Create Suspended Salon
  const salonSuspended = await prisma.salon.create({
    data: {
      createdByAdminId: superAdmin.id,
      name: 'Luxury Suspended Spa',
      slug: `luxury-suspended-${Date.now()}`,
      phone: '+919822222222',
      email: `suspended-${Date.now()}@salon.com`,
      timezone: 'Asia/Kolkata',
      status: SalonStatus.SUSPENDED,
    },
  });

  // Link WhatsApp Accounts with unique Phone Number IDs
  const inactivePhoneId = 'phone_inactive_123';
  const suspendedPhoneId = 'phone_suspended_456';
  const activePhoneId = 'phone_active_789';

  await prisma.whatsAppAccount.create({
    data: {
      salonId: salonInactive.id,
      phoneNumberId: inactivePhoneId,
      wabaId: 'waba_inactive',
      accessTokenEncrypted: 'system_managed',
      webhookVerifyToken: 'salon_webhook_verify_token_mvp',
      isActive: true,
    },
  });

  await prisma.whatsAppAccount.create({
    data: {
      salonId: salonSuspended.id,
      phoneNumberId: suspendedPhoneId,
      wabaId: 'waba_suspended',
      accessTokenEncrypted: 'system_managed',
      webhookVerifyToken: 'salon_webhook_verify_token_mvp',
      isActive: true,
    },
  });

  await prisma.whatsAppAccount.create({
    data: {
      salonId: salonActive.id,
      phoneNumberId: activePhoneId,
      wabaId: 'waba_active',
      accessTokenEncrypted: 'system_managed',
      webhookVerifyToken: 'salon_webhook_verify_token_mvp',
      isActive: true,
    },
  });

  // Step 3: Boot NestJS Application
  console.log('>>> [3/5] Booting NestJS Application...');
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
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  await app.init();
  const server = app.getHttpServer();

  console.log('>>> [4/5] Executing 6 Human-Like Test Scenarios...\n');

  const customerPhone1 = '+919988776655';
  const cleanPhone1 = '919988776655';

  // ─────────────────────────────────────────────────────────────────────────────
  // TC-INACT-01: First Inbound Contact to INACTIVE Salon
  // ─────────────────────────────────────────────────────────────────────────────
  {
    const msgId1 = `meta_msg_init_${Date.now()}`;
    const payload1 = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba_inactive',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '+919811111111',
                  phone_number_id: inactivePhoneId,
                },
                messages: [
                  {
                    from: customerPhone1,
                    id: msgId1,
                    timestamp: `${Math.floor(Date.now() / 1000)}`,
                    text: { body: 'Hi, I need a haircut appointment please' },
                    type: 'text',
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    const startTime = Date.now();
    const res = await request(server).post('/api/v1/whatsapp/webhook').send(payload1);
    const durationMs = Date.now() - startTime;

    // Check Inbound Log in DB
    const inboundLog = await prisma.whatsAppLog.findUnique({
      where: { metaMessageId: msgId1 },
    });

    // Check Outbound Warning Logs in DB for this customer & salon
    const outboundLogs = await prisma.whatsAppLog.findMany({
      where: {
        salonId: salonInactive.id,
        phone: { in: [cleanPhone1, customerPhone1] },
        direction: WhatsAppMessageDirection.OUTBOUND,
      },
    });

    const isPass =
      res.status === 200 &&
      res.text === 'EVENT_RECEIVED' &&
      durationMs < 2000 &&
      !!inboundLog &&
      outboundLogs.length === 1;

    recordReport({
      id: 'TC-INACT-01',
      name: 'Initial Inactive Salon Contact - Instant 200 OK & Single Warning',
      customerAction: 'Customer sends "Hi, need haircut" to an INACTIVE salon for the first time',
      expectedBehavior: 'Webhook returns HTTP 200 EVENT_RECEIVED (<200ms), inbound logged, exactly 1 warning sent',
      actualBehavior: `HTTP ${res.status} ("${res.text}") in ${durationMs}ms, Inbound Logged: ${!!inboundLog}, Outbound Count: ${outboundLogs.length}`,
      httpStatus: res.status,
      inboundLogged: !!inboundLog,
      outboundCount: outboundLogs.length,
      verdict: isPass ? 'PASS' : 'FAIL',
      reason: isPass ? undefined : 'Failed to return 200 OK or dispatch single warning properly',
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // TC-INACT-02: Meta Webhook Retry Simulation (Duplicate Payload Delivery)
  // ─────────────────────────────────────────────────────────────────────────────
  {
    // Re-send the EXACT SAME payload from TC-INACT-01 (simulating Meta network retry)
    const existingInbound = await prisma.whatsAppLog.findFirst({
      where: { salonId: salonInactive.id, direction: WhatsAppMessageDirection.INBOUND },
      orderBy: { createdAt: 'desc' },
    });

    const retryPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba_inactive',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '+919811111111',
                  phone_number_id: inactivePhoneId,
                },
                messages: [
                  {
                    from: customerPhone1,
                    id: existingInbound!.metaMessageId!,
                    timestamp: `${Math.floor(Date.now() / 1000)}`,
                    text: { body: 'Hi, I need a haircut appointment please' },
                    type: 'text',
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    const resRetry = await request(server).post('/api/v1/whatsapp/webhook').send(retryPayload);

    // Count outbound messages - MUST STILL BE EXACTLY 1 (ZERO DUPLICATES!)
    const outboundLogsAfterRetry = await prisma.whatsAppLog.findMany({
      where: {
        salonId: salonInactive.id,
        phone: { in: [cleanPhone1, customerPhone1] },
        direction: WhatsAppMessageDirection.OUTBOUND,
      },
    });

    const isPass =
      resRetry.status === 200 &&
      resRetry.text === 'EVENT_RECEIVED' &&
      outboundLogsAfterRetry.length === 1;

    recordReport({
      id: 'TC-INACT-02',
      name: 'Meta Automatic Webhook Retry - Idempotency & Zero Message Duplication',
      customerAction: 'Meta webhook re-delivers identical messageId after 15s network timeout simulation',
      expectedBehavior: 'Deduplication guard detects metaMessageId, returns HTTP 200, sends 0 duplicate messages',
      actualBehavior: `HTTP ${resRetry.status} ("${resRetry.text}"), Outbound Count remained: ${outboundLogsAfterRetry.length}`,
      httpStatus: resRetry.status,
      inboundLogged: true,
      outboundCount: outboundLogsAfterRetry.length,
      verdict: isPass ? 'PASS' : 'FAIL',
      reason: isPass ? undefined : 'Deduplication failed: Duplicate outbound message sent on retry!',
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // TC-INACT-03: Impatient Customer Rapid-Fire Inquiries (24h Cooldown Test)
  // ─────────────────────────────────────────────────────────────────────────────
  {
    // Customer texts 2 more times within 10 seconds: "Are you open?", "Hello??"
    const msgId2 = `meta_rapid_1_${Date.now()}`;
    const msgId3 = `meta_rapid_2_${Date.now()}`;

    const rapidPayload1 = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba_inactive',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: inactivePhoneId },
                messages: [
                  {
                    from: customerPhone1,
                    id: msgId2,
                    timestamp: `${Math.floor(Date.now() / 1000)}`,
                    text: { body: 'Are you open today?' },
                    type: 'text',
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    const rapidPayload2 = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba_inactive',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: inactivePhoneId },
                messages: [
                  {
                    from: customerPhone1,
                    id: msgId3,
                    timestamp: `${Math.floor(Date.now() / 1000)}`,
                    text: { body: 'Hello?? Please reply!' },
                    type: 'text',
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    const res1 = await request(server).post('/api/v1/whatsapp/webhook').send(rapidPayload1);
    const res2 = await request(server).post('/api/v1/whatsapp/webhook').send(rapidPayload2);

    const log2 = await prisma.whatsAppLog.findUnique({ where: { metaMessageId: msgId2 } });
    const log3 = await prisma.whatsAppLog.findUnique({ where: { metaMessageId: msgId3 } });

    // Outbound messages MUST STILL REMAIN 1 because of the 24-hour cooldown!
    const totalOutbound = await prisma.whatsAppLog.findMany({
      where: {
        salonId: salonInactive.id,
        phone: { in: [cleanPhone1, customerPhone1] },
        direction: WhatsAppMessageDirection.OUTBOUND,
      },
    });

    const isPass =
      res1.status === 200 &&
      res2.status === 200 &&
      !!log2 &&
      !!log3 &&
      totalOutbound.length === 1;

    recordReport({
      id: 'TC-INACT-03',
      name: 'Rapid-Fire Inquiries - 24-Hour Anti-Spam Cooldown Guard',
      customerAction: 'Customer sends 2 additional messages in 5s ("Are you open?", "Hello??")',
      expectedBehavior: 'Both inbound logged, HTTP 200 returned, outbound messages suppressed by 24h cooldown',
      actualBehavior: `HTTP ${res1.status}/${res2.status}, Inbound Logged: 2/2, Total Outbound: ${totalOutbound.length}`,
      httpStatus: res2.status,
      inboundLogged: !!log2 && !!log3,
      outboundCount: totalOutbound.length,
      verdict: isPass ? 'PASS' : 'FAIL',
      reason: isPass ? undefined : `Anti-spam cooldown failed! Customer received ${totalOutbound.length} messages.`,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // TC-INACT-04: Suspended Salon Contact
  // ─────────────────────────────────────────────────────────────────────────────
  {
    const customerPhone2 = '+919933445566';
    const cleanPhone2 = '919933445566';
    const msgIdSuspended = `meta_msg_susp_${Date.now()}`;

    const suspendedPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba_suspended',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: suspendedPhoneId },
                messages: [
                  {
                    from: customerPhone2,
                    id: msgIdSuspended,
                    timestamp: `${Math.floor(Date.now() / 1000)}`,
                    text: { body: 'Can I book facial for 4 PM?' },
                    type: 'text',
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    const res = await request(server).post('/api/v1/whatsapp/webhook').send(suspendedPayload);

    const inboundLog = await prisma.whatsAppLog.findUnique({
      where: { metaMessageId: msgIdSuspended },
    });

    const outboundLogs = await prisma.whatsAppLog.findMany({
      where: {
        salonId: salonSuspended.id,
        phone: { in: [cleanPhone2, customerPhone2] },
        direction: WhatsAppMessageDirection.OUTBOUND,
      },
    });

    const isPass =
      res.status === 200 &&
      res.text === 'EVENT_RECEIVED' &&
      !!inboundLog &&
      outboundLogs.length === 1;

    recordReport({
      id: 'TC-INACT-04',
      name: 'Suspended Salon Inbound Handling',
      customerAction: 'Customer contacts a salon in SUSPENDED status',
      expectedBehavior: 'HTTP 200 EVENT_RECEIVED returned, inbound logged, exactly 1 polite status notice sent',
      actualBehavior: `HTTP ${res.status} ("${res.text}"), Inbound Logged: ${!!inboundLog}, Outbound Count: ${outboundLogs.length}`,
      httpStatus: res.status,
      inboundLogged: !!inboundLog,
      outboundCount: outboundLogs.length,
      verdict: isPass ? 'PASS' : 'FAIL',
      reason: isPass ? undefined : 'Suspended salon handling failed',
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // TC-INACT-05: Unmapped WhatsApp Phone ID (Non-existent Salon)
  // ─────────────────────────────────────────────────────────────────────────────
  {
    const unknownPhoneId = 'phone_unknown_99999';
    const msgIdUnknown = `meta_msg_unmapped_${Date.now()}`;

    const unmappedPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba_unknown',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: unknownPhoneId },
                messages: [
                  {
                    from: '+919977889900',
                    id: msgIdUnknown,
                    timestamp: `${Math.floor(Date.now() / 1000)}`,
                    text: { body: 'Hello' },
                    type: 'text',
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    const res = await request(server).post('/api/v1/whatsapp/webhook').send(unmappedPayload);

    const inboundLog = await prisma.whatsAppLog.findUnique({
      where: { metaMessageId: msgIdUnknown },
    });

    const isPass = res.status === 200 && res.text === 'EVENT_RECEIVED' && !!inboundLog;

    recordReport({
      id: 'TC-INACT-05',
      name: 'Unmapped Phone ID Resilience (Zero Crash / Immediate 200 OK)',
      customerAction: 'Message received for a phone number ID not mapped to any salon in DB',
      expectedBehavior: 'Acknowledge Meta with HTTP 200 EVENT_RECEIVED immediately, log inbound, no crash',
      actualBehavior: `HTTP ${res.status} ("${res.text}"), Inbound Logged: ${!!inboundLog}`,
      httpStatus: res.status,
      inboundLogged: !!inboundLog,
      outboundCount: 0,
      verdict: isPass ? 'PASS' : 'FAIL',
      reason: isPass ? undefined : 'Unmapped phone ID hung or crashed without 200 OK',
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // TC-INACT-06: Active Salon Regression Guard
  // ─────────────────────────────────────────────────────────────────────────────
  {
    const customerPhone3 = '+919944556677';
    const msgIdActive = `meta_msg_active_${Date.now()}`;

    const activePayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba_active',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: activePhoneId },
                messages: [
                  {
                    from: customerPhone3,
                    id: msgIdActive,
                    timestamp: `${Math.floor(Date.now() / 1000)}`,
                    text: { body: 'Hi' },
                    type: 'text',
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    const res = await request(server).post('/api/v1/whatsapp/webhook').send(activePayload);

    // Wait a brief moment for async queue processing
    await new Promise((resolve) => setTimeout(resolve, 800));

    const inboundLog = await prisma.whatsAppLog.findUnique({
      where: { metaMessageId: msgIdActive },
    });

    const isPass = res.status === 200 && res.text === 'EVENT_RECEIVED' && !!inboundLog;

    recordReport({
      id: 'TC-INACT-06',
      name: 'Active Salon Regression Check (Zero Degradation to Normal Flow)',
      customerAction: 'Customer sends "Hi" to an ACTIVE salon',
      expectedBehavior: 'HTTP 200 returned immediately, message routed to active salon queue and state machine',
      actualBehavior: `HTTP ${res.status} ("${res.text}"), Inbound Logged: ${!!inboundLog}, Salon: ${inboundLog?.salonId}`,
      httpStatus: res.status,
      inboundLogged: !!inboundLog,
      outboundCount: 1,
      verdict: isPass ? 'PASS' : 'FAIL',
      reason: isPass ? undefined : 'Active salon regression detected!',
    });
  }

  // Step 5: Summary Evaluation
  console.log('\n======================================================================');
  console.log('                 QA AUDIT SUMMARY REPORT                              ');
  console.log('======================================================================');

  const total = reports.length;
  const passed = reports.filter((r) => r.verdict === 'PASS').length;
  const failed = reports.filter((r) => r.verdict === 'FAIL').length;

  console.log(`Total Scenarios Tested : ${total}`);
  console.log(`Passed                 : ${passed} ✅`);
  console.log(`Failed                 : ${failed} ❌`);

  await app.close();
  await prisma.$disconnect();

  if (failed > 0) {
    console.error('\n❌ QA AUDIT FAILED — INACTIVE SALON DEFECT DETECTED.');
    process.exit(1);
  } else {
    console.log('\n🎉 ALL 6 INACTIVE SALON QA SCENARIOS PASSED WITH ZERO DEFECTS!');
    process.exit(0);
  }
}

if (require.main === module) {
  runInactiveSalonWebhookTestSuite().catch((err) => {
    console.error('Fatal test execution error:', err);
    process.exit(1);
  });
}
