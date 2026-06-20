import amqp from 'amqplib';
import dotenv from 'dotenv';
import { esClient, TICKET_INDEX, initElasticsearch } from '../config/elasticsearch';
import { Client } from '@elastic/elasticsearch';

dotenv.config();

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
const EXCHANGE_NAME = 'helpdesk.events';
const QUEUE_NAME = 'helpdesk.search_queue';

async function startSearchWorker() {
  try {
    // 1. Initialize Elasticsearch index and mapping
    await initElasticsearch();

    if (!esClient) {
      console.warn('⚠️ Search Worker: Elasticsearch client not available. Synchronization bypassed.');
      return;
    }

    // Capture non-null reference for TypeScript type narrowing
    const client: Client = esClient;

    console.log('🔄 Search worker connecting to RabbitMQ...');
    const connection = await amqp.connect(RABBITMQ_URL);

    connection.on('error', (err) => {
      console.error('🔴 RabbitMQ connection error in Search Worker:', err.message);
    });

    connection.on('close', () => {
      console.warn('🔴 RabbitMQ connection closed in Search Worker. Reconnecting in 5s...');
      setTimeout(startSearchWorker, 5000);
    });

    const channel = await connection.createChannel();

    // 2. Assert exchange and queue
    await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });
    await channel.assertQueue(QUEUE_NAME, { durable: true });

    // 3. Bind queue for ticket creation, update, and replies
    await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, 'ticket.created');
    await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, 'ticket.updated');
    await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, 'reply.created');

    console.log(`🟢 Search Worker connected. Listening to exchange "${EXCHANGE_NAME}" via queue "${QUEUE_NAME}"...`);

    channel.consume(QUEUE_NAME, async (msg) => {
      if (!msg) return;

      const routingKey = msg.fields.routingKey;
      const content = msg.content.toString();
      let payload: any;

      try {
        payload = JSON.parse(content);
      } catch (e) {
        console.error('🔴 Failed to parse search worker message payload. Discarding.', e);
        channel.ack(msg);
        return;
      }

      try {
        console.log(`📩 Search Sync: Received event "${routingKey}"`);

        if (routingKey === 'ticket.created') {
          // Index new ticket document (v7 body wrapping)
          await client.index({
            index: TICKET_INDEX,
            id: payload.ticketId,
            body: {
              ticketId: payload.ticketId,
              tenantId: payload.tenantId,
              title: payload.title,
              description: payload.description,
              status: payload.status,
              priority: payload.priority,
              assignedToId: payload.assignedToId || null,
              createdById: payload.createdById,
              createdAt: payload.createdAt,
              updatedAt: payload.createdAt,
              suggest: {
                input: [payload.title, payload.ticketId].filter(Boolean),
                weight: 10,
              },
              replies: [],
            },
            refresh: true,
          });
          console.log(`   ✅ Indexed ticket "${payload.ticketId}" in Elasticsearch.`);
        } 
        
        else if (routingKey === 'ticket.updated') {
          // Update ticket properties (v7 body wrapping)
          await client.update({
            index: TICKET_INDEX,
            id: payload.ticketId,
            body: {
              doc: {
                title: payload.title,
                description: payload.description,
                status: payload.status,
                priority: payload.priority,
                assignedToId: payload.assignedToId || null,
                updatedAt: payload.updatedAt,
                // Update autocomplete suggestions
                suggest: {
                  input: [payload.title, payload.ticketId].filter(Boolean),
                  weight: 10,
                },
              }
            },
            refresh: true,
          });
          console.log(`   ✅ Updated ticket "${payload.ticketId}" in Elasticsearch.`);
        } 
        
        else if (routingKey === 'reply.created') {
          // Append reply to the nested replies array in Elasticsearch (v7 body wrapping)
          await client.update({
            index: TICKET_INDEX,
            id: payload.ticketId,
            body: {
              script: {
                source: `
                  if (ctx._source.replies == null) { ctx._source.replies = []; }
                  // Avoid duplicates (idempotency check)
                  if (!ctx._source.replies.stream().anyMatch(r -> r.replyId == params.newReply.replyId)) {
                    ctx._source.replies.add(params.newReply);
                  }
                `,
                params: {
                  newReply: {
                    replyId: payload.replyId,
                    content: payload.content,
                    createdById: payload.userId,
                    createdAt: payload.createdAt,
                  },
                },
              }
            },
            refresh: true,
          });
          console.log(`   ✅ Appended reply "${payload.replyId}" to ticket "${payload.ticketId}" in Elasticsearch.`);
        }

        channel.ack(msg);
      } catch (err: any) {
        console.error(`🔴 Search Sync error processing "${routingKey}":`, err.message || err);
        // Requeue only if it's a transient Elasticsearch error and we haven't hit limit
        channel.nack(msg, false, true);
      }
    });

  } catch (error) {
    console.error('🔴 Search Worker initialization failed. Retrying in 5s...', error);
    setTimeout(startSearchWorker, 5000);
  }
}

startSearchWorker();
