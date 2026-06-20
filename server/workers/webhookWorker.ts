import amqp from 'amqplib';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
const EXCHANGE_NAME = 'helpdesk.events';
const QUEUE_NAME = 'helpdesk.webhook_queue_v2';

const DLX_EXCHANGE = 'helpdesk.events.dlx';
const DLQ_QUEUE = 'helpdesk.webhook_queue_v2.dlq';
const DLQ_ROUTING_KEY = 'helpdesk.webhook_queue_v2.dlq.routing';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;

const prisma = new PrismaClient();

async function dispatchWebhook(url: string, payload: any, secret: string): Promise<boolean> {
  const payloadStr = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', secret).update(payloadStr).digest('hex');

  try {
    console.log(`   🔗 POSTing webhook payload to: ${url}`);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Helpdesk-Signature': `sha256=${signature}`,
      },
      body: payloadStr,
    });

    if (response.ok) {
      console.log(`   ✅ Webhook delivered successfully: Status ${response.status}`);
      return true;
    } else {
      console.warn(`   ⚠️ Webhook failed with status: ${response.status}`);
      return false;
    }
  } catch (err: any) {
    console.error(`   🔴 Webhook fetch call failed:`, err.message || err);
    return false;
  }
}

async function startWebhookWorker() {
  try {
    console.log('🔄 Webhook worker connecting to RabbitMQ...');
    const connection = await amqp.connect(RABBITMQ_URL);

    connection.on('error', (err) => {
      console.error('🔴 RabbitMQ connection error in Webhook Worker:', err.message);
    });

    connection.on('close', () => {
      console.warn('🔴 RabbitMQ connection closed in Webhook Worker. Reconnecting in 5s...');
      setTimeout(startWebhookWorker, 5000);
    });

    const channel = await connection.createChannel();

    // Assert exchanges & queues
    await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });
    await channel.assertExchange(DLX_EXCHANGE, 'direct', { durable: true });

    await channel.assertQueue(DLQ_QUEUE, { durable: true });
    await channel.assertQueue(QUEUE_NAME, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': DLX_EXCHANGE,
        'x-dead-letter-routing-key': DLQ_ROUTING_KEY,
      },
    });

    // Bind to ticket creations/updates and replies
    await channel.bindQueue(DLQ_QUEUE, DLX_EXCHANGE, DLQ_ROUTING_KEY);
    await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, 'ticket.created');
    await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, 'ticket.updated');
    await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, 'reply.created');

    console.log(`🟢 Webhook Worker connected. Listening to exchange "${EXCHANGE_NAME}" via queue "${QUEUE_NAME}"...`);

    channel.consume(QUEUE_NAME, async (msg) => {
      if (!msg) return;

      const routingKey = msg.fields.routingKey;
      const content = msg.content.toString();
      let payload: any;

      try {
        payload = JSON.parse(content);
      } catch (e) {
        console.error('🔴 Failed to parse webhook message payload. Acking to discard.', e);
        channel.ack(msg);
        return;
      }

      const tenantId = payload.tenantId;
      if (!tenantId) {
        console.warn('⚠️ Message payload lacks tenantId. Discarding.');
        channel.ack(msg);
        return;
      }

      const headers = msg.properties.headers || {};
      const retryCount = typeof headers['x-retry-count'] === 'number' ? headers['x-retry-count'] : 0;

      try {
        console.log(`📩 Received event "${routingKey}" for Webhook Dispatch (Attempt ${retryCount + 1})`);

        // Fetch Webhook configuration
        const config = await prisma.webhookConfig.findUnique({
          where: { tenantId },
        });

        if (!config) {
          console.log(`   ℹ️ No Webhook configuration found for tenant ${tenantId}. Dispatch skipped.`);
          channel.ack(msg);
          return;
        }

        if (!config.isActive) {
          console.log(`   ℹ️ Webhook configuration is inactive for tenant ${tenantId}. Dispatch skipped.`);
          channel.ack(msg);
          return;
        }

        // Prepare context data to send
        const webhookPayload = {
          event: routingKey,
          timestamp: new Date().toISOString(),
          data: payload,
        };

        const success = await dispatchWebhook(config.url, webhookPayload, config.secret);

        if (success) {
          channel.ack(msg);
        } else {
          throw new Error('Delivery failed');
        }
      } catch (error: any) {
        console.error(`🔴 Webhook delivery exception:`, error.message);

        if (retryCount < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * Math.pow(2, retryCount);
          console.warn(`⚠️ Retrying webhook dispatch in ${delay}ms... (Attempts remaining: ${MAX_RETRIES - retryCount})`);
          
          await new Promise((resolve) => setTimeout(resolve, delay));

          channel.ack(msg);
          channel.publish(EXCHANGE_NAME, routingKey, Buffer.from(content), {
            persistent: true,
            headers: {
              ...headers,
              'x-retry-count': retryCount + 1,
            },
          });
        } else {
          console.error(`🚨 Max retries reached for webhook delivery of event "${routingKey}". Discarding.`);
          
          try {
            await prisma.failedNotification.create({
              data: {
                event: routingKey,
                payload: payload,
                reason: error.message || 'Max retries exceeded',
                tenantId: payload.tenantId,
              },
            });
            console.log('💾 Logged failed notification to PostgreSQL.');
          } catch (dbErr) {
            console.error('🔴 Failed to log failed notification to database:', dbErr);
          }

          channel.nack(msg, false, false);
        }
      }
    });

  } catch (error) {
    console.error('🔴 Webhook Worker crashed during initialization. Retrying in 5s...', error);
    setTimeout(startWebhookWorker, 5000);
  }
}

startWebhookWorker();
