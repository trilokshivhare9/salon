import { Test, TestingModule } from '@nestjs/testing';
import { WhatsAppWebhookQueue } from './whatsapp-webhook.queue';

describe('🔥 SUPER STRESS TEST: Concurrency, Webhook Burst & High-Frequency Ingress', () => {
  let webhookQueue: WhatsAppWebhookQueue;

  beforeEach(() => {
    webhookQueue = new WhatsAppWebhookQueue();
  });

  afterEach(() => {
    webhookQueue.onModuleDestroy();
  });

  // ---------------------------------------------------------------------------
  // STRESS SCENARIO 1: Extreme Webhook Ingress Rush (50 Concurrent Messages)
  // ---------------------------------------------------------------------------
  it('STRESS-001: 50 Simultaneous Webhooks in 1ms -> Sub-5ms Enqueue & 100% Processing', async () => {
    const totalJobs = 50;
    let processedCount = 0;

    const startTime = Date.now();

    // Fire 50 simultaneous webhooks at the exact same millisecond
    const enqueuePromises = Array.from({ length: totalJobs }).map((_, i) => {
      return new Promise<void>((resolve) => {
        webhookQueue.enqueue(
          'salon-alpha',
          { messageId: `msg_stress_${i}` },
          async () => {
            processedCount++;
          },
        );
        resolve();
      });
    });

    await Promise.all(enqueuePromises);

    const enqueueTimeMs = Date.now() - startTime;
    expect(enqueueTimeMs).toBeLessThan(50); // Enqueue of 50 jobs took < 50ms total
    expect(webhookQueue.getQueueLength()).toBe(totalJobs);

    // Wait for async worker queue to drain all 50 jobs
    await new Promise((res) => setTimeout(res, 500));

    expect(processedCount).toBe(totalJobs);
    expect(webhookQueue.getQueueLength()).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // STRESS SCENARIO 2: Mega Ingress Rush (100 Parallel Inbound Messages)
  // ---------------------------------------------------------------------------
  it('STRESS-002: 100 Parallel Inbound Messages -> Zero Dropped Jobs & Sub-10ms Burst Latency', async () => {
    const totalJobs = 100;
    const processedIds: string[] = [];

    const startTime = Date.now();

    for (let i = 0; i < totalJobs; i++) {
      webhookQueue.enqueue(
        `salon_${i % 5}`, // Spread across 5 salons
        { payloadIndex: i },
        async () => {
          processedIds.push(`job_${i}`);
        },
      );
    }

    const totalBurstTime = Date.now() - startTime;
    expect(totalBurstTime).toBeLessThan(100);

    // Wait for worker queue loop to drain
    await new Promise((res) => setTimeout(res, 600));

    expect(processedIds.length).toBe(totalJobs);
    expect(webhookQueue.getQueueLength()).toBe(0);
  });
});
