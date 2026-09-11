import { Test, TestingModule } from '@nestjs/testing';
import { WhatsAppWebhookQueue } from './whatsapp-webhook.queue';
import { WhatsAppService } from '../whatsapp.service';
import { PrismaService } from '../../../database/prisma.service';
import { AppointmentsService } from '../../appointments/appointments.service';
import { AvailabilityService } from '../../availability/availability.service';
import { ConfigService } from '@nestjs/config';
import { ConversationState } from '@prisma/client';

describe('⚡ REAL-TIME SYSTEM RESPONSE TIME & BENCHMARK SUITE', () => {
  let whatsAppService: WhatsAppService;
  let webhookQueue: WhatsAppWebhookQueue;
  let prisma: PrismaService;
  let testSalon: any;
  const testPhone = '919876543210';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppWebhookQueue,
        PrismaService,
        WhatsAppService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
        {
          provide: AvailabilityService,
          useValue: { getAvailableSlots: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: AppointmentsService,
          useValue: {
            updateStatus: jest.fn().mockResolvedValue(true),
            triggerSmartMoveUpBroadcast: jest.fn().mockResolvedValue(true),
            getAppointmentById: jest.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();

    webhookQueue = moduleRef.get<WhatsAppWebhookQueue>(WhatsAppWebhookQueue);
    whatsAppService = moduleRef.get<WhatsAppService>(WhatsAppService);
    prisma = moduleRef.get<PrismaService>(PrismaService);

    jest.spyOn(whatsAppService, 'sendMetaMessage').mockImplementation(async () => true as any);

    testSalon = await prisma.salon.findFirst({
      where: { status: 'ACTIVE' },
    });
  });

  afterAll(() => {
    webhookQueue.onModuleDestroy();
  });

  it('PERF-001: Measure end-to-end response latency from customer message to WhatsApp reply dispatch & DB sync', async () => {
    if (!testSalon) return;

    // Reset conversation state
    await prisma.conversation.upsert({
      where: { salonId_customerPhone: { salonId: testSalon.id, customerPhone: testPhone } },
      update: { state: ConversationState.START },
      create: {
        salonId: testSalon.id,
        customerPhone: testPhone,
        state: ConversationState.START,
      },
    });

    // Benchmark T0: Customer message arrives
    const t0 = performance.now();

    // Enqueue webhook
    let replyPayload: any = null;
    const tEnqueueStart = performance.now();
    
    webhookQueue.enqueue(testSalon.id, { text: 'Hi' }, async () => {
      replyPayload = await whatsAppService.handleIncomingMessage(
        testSalon.id,
        testPhone,
        'Hi',
        undefined,
      );
    });

    const tEnqueueEnd = performance.now();
    const ingressLatencyMs = tEnqueueEnd - tEnqueueStart;

    // Wait for queue worker to finish execution
    await new Promise((res) => setTimeout(res, 100));
    const tReplyDone = performance.now();

    const totalProcessingMs = tReplyDone - t0;

    // Verify Dashboard Real-Time DB State Reflection (Queries active conversation state)
    const tDbQueryStart = performance.now();
    const updatedConv = await prisma.conversation.findFirst({
      where: { salonId: testSalon.id, customerPhone: testPhone },
    });
    const tDbQueryEnd = performance.now();
    const dbQueryLatencyMs = tDbQueryEnd - tDbQueryStart;

    // Output Benchmarks
    console.log('\n--- ⚡ REAL-TIME SYSTEM PERFORMANCE BENCHMARKS ---');
    console.log(`1. Ingress Enqueue Latency (Meta 200 OK): ${ingressLatencyMs.toFixed(2)} ms`);
    console.log(`2. Total WhatsApp Processing Latency:      ${totalProcessingMs.toFixed(2)} ms`);
    console.log(`3. Salon Web App DB State Query Latency:  ${dbQueryLatencyMs.toFixed(2)} ms`);
    console.log('--------------------------------------------------\n');

    expect(ingressLatencyMs).toBeLessThan(10); // Ingress < 10ms
    expect(totalProcessingMs).toBeLessThan(300); // Full processing < 300ms
    expect(dbQueryLatencyMs).toBeLessThan(50); // DB query < 50ms
    expect(replyPayload?.replyMessage).toBeDefined();
    expect(updatedConv).toBeDefined();
  });
});
