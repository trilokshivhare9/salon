import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

export interface WebhookJob {
  id: string;
  salonId: string;
  payload: any;
  receivedAt: Date;
  processor: () => Promise<any>;
}

@Injectable()
export class WhatsAppWebhookQueue implements OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppWebhookQueue.name);
  private queue: WebhookJob[] = [];
  private isProcessing = false;
  private isShuttingDown = false;

  onModuleDestroy() {
    this.isShuttingDown = true;
    this.queue = [];
    this.logger.log('🛑 WhatsApp Webhook Queue shut down cleanly.');
  }

  /**
   * Enqueues an incoming Meta Webhook payload for asynchronous processing.
   * Returns immediately so HTTP handler can reply 200 OK to Meta Cloud API in < 10ms.
   */
  enqueue(salonId: string, payload: any, processor: () => Promise<any>): void {
    if (this.isShuttingDown) return;

    const job: WebhookJob = {
      id: `wh_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      salonId,
      payload,
      receivedAt: new Date(),
      processor,
    };

    this.queue.push(job);
    this.logger.log(`📥 [Webhook Queue] Enqueued job ${job.id} for salon ${salonId} (Buffer size: ${this.queue.length})`);

    // Trigger processing loop asynchronously
    setImmediate(() => {
      this.processQueue().catch((err) => {
        this.logger.error('Error in WhatsApp webhook queue processing loop:', err);
      });
    });
  }

  /**
   * Worker loop that processes queued webhook jobs in FIFO order.
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0 || this.isShuttingDown) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0 && !this.isShuttingDown) {
      const job = this.queue.shift();
      if (!job) break;

      const queueDelayMs = Date.now() - job.receivedAt.getTime();
      this.logger.log(`⚙️ [Webhook Queue] Processing job ${job.id} (Queue delay: ${queueDelayMs}ms)`);

      try {
        await job.processor();
        this.logger.log(`✅ [Webhook Queue] Completed job ${job.id}`);
      } catch (err: any) {
        this.logger.error(`❌ [Webhook Queue] Failed processing job ${job.id} for salon ${job.salonId}:`, err?.stack || err);
      }
    }

    this.isProcessing = false;
  }

  /**
   * Returns current buffer size for metrics/monitoring.
   */
  getQueueLength(): number {
    return this.queue.length;
  }
}
