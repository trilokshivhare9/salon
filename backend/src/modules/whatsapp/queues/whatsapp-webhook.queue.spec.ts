import { WhatsAppWebhookQueue } from './whatsapp-webhook.queue';

describe('WhatsAppWebhookQueue', () => {
  let queue: WhatsAppWebhookQueue;

  beforeEach(() => {
    queue = new WhatsAppWebhookQueue();
  });

  afterEach(() => {
    queue.onModuleDestroy();
  });

  it('should enqueue job and process processor callback asynchronously', (done) => {
    let processed = false;

    queue.enqueue('test-salon-id', { text: 'hi' }, async () => {
      processed = true;
    });

    expect(queue.getQueueLength()).toBeGreaterThanOrEqual(1);

    setTimeout(() => {
      expect(processed).toBe(true);
      expect(queue.getQueueLength()).toBe(0);
      done();
    }, 50);
  });

  it('should handle processor errors gracefully without crashing worker loop', (done) => {
    queue.enqueue('test-salon-id', { text: 'error' }, async () => {
      throw new Error('Test processor failure');
    });

    setTimeout(() => {
      expect(queue.getQueueLength()).toBe(0);
      done();
    }, 50);
  });
});
