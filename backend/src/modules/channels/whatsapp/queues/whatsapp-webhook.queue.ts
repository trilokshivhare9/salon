import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

export interface WebhookJob {
  id: string;
  partitionKey: string;
  payload: any;
  receivedAt: Date;
  processor: () => Promise<any>;
}

@Injectable()
export class WhatsAppWebhookQueue implements OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppWebhookQueue.name);
  private isShuttingDown = false;
  private pendingJobsCount = 0;
  private activePipelines = new Map<string, Promise<void>>();

  // Global Concurrency Semaphore: max active database worker tasks across all partitions simultaneously
  private readonly MAX_GLOBAL_CONCURRENT_WORKERS = 10;
  private currentActiveWorkers = 0;
  private semaphoreWaitQueue: (() => void)[] = [];

  private async acquireSlot(): Promise<void> {
    if (this.currentActiveWorkers < this.MAX_GLOBAL_CONCURRENT_WORKERS) {
      this.currentActiveWorkers++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.semaphoreWaitQueue.push(resolve);
    });
  }

  private releaseSlot(): void {
    if (this.semaphoreWaitQueue.length > 0) {
      const nextTask = this.semaphoreWaitQueue.shift();
      if (nextTask) nextTask();
    } else {
      this.currentActiveWorkers = Math.max(0, this.currentActiveWorkers - 1);
    }
  }

  onModuleDestroy() {
    this.isShuttingDown = true;
    this.activePipelines.clear();
    while (this.semaphoreWaitQueue.length > 0) {
      const waitResolve = this.semaphoreWaitQueue.shift();
      if (waitResolve) waitResolve();
    }
    this.logger.log('🛑 WhatsApp Webhook Queue shut down cleanly.');
  }

  /**
   * Enqueues an incoming Meta Webhook payload for asynchronous processing.
   * Uses Keyed Actor Partitioning + Global Counting Semaphore:
   * - Messages for the SAME partitionKey (customer phone) are strictly sequential (FIFO).
   * - Messages for DIFFERENT partitionKeys execute concurrently in parallel up to 10 workers.
   * - Protects PostgreSQL and Prisma pool against exhaustion under massive traffic bursts.
   * Returns immediately (<1ms) so HTTP webhook responds 200 OK to Meta Cloud API instantly.
   */
  enqueue(partitionKey: string, payload: any, processor: () => Promise<any>): void {
    if (this.isShuttingDown) return;

    const jobId = `wh_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const receivedAt = new Date();
    this.pendingJobsCount++;

    const key = (partitionKey || 'default').trim();
    this.logger.log(
      `📥 [Webhook Queue] Enqueued job ${jobId} for partition [${key}] (Active queues: ${this.activePipelines.size + 1}, Pending: ${this.pendingJobsCount})`,
    );

    const currentPipeline = this.activePipelines.get(key) || Promise.resolve();

    const nextPipeline = currentPipeline
      .then(async () => {
        // Yield macrotask turn so synchronous burst enqueues finish before execution begins
        await new Promise((resolve) => setImmediate(resolve));
        if (this.isShuttingDown) return;

        // Acquire slot from the Global Semaphore (caps parallel DB load to 10)
        await this.acquireSlot();
        try {
          if (this.isShuttingDown) return;
          const queueDelayMs = Date.now() - receivedAt.getTime();
          this.logger.log(`⚙️ [Webhook Queue] Executing job ${jobId} for [${key}] (Queue delay: ${queueDelayMs}ms, Active workers: ${this.currentActiveWorkers})`);
          await processor();
          this.logger.log(`✅ [Webhook Queue] Completed job ${jobId} for [${key}]`);
        } catch (err: any) {
          this.logger.error(`❌ [Webhook Queue] Failed processing job ${jobId} for [${key}]:`, err?.stack || err);
        } finally {
          this.releaseSlot();
          this.pendingJobsCount = Math.max(0, this.pendingJobsCount - 1);
        }
      })
      .catch((err) => {
        this.logger.error(`Unhandled error in pipeline for [${key}]:`, err);
        this.pendingJobsCount = Math.max(0, this.pendingJobsCount - 1);
      })
      .finally(() => {
        // Clean up map entry when this pipeline is completely idle
        if (this.activePipelines.get(key) === nextPipeline) {
          this.activePipelines.delete(key);
        }
      });

    this.activePipelines.set(key, nextPipeline);
  }

  /**
   * Returns current pending jobs count for metrics/monitoring.
   */
  getQueueLength(): number {
    return this.pendingJobsCount;
  }
}
